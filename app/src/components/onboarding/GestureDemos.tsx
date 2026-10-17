import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { useTheme } from '../../theme/ThemeProvider';
import BankIcon from '../BankIcon';

/**
 * Practice versions of the app's real gestures for the first-run tutorial.
 * They copy the thresholds and motion of SwipeableRow (Daily) and the Review
 * card, but only ever change their own sample data.
 *
 * Every demo sits inside the tutorial's own swipe-between-slides pager, an
 * ancestor responder that keeps asking for the gesture on each move — so each
 * demo refuses to hand a drag over once it has started.
 */

const DOUBLE_TAP_DELAY = 280; // same as DailyScreen
const ROW_SWIPE_THRESHOLD = 40; // same as SwipeableRow
// The real Review card uses 100; the practice card is narrower.
const CARD_SWIPE_THRESHOLD = 80;

export const useReduceMotion = () => {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then(value => mounted && setReduceMotion(value))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduceMotion;
};

/**
 * Loops a "this is how you do it" animation while `enabled`. The returned
 * stop() is for when the user grabs the demo: it leaves the values where they
 * are so the drag picks up from there. Being disabled any other way (the
 * slide scrolled off) runs `reset` instead, so nothing is left mid-nudge.
 */
const useHintLoop = (enabled: boolean, build: () => Animated.CompositeAnimation, reset: () => void) => {
  const loopRef = useRef<Animated.CompositeAnimation | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const loop = Animated.loop(build());
    loopRef.current = loop;
    loop.start();
    return () => {
      if (loopRef.current === loop) {
        loop.stop();
        loopRef.current = null;
        reset();
      }
    };
  }, [enabled, build, reset]);

  return useCallback(() => {
    loopRef.current?.stop();
    loopRef.current = null;
  }, []);
};

/** setTimeout that's cleared if the demo unmounts first. */
const useTimers = () => {
  const ids = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const pending = ids.current;
    return () => pending.forEach(clearTimeout);
  }, []);
  return useRef({
    later: (fn: () => void, ms: number) => {
      const id = setTimeout(fn, ms);
      ids.current.push(id);
      return id;
    },
  }).current;
};

const timing = (value: Animated.Value, toValue: number, duration: number) =>
  Animated.timing(value, { toValue, duration, easing: Easing.out(Easing.cubic), useNativeDriver: false });

const Caption = ({ text, success }: { text: string; success?: boolean }) => {
  const { colors } = useTheme();
  return (
    <View style={styles.captionBox}>
      <Text
        style={[styles.caption, { color: success ? colors.success : colors.textSecondary }]}
        accessibilityLiveRegion="polite"
      >
        {text}
      </Text>
    </View>
  );
};

/** A fingertip that rides along with a hint animation. */
const Finger = ({ x, opacity, style }: { x: Animated.Value; opacity: Animated.Value; style?: object }) => {
  const { colors } = useTheme();
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.finger,
        style,
        { backgroundColor: colors.text + '30', borderColor: colors.text + '55', opacity, transform: [{ translateX: x }] },
      ]}
    />
  );
};

// ─── Daily: swipe right / double-tap to mark as mine ────────────────────────

const DAILY_CAPTIONS = {
  idle: 'Try it: swipe the top row to the right, or double-tap it.',
  swiped: '✓ Swiped right: marked as yours and cleared from the list.',
  double: '✓ Double-tapped: marked as yours. The fastest way through a long list.',
  tap: 'One tap opens the details: the original SMS, place and card rewards.',
  split: 'Split shares a spend with friends. They’ll owe you their part.',
  mine: 'Mine: money that’s yours, like a refund or your salary.',
  friend: 'Friend: someone paying you back. It clears what they owe you.',
};
type DailyCaption = keyof typeof DAILY_CAPTIONS;

