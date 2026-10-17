import React, { useEffect, useRef, useState } from 'react';
import { AppState, Linking, Modal, PermissionsAndroid, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Polyline } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';
import { IconFriends } from './TabIcons';
import { ANDROID_PERMISSIONS, PermissionKind, registerPermissionPrompt } from '../services/permissions';
import { APP_NAME, APP_NAME_FULL } from '../constants/appName';

/**
 * Android's permission flow, explained. Opens with why TxnTrace wants the
 * permission, then shows Android's own prompt. If Android has stopped asking
 * (refused twice), it switches to step-by-step directions for turning it on
 * in system settings, and closes by itself once the person comes back with
 * it allowed.
 */

type Stage = 'explain' | 'denied' | 'blocked';

// Each step alternates plain and bold text: [plain, bold, plain, bold, ...].
type Step = string[];

interface Copy {
  title: string;
  reason: string;
  points: string[];
  allow: string;
  steps: Step[];
  /** Shown under the steps when Android may grey the setting out. */
  stuckHint?: Step;
}

const COPY: Record<PermissionKind, Copy> = {
  sms: {
    title: `Let ${APP_NAME} see bank SMS`,
    reason: `Your bank texts you after every spend. With SMS access, ${APP_NAME_FULL} adds each one to Daily as it arrives, so you don’t have to type them in.`,
    points: [
      'Only new messages, from the moment you allow it',
      'Read on this phone. Nothing leaves it unless you use backup or sync',
      'You can turn it off any time in Android settings',
    ],
    allow: 'Allow SMS access',
    steps: [
      ['Tap ', 'Open settings', ' below'],
      ['Tap ', 'Permissions'],
      ['Tap ', 'SMS', ', then ', 'Allow'],
      [`Come back here. ${APP_NAME} picks it up on its own`],
    ],
    // Android 13+ greys out SMS for apps installed outside the Play Store
    // until "restricted settings" are allowed for them.
    stuckHint: [
      'SMS greyed out, or marked as a restricted setting? On the same page tap ',
      '⋮',
      ' at the top right, then ',
      'Allow restricted settings',
      ', and try step 2 again.',
    ],
  },
  contacts: {
    title: 'Pick friends from your contacts',
    reason:
      'Contacts let you pick who you’re splitting a spend with, and match money a friend sends you to the right person.',
    points: ['Only names are used', 'You can turn it off any time in Android settings'],
    allow: 'Allow contacts',
    steps: [
      ['Tap ', 'Open settings', ' below'],
      ['Tap ', 'Permissions'],
      ['Tap ', 'Contacts', ', then ', 'Allow'],
      [`Come back here. ${APP_NAME} picks it up on its own`],
    ],
  },
};

// Once Android says it won't ask again, later requests this session go
// straight to the settings steps instead of a button that does nothing.
const blocked = new Set<PermissionKind>();

// Android answers at once when it won't show its prompt any more. Closing a
// prompt that has just appeared takes a person longer than this.
const NO_PROMPT_MS = 500;

interface Request {
  kind: PermissionKind;
  resolve: (granted: boolean) => void;
}

const SmsIcon = ({ color }: { color: string }) => (
  <Svg width={28} height={28} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <Path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    <Polyline points="8 10 11 13 16 8" />
  </Svg>
);

const StepText = ({ step, style, boldStyle }: { step: Step; style: object; boldStyle: object }) => (
  <Text style={style}>
    {step.map((part, i) =>
      i % 2 ? (
        <Text key={i} style={boldStyle}>
          {part}
        </Text>
      ) : (
        part
      )
    )}
  </Text>
);