export const SwipeRowDemo = ({ active }: { active: boolean }) => {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const timers = useTimers();
  const [caption, setCaption] = useState<DailyCaption>('idle');
  const [tried, setTried] = useState(false);

  const pan = useRef(new Animated.Value(0)).current;
  const rowOpacity = useRef(new Animated.Value(1)).current;
  const finger = useRef(new Animated.Value(0)).current;
  const dragStart = useRef(0);
  const busy = useRef(false);
  const lastTap = useRef(0);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const buildHint = useCallback(
    () =>
      Animated.sequence([
        Animated.delay(900),
        timing(finger, 1, 200),
        timing(pan, 90, 650),
        Animated.delay(350),
        Animated.parallel([
          Animated.spring(pan, { toValue: 0, useNativeDriver: false }),
          timing(finger, 0, 250),
        ]),
        Animated.delay(600),
      ]),
    [pan, finger]
  );
  const resetHint = useCallback(() => {
    pan.setValue(0);
    finger.setValue(0);
  }, [pan, finger]);
  const stopHint = useHintLoop(active && !tried && !reduceMotion, buildHint, resetHint);

  const takeOver = () => {
    stopHint();
    finger.setValue(0);
    setTried(true);
  };

  const markMine = (how: 'swiped' | 'double') => {
    if (busy.current) return;
    busy.current = true;
    Animated.parallel([timing(pan, 400, 200), timing(rowOpacity, 0, 200)]).start(() => {
      setCaption(how);
      // Bring the sample back so it can be tried again.
      timers.later(() => {
        pan.setValue(0);
        timing(rowOpacity, 1, 250).start(() => {
          busy.current = false;
        });
      }, 900);
    });
  };

  const springBack = () => Animated.spring(pan, { toValue: 0, useNativeDriver: false }).start();

  const handleRowTap = () => {
    if (busy.current) return;
    takeOver();
    const now = Date.now();
    if (now - lastTap.current < DOUBLE_TAP_DELAY) {
      if (tapTimer.current) clearTimeout(tapTimer.current);
      lastTap.current = 0;
      markMine('double');
    } else {
      lastTap.current = now;
      tapTimer.current = timers.later(() => {
        lastTap.current = 0;
        setCaption('tap');
      }, DOUBLE_TAP_DELAY);
    }
  };

  const explain = (which: DailyCaption) => {
    takeOver();
    setCaption(which);
  };

  // Only rightward drags are claimed, so swiping left over the row still
  // moves on to the next slide. The handlers only touch refs, Animated values
  // and state setters, so the first render's closures stay valid.
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => !busy.current && g.dx > 4 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        takeOver();
        pan.stopAnimation(value => {
          dragStart.current = value;
        });
      },
      onPanResponderMove: (_, g) => pan.setValue(Math.max(0, dragStart.current + g.dx)),
      onPanResponderRelease: (_, g) => {
        if (dragStart.current + g.dx > ROW_SWIPE_THRESHOLD) markMine('swiped');
        else springBack();
      },
      onPanResponderTerminate: springBack,
    })
  ).current;

  const isSuccess = caption === 'swiped' || caption === 'double';

  return (
    <View style={styles.demo}>
      <View style={styles.swipeWrap}>
        <View style={[styles.swipeBackground, { backgroundColor: colors.accent }]}>
          <Text style={[styles.swipeBackgroundText, { color: colors.onPrimary }]}>✓ Mine</Text>
        </View>
        <Animated.View style={{ opacity: rowOpacity, transform: [{ translateX: pan }] }} {...panResponder.panHandlers}>
          <View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <TouchableOpacity
              style={styles.rowLeft}
              onPress={handleRowTap}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Sample spend: Swiggy, 349 rupees. Double-tap to mark it as yours."
            >
              <BankIcon bank="HDFC Bank" size={30} />
              <View style={styles.rowMiddle}>
                <Text style={[styles.merchant, { color: colors.text }]} numberOfLines={1}>SWIGGY</Text>
                <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>Today · 1:42 PM</Text>
              </View>
            </TouchableOpacity>
            <View style={styles.rowRight}>
              <Text style={[styles.amount, { color: colors.danger }]}>-₹349.00</Text>
              <TouchableOpacity
                style={[styles.smallButton, { backgroundColor: colors.primary }]}
                onPress={() => explain('split')}
                accessibilityRole="button"
              >
                <Text style={[styles.smallButtonText, { color: colors.onPrimary }]}>Split</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
        <Finger x={pan} opacity={finger} style={styles.rowFinger} />
      </View>

      <View style={[styles.row, styles.swipeWrap, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <View style={styles.rowLeft}>
          <BankIcon bank="ICICI Bank" size={30} />
          <View style={styles.rowMiddle}>
            <Text style={[styles.merchant, { color: colors.text }]} numberOfLines={1}>RAHUL SHARMA</Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>Today · 9:15 AM</Text>
          </View>
        </View>
        <View style={styles.rowRight}>
          <Text style={[styles.amount, { color: colors.success }]}>+₹450.00</Text>
          <View style={styles.buttonPair}>
            <TouchableOpacity
              style={[styles.smallButton, styles.outlineButton, { borderColor: colors.border }]}
              onPress={() => explain('mine')}
              accessibilityRole="button"
            >
              <Text style={[styles.smallButtonText, { color: colors.textSecondary }]}>Mine</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.smallButton, { backgroundColor: colors.primary }]}
              onPress={() => explain('friend')}
              accessibilityRole="button"
            >
              <Text style={[styles.smallButtonText, { color: colors.onPrimary }]}>Friend</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <Caption text={DAILY_CAPTIONS[caption]} success={isSuccess} />
    </View>
  );
};

// ─── Review: swipe to browse, Review & Next to save ─────────────────────────

interface SampleCard {
  id: string;
  bank: string;
  merchant: string;
  amount: number;
  when: string;
}

const SAMPLE_QUEUE: SampleCard[] = [
  { id: 'a', bank: 'ICICI Bank', merchant: 'AMAZON', amount: 1249, when: 'Today · 11:20 AM' },
  { id: 'b', bank: 'SBI', merchant: 'UBER INDIA', amount: 186, when: 'Yesterday · 9:05 PM' },
  { id: 'c', bank: 'Axis Bank', merchant: 'DMART', amount: 2310.5, when: '15 Oct · 6:40 PM' },
];
const SAMPLE_CATEGORIES = ['Food', 'Transport', 'Shopping', 'Bills'];
const REVIEW_IDLE = 'Try it: swipe the card left and right. Nothing is saved until you tap Review & Next.';

export const ReviewCardDemo = ({ active }: { active: boolean }) => {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  const timers = useTimers();
  const [queue, setQueue] = useState(SAMPLE_QUEUE);
  const [index, setIndex] = useState(0);
  const [category, setCategory] = useState<string | null>(null);
  const [caption, setCaption] = useState({ text: REVIEW_IDLE, success: false });
  const [tried, setTried] = useState(false);

  const pan = useRef(new Animated.Value(0)).current;
  const finger = useRef(new Animated.Value(0)).current;
  const dragStart = useRef(0);
  const animating = useRef(false);

  const card = queue[index];

  const buildHint = useCallback(
    () =>
      Animated.sequence([
        Animated.delay(900),
        timing(finger, 1, 200),
        timing(pan, -60, 500),
        Animated.delay(250),
        timing(pan, 0, 300),
        Animated.delay(150),
        timing(pan, 60, 500),
        Animated.delay(250),
        timing(pan, 0, 300),
        timing(finger, 0, 200),
        Animated.delay(700),
      ]),
    [pan, finger]
  );
  const resetHint = useCallback(() => {
    pan.setValue(0);
    finger.setValue(0);
  }, [pan, finger]);
  const stopHint = useHintLoop(active && !tried && !reduceMotion, buildHint, resetHint);

  const takeOver = () => {
    stopHint();
    finger.setValue(0);
    setTried(true);
  };

  const springBack = () => Animated.spring(pan, { toValue: 0, useNativeDriver: false }).start();

  // Same motion as ReviewScreen.browse: out one side, in from the other.
  const browse = (step: 1 | -1) => {
    if (animating.current) return;
    if (queue.length < 2) {
      springBack();
      return;
    }
    animating.current = true;
    const exitX = -step * 320;
    setCaption({
      text: step === 1 ? 'Swiped left: the next card. Swiping only browses, nothing was saved.' : 'Swiped right: back to the previous card.',
      success: false,
    });
    timing(pan, exitX, 160).start(() => {
      setIndex(i => (i + step + queue.length) % queue.length);
      setCategory(null);
      pan.setValue(-exitX);
      timing(pan, 0, 160).start(() => {
        animating.current = false;
      });
    });
  };

  const reviewAndNext = () => {
    if (animating.current || !card) return;
    takeOver();
    animating.current = true;
    timing(pan, 360, 200).start(() => {
      const remaining = queue.filter(c => c.id !== card.id);
      setCaption({
        text: `✓ Saved ${card.merchant}${category ? ` under ${category}` : ''}. It left the queue, and the next card slid in.`,
        success: true,
      });
      setQueue(remaining);
      setIndex(i => (remaining.length ? i % remaining.length : 0));
      setCategory(null);
      pan.setValue(0);
      animating.current = false;
      if (remaining.length === 0) {
        timers.later(() => {
          setQueue(SAMPLE_QUEUE);
          setIndex(0);
          setCaption({ text: 'All caught up! The sample cards are back if you want another go.', success: false });
        }, 1800);
      }
    });
  };

  const actionsRef = useRef({ takeOver, browse });
  useEffect(() => {
    actionsRef.current = { takeOver, browse };
  });

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        !animating.current && Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 2,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        actionsRef.current.takeOver();
        pan.stopAnimation(value => {
          dragStart.current = value;
        });
      },
      onPanResponderMove: (_, g) => pan.setValue(dragStart.current + g.dx),
      onPanResponderRelease: (_, g) => {
        const dx = dragStart.current + g.dx;
        if (Math.abs(dx) > CARD_SWIPE_THRESHOLD) actionsRef.current.browse(dx < 0 ? 1 : -1);
        else springBack();
      },
      onPanResponderTerminate: springBack,
    })
  ).current;

  const rotate = pan.interpolate({ inputRange: [-150, 0, 150], outputRange: ['-10deg', '0deg', '10deg'], extrapolate: 'clamp' });

  return (
    <View style={styles.demo}>
      <Text style={[styles.position, { color: colors.textSecondary }]}>
        {card ? `${index + 1} of ${queue.length}` : 'Nothing left to review'}
      </Text>
      <View style={styles.cardStage}>
        {card ? (
          <Animated.View
            style={[
              styles.card,
              { backgroundColor: colors.surface, borderColor: colors.border, shadowColor: colors.cardShadow },
              { transform: [{ translateX: pan }, { rotate }] },
            ]}
            {...panResponder.panHandlers}
          >
            <TouchableOpacity
              style={styles.cardInner}
              activeOpacity={0.9}
              onPress={() => {
                takeOver();
                setCaption({ text: 'Tapping the card opens its full details, including the original SMS.', success: false });
              }}
              accessibilityRole="button"
              accessibilityLabel={`Sample card: ${card.merchant}, ${card.amount} rupees`}
            >
              <Text style={[styles.cardBank, { color: colors.textSecondary }]}>{card.bank}</Text>
              <Text style={[styles.cardAmount, { color: colors.danger }]}>-₹{card.amount.toFixed(2)}</Text>
              <Text style={[styles.cardMerchant, { color: colors.text }]} numberOfLines={1}>{card.merchant}</Text>
              <Text style={[styles.cardDate, { color: colors.textSecondary }]}>{card.when}</Text>
            </TouchableOpacity>
          </Animated.View>
        ) : (
          <View style={[styles.card, styles.cardInner, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.cardMerchant, { color: colors.success }]}>All caught up 🎉</Text>
          </View>
        )}
        <Finger x={pan} opacity={finger} style={styles.cardFinger} />
      </View>
      <View style={styles.swipeLegend}>
        <Text style={[styles.legendText, { color: colors.textSecondary }]}>← next</Text>
        <Text style={[styles.legendText, { color: colors.textSecondary }]}>previous →</Text>
      </View>

      <View style={styles.chipRow}>
        {SAMPLE_CATEGORIES.map(name => {
          const selected = category === name;
          return (
            <TouchableOpacity
              key={name}
              disabled={!card}
              style={[
                styles.chip,
                { backgroundColor: selected ? colors.primary : colors.surface, borderColor: selected ? colors.primary : colors.border },
              ]}
              onPress={() => {
                takeOver();
                setCategory(name);
                setCaption({ text: `${name} picked. Now tap Review & Next to save it.`, success: false });
              }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
            >
              <Text style={[styles.chipText, { color: selected ? colors.onPrimary : colors.text }]}>{name}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.bigButton, { backgroundColor: colors.warning }]}
          disabled={!card}
          onPress={() => {
            takeOver();
            setCaption({ text: 'Split this lets you pick contacts. The amount is divided equally, and you can edit each share.', success: false });
          }}
          accessibilityRole="button"
        >
          <Text style={[styles.bigButtonText, { color: colors.onPrimary }]}>Split this (0)</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.bigButton, { backgroundColor: colors.success }]}
          disabled={!card}
          onPress={reviewAndNext}
          accessibilityRole="button"
        >
          <Text style={[styles.bigButtonText, { color: colors.onPrimary }]}>Review & Next</Text>
        </TouchableOpacity>
      </View>

      <Caption text={caption.text} success={caption.success} />
    </View>
  );
};