/** Mounted once in App; requestSmsAccess / requestContactsAccess open it. */
export const PermissionSheetHost = () => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [request, setRequest] = useState<Request | null>(null);
  const [stage, setStage] = useState<Stage>('explain');
  // The request whose Android prompt is up. Only its own button waits on it,
  // so a newer request that takes over the sheet can still be answered.
  const [askingFor, setAskingFor] = useState<Request | null>(null);
  const asking = askingFor !== null && askingFor === request;
  // The request on screen right now, for code that resumes after an await.
  const activeRef = useRef<Request | null>(null);
  activeRef.current = request;
  // Keeps the content in place while the sheet slides away.
  const lastKind = useRef<PermissionKind>('sms');
  if (request) lastKind.current = request.kind;
  const kind = request?.kind ?? lastKind.current;
  const copy = COPY[kind];

  useEffect(() => {
    registerPermissionPrompt(
      next =>
        new Promise<boolean>(resolve => {
          setRequest(prev => {
            prev?.resolve(false);
            return { kind: next, resolve };
          });
          setStage(blocked.has(next) ? 'blocked' : 'explain');
        })
    );
    return () => {
      registerPermissionPrompt(null);
      // With the sheet gone nothing can answer a request still on it, so
      // settle it rather than leave its caller waiting forever.
      activeRef.current?.resolve(false);
    };
  }, []);

  // Answers one request, and closes the sheet only if that request is still
  // the one showing; a newer one keeps its sheet and its pending answer.
  const settle = (req: Request, granted: boolean) => {
    req.resolve(granted);
    setRequest(current => (current === req ? null : current));
  };

  const finish = (granted: boolean) => {
    if (request) settle(request, granted);
  };

  // Back from system settings (or Android's own prompt) with it allowed.
  useEffect(() => {
    if (!request) return;
    const sub = AppState.addEventListener('change', async state => {
      if (state !== 'active') return;
      if (await PermissionsAndroid.check(ANDROID_PERMISSIONS[request.kind]).catch(() => false)) {
        blocked.delete(request.kind);
        settle(request, true);
      }
    });
    return () => sub.remove();
  }, [request]);

  const allow = async () => {
    const req = request;
    if (!req) return;
    setAskingFor(req);
    try {
      const permission = ANDROID_PERMISSIONS[req.kind];
      // A prompt closed by tapping outside it or pressing back also comes
      // back as "never ask again", though Android will still ask next time.
      // So it only counts when the answer came too fast for any prompt to
      // have been shown. A real final refusal gets "Try again" first, and
      // that second answer comes back at once.
      const askedAt = Date.now();
      const result = await PermissionsAndroid.request(permission);
      const granted = result === PermissionsAndroid.RESULTS.GRANTED;
      const neverAsks = result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN && Date.now() - askedAt < NO_PROMPT_MS;
      if (granted) blocked.delete(req.kind);
      if (neverAsks) blocked.add(req.kind);
      // Answered after another request took over the sheet: settle this one
      // and leave the sheet to the newer request.
      if (activeRef.current !== req) {
        req.resolve(granted);
        return;
      }
      if (granted) settle(req, true);
      else setStage(neverAsks ? 'blocked' : 'denied');
    } catch (error) {
      console.warn('Permission request failed:', error);
      if (activeRef.current === req) setStage('denied');
    } finally {
      setAskingFor(current => (current === req ? null : current));
    }
  };

  const primaryLabel = stage === 'blocked' ? 'Open settings' : stage === 'denied' ? 'Try again' : copy.allow;
  const textStyle = [styles.itemText, { color: colors.textSecondary }];
  const boldStyle = [styles.bold, { color: colors.text }];

  return (
    <Modal visible={request !== null} transparent animationType="slide" statusBarTranslucent onRequestClose={() => finish(false)}>
      <View style={styles.overlay}>
        <TouchableOpacity
          style={styles.backdrop}
          activeOpacity={1}
          onPress={() => finish(false)}
          accessibilityLabel="Close"
        />
        <View style={[styles.sheet, { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, 16) + 8 }]}>
          <View style={[styles.handle, { backgroundColor: colors.border }]} />

          <View style={[styles.iconCircle, { backgroundColor: colors.primary + '1A' }]}>
            {kind === 'sms' ? <SmsIcon color={colors.primary} /> : <IconFriends color={colors.primary} size={28} />}
          </View>

          <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
            {stage === 'blocked' ? `Turn on ${kind === 'sms' ? 'SMS' : 'Contacts'} in Android settings` : copy.title}
          </Text>
          <Text style={[styles.reason, { color: colors.textSecondary }]}>
            {stage === 'blocked' ? `Android won’t show its prompt again, so it has to be switched on from ${APP_NAME}’s app settings.` : copy.reason}
          </Text>

          {stage === 'blocked' ? (
            <View style={styles.list}>
              {copy.steps.map((step, i) => (
                <View key={i} style={styles.item}>
                  <View style={[styles.stepNumber, { backgroundColor: colors.primary }]}>
                    <Text style={[styles.stepNumberText, { color: colors.onPrimary }]}>{i + 1}</Text>
                  </View>
                  <StepText step={step} style={textStyle} boldStyle={boldStyle} />
                </View>
              ))}
              {copy.stuckHint ? (
                <View style={[styles.hint, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <StepText step={copy.stuckHint} style={[styles.hintText, { color: colors.textSecondary }]} boldStyle={boldStyle} />
                </View>
              ) : null}
            </View>
          ) : (
            <View style={styles.list}>
              {copy.points.map(point => (
                <View key={point} style={styles.item}>
                  <Text style={[styles.check, { color: colors.success }]}>✓</Text>
                  <Text style={textStyle}>{point}</Text>
                </View>
              ))}
            </View>
          )}

          {stage === 'denied' ? (
            <Text style={[styles.note, { color: colors.warning }]}>
              It wasn’t allowed. Tap below to see Android’s prompt again.
            </Text>
          ) : null}

          <TouchableOpacity
            style={[styles.primary, { backgroundColor: colors.primary }, asking && styles.dimmed]}
            onPress={stage === 'blocked' ? () => Linking.openSettings() : allow}
            disabled={asking}
            accessibilityRole="button"
          >
            <Text style={[styles.primaryText, { color: colors.onPrimary }]}>{primaryLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondary} onPress={() => finish(false)} accessibilityRole="button">
            <Text style={[styles.secondaryText, { color: colors.textSecondary }]}>Not now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingTop: 10 },
  handle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 18 },
  iconCircle: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 8 },
  reason: { fontSize: 15, lineHeight: 22, marginBottom: 16 },
  list: { gap: 12, marginBottom: 16 },
  item: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  check: { fontSize: 15, fontWeight: '700', width: 22, textAlign: 'center', lineHeight: 20 },
  itemText: { flex: 1, fontSize: 14, lineHeight: 20 },
  bold: { fontWeight: '700' },
  stepNumber: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { fontSize: 12, fontWeight: '700' },
  hint: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 4 },
  hintText: { fontSize: 13, lineHeight: 19 },
  note: { fontSize: 13, fontWeight: '600', marginBottom: 12 },
  primary: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  primaryText: { fontSize: 16, fontWeight: '700' },
  dimmed: { opacity: 0.6 },
  secondary: { paddingVertical: 14, alignItems: 'center' },
  secondaryText: { fontSize: 15, fontWeight: '600' },
});