// ─── How SMS arrive: message → parsed transaction ───────────────────────────

export const SmsFlowDemo = ({ active }: { active: boolean }) => {
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();
  // Everything starts fully drawn, so the slide never looks empty while it's
  // being swiped in; the loop then fades it out and rebuilds it step by step.
  const bubble = useRef(new Animated.Value(1)).current;
  const arrow = useRef(new Animated.Value(1)).current;
  const result = useRef(new Animated.Value(1)).current;

  const build = useCallback(
    () =>
      Animated.sequence([
        Animated.delay(1800),
        Animated.parallel([timing(bubble, 0, 300), timing(arrow, 0, 300), timing(result, 0, 300)]),
        Animated.delay(250),
        timing(bubble, 1, 400),
        Animated.delay(250),
        timing(arrow, 1, 250),
        timing(result, 1, 350),
      ]),
    [bubble, arrow, result]
  );
  const reset = useCallback(() => {
    bubble.setValue(1);
    arrow.setValue(1);
    result.setValue(1);
  }, [bubble, arrow, result]);
  useHintLoop(active && !reduceMotion, build, reset);

  const rise = (v: Animated.Value) => ({
    opacity: v,
    transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
  });
  const strong = { color: colors.text, fontWeight: '700' as const };

  return (
    <View style={styles.demo}>
      <Animated.View style={[styles.smsBubble, { backgroundColor: colors.surface, borderColor: colors.border }, rise(bubble)]}>
        <Text style={[styles.smsSender, { color: colors.textSecondary }]}>VM-HDFCBK</Text>
        <Text style={[styles.smsText, { color: colors.textSecondary }]}>
          Sent <Text style={strong}>Rs.349.00</Text> from HDFC Bank A/c <Text style={strong}>XX1234</Text> to{' '}
          <Text style={strong}>SWIGGY</Text> on 17-10-26. UPI Ref <Text style={strong}>529817364012</Text>
        </Text>
      </Animated.View>

      <Animated.View style={[styles.arrowRow, { opacity: arrow }]}>
        <Svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke={colors.primary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <Polyline points="6 9 12 15 18 9" />
        </Svg>
        <Text style={[styles.arrowText, { color: colors.primary }]}>TxnTrace reads the highlighted parts</Text>
      </Animated.View>

      <Animated.View style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }, rise(result)]}>
        <View style={styles.rowLeft}>
          <BankIcon bank="HDFC Bank" size={30} />
          <View style={styles.rowMiddle}>
            <Text style={[styles.merchant, { color: colors.text }]} numberOfLines={1}>SWIGGY</Text>
            <Text style={[styles.meta, { color: colors.textSecondary }]} numberOfLines={1}>17 Oct · A/c ••1234</Text>
          </View>
        </View>
        <View style={styles.rowRight}>
          <Text style={[styles.amount, { color: colors.danger }]}>-₹349.00</Text>
          <View style={[styles.pill, { backgroundColor: colors.warning + '22' }]}>
            <Text style={[styles.pillText, { color: colors.warning }]}>Needs review</Text>
          </View>
        </View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  demo: { width: '100%' },
  captionBox: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8, marginTop: 4 },
  caption: { fontSize: 13, textAlign: 'center', lineHeight: 18, fontWeight: '500' },
  finger: { position: 'absolute', width: 30, height: 30, borderRadius: 15, borderWidth: 2 },
  rowFinger: { left: 40, top: 17 },
  cardFinger: { left: '50%', marginLeft: -15, top: 70 },

  swipeWrap: { marginBottom: 10 },
  swipeBackground: { ...StyleSheet.absoluteFill, borderRadius: 12, justifyContent: 'center', paddingLeft: 18 },
  swipeBackgroundText: { fontWeight: 'bold', fontSize: 15 },
  row: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, padding: 12 },
  rowLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowMiddle: { flex: 1 },
  merchant: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 12, marginTop: 3 },
  rowRight: { alignItems: 'flex-end', gap: 6, marginLeft: 8 },
  amount: { fontSize: 14, fontWeight: 'bold' },
  buttonPair: { flexDirection: 'row', gap: 6 },
  smallButton: { borderRadius: 8, paddingVertical: 5, paddingHorizontal: 11 },
  outlineButton: { borderWidth: 1 },
  smallButtonText: { fontSize: 12, fontWeight: '600' },

  position: { fontSize: 12, textAlign: 'center', marginBottom: 6 },
  cardStage: { alignItems: 'center' },
  card: {
    width: '78%',
    height: 150,
    borderRadius: 18,
    borderWidth: 1,
    shadowOpacity: 1,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 10,
    elevation: 4,
  },
  cardInner: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12 },
  cardBank: { fontSize: 13, marginBottom: 4 },
  cardAmount: { fontSize: 30, fontWeight: 'bold', marginBottom: 4 },
  cardMerchant: { fontSize: 16, fontWeight: '600' },
  cardDate: { fontSize: 12, marginTop: 4 },
  swipeLegend: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 8, marginTop: 6 },
  legendText: { fontSize: 12, fontWeight: '600' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1 },
  chipText: { fontSize: 13, fontWeight: '500' },
  buttonRow: { flexDirection: 'row', gap: 10, marginTop: 12 },
  bigButton: { flex: 1, paddingVertical: 11, borderRadius: 10, alignItems: 'center' },
  bigButtonText: { fontWeight: 'bold', fontSize: 14 },

  smsBubble: { borderRadius: 16, borderTopLeftRadius: 4, borderWidth: 1, padding: 12 },
  smsSender: { fontSize: 11, fontWeight: '700', marginBottom: 4, letterSpacing: 0.5 },
  smsText: { fontSize: 13, lineHeight: 19 },
  arrowRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginVertical: 10 },
  arrowText: { fontSize: 12, fontWeight: '600' },
  pill: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  pillText: { fontSize: 11, fontWeight: '700' },
});
