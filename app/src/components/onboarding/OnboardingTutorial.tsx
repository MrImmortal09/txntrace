import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/ThemeProvider';
import { Slide, SLIDES } from './slides';

interface Props {
  visible: boolean;
  /** Skip, Get started, and Android back on the first slide all end the tour. */
  onDone: () => void;
}

const LAST = SLIDES.length - 1;

const SlidePage = ({ slide, active, width }: { slide: Slide; active: boolean; width: number }) => {
  const { colors } = useTheme();
  const { Visual, eyebrow } = slide;
  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);

  // On short screens a slide can run past the fold; hint that it scrolls.
  useEffect(() => {
    if (active) scrollRef.current?.flashScrollIndicators();
  }, [active]);

  return (
    <View
      style={{ width }}
      // Every slide stays mounted for the swipe; only the one on screen is read out.
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? 'auto' : 'no-hide-descendants'}
    >
      <ScrollView ref={scrollRef} contentContainerStyle={styles.slideContent}>
        <View style={styles.visual}>
          <Visual active={active} />
        </View>

        {eyebrow ? (
          <View style={styles.eyebrow}>
            {eyebrow.Icon ? <eyebrow.Icon color={colors.primary} size={15} /> : null}
            <Text style={[styles.eyebrowText, { color: colors.primary }]}>{eyebrow.label.toUpperCase()}</Text>
          </View>
        ) : null}
        <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
          {slide.title}
        </Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>{slide.body}</Text>

        {slide.points.map(point => (
          <View key={point.lead} style={styles.point}>
            <View style={[styles.pointIcon, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <Text style={styles.pointIconText}>{point.icon}</Text>
            </View>
            <Text style={[styles.pointText, { color: colors.textSecondary }]}>
              <Text style={[styles.pointLead, { color: colors.text }]}>{point.lead}</Text> {point.text}
            </Text>
          </View>
        ))}

        {slide.footnote ? (
          <Text style={[styles.footnote, { color: colors.textSecondary }]}>{slide.footnote}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
};

interface TourProps extends Props {
  /** Android back, routed here from the Modal that wraps the tour. */
  backRef: React.MutableRefObject<() => void>;
}

const Tour = ({ visible, onDone, backRef }: TourProps) => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  // Slides mount as the tour gets near them rather than all at once on
  // launch, and stay mounted after so a demo keeps its progress.
  const [reach, setReach] = useState(1);
  const indexRef = useRef(0);
  const widthRef = useRef(width);
  const dragStart = useRef(0);
  // Measured in slides, not pixels, so a width change can't strand the pager
  // between two of them.
  const position = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    widthRef.current = width;
  }, [width]);

  const goTo = (target: number) => {
    const next = Math.max(0, Math.min(LAST, target));
    indexRef.current = next;
    setIndex(next);
    setReach(r => Math.max(r, next + 1));
    Animated.spring(position, { toValue: next, speed: 16, bounciness: 0, useNativeDriver: false }).start();
  };

  useEffect(() => {
    backRef.current = () => (indexRef.current === 0 ? onDone() : goTo(indexRef.current - 1));
  });

  // goTo only touches refs, setters and the Animated value, so this
  // once-created responder can keep the first render's copy.
  const pager = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      // Caught mid-spring, the strip follows the finger from where it is, not
      // from the slide it was heading to.
      onPanResponderGrant: () =>
        position.stopAnimation(value => {
          dragStart.current = value;
        }),
      onPanResponderMove: (_, g) => {
        const raw = dragStart.current - g.dx / widthRef.current;
        // Drags past the first or last slide stretch, then spring back.
        position.setValue(raw < 0 ? raw / 3 : raw > LAST ? LAST + (raw - LAST) / 3 : raw);
      },
      onPanResponderRelease: (_, g) => {
        const distance = widthRef.current * 0.2;
        if (g.dx < 0 && (g.dx < -distance || g.vx < -0.4)) goTo(indexRef.current + 1);
        else if (g.dx > 0 && (g.dx > distance || g.vx > 0.4)) goTo(indexRef.current - 1);
        else goTo(indexRef.current);
      },
      onPanResponderTerminate: () => goTo(indexRef.current),
    })
  ).current;

  const isFirst = index === 0;
  const isLast = index === LAST;
  const translateX = useMemo(() => Animated.multiply(position, -width), [position, width]);
  const dotStyles = useMemo(
    () =>
      SLIDES.map((_, i) => {
        const range = { inputRange: [i - 1, i, i + 1], extrapolate: 'clamp' as const };
        return {
          width: position.interpolate({ ...range, outputRange: [8, 22, 8] }),
          opacity: position.interpolate({ ...range, outputRange: [0.3, 1, 0.3] }),
        };
      }),
    [position]
  );

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: colors.background, paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 12) },
      ]}
    >
      <View style={styles.header}>
        <Text style={[styles.step, { color: colors.textSecondary }]}>
          {index + 1} of {SLIDES.length}
        </Text>
        <TouchableOpacity
          onPress={onDone}
          disabled={isLast}
          style={isLast && styles.hidden}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          accessibilityRole="button"
          accessibilityLabel="Skip tutorial"
          accessibilityElementsHidden={isLast}
          importantForAccessibility={isLast ? 'no-hide-descendants' : 'auto'}
        >
          <Text style={[styles.skip, { color: colors.primary }]}>Skip</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.pager} {...pager.panHandlers}>
        <Animated.View style={[styles.strip, { width: width * SLIDES.length, transform: [{ translateX }] }]}>
          {SLIDES.map((slide, i) =>
            i <= reach ? (
              <SlidePage key={slide.key} slide={slide} active={visible && i === index} width={width} />
            ) : (
              <View key={slide.key} style={{ width }} />
            )
          )}
        </Animated.View>
      </View>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {SLIDES.map((slide, i) => (
            <Animated.View key={slide.key} style={[styles.dot, { backgroundColor: colors.primary }, dotStyles[i]]} />
          ))}
        </View>

        <View style={styles.navRow}>
          <TouchableOpacity
            style={[styles.navButton, { borderColor: colors.border }, isFirst && styles.hidden]}
            onPress={() => goTo(index - 1)}
            disabled={isFirst}
            accessibilityRole="button"
            accessibilityElementsHidden={isFirst}
            importantForAccessibility={isFirst ? 'no-hide-descendants' : 'auto'}
          >
            <Text style={[styles.navButtonText, { color: colors.text }]}>Back</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.navButton, styles.primaryButton, { backgroundColor: colors.primary, borderColor: colors.primary }]}
            onPress={() => (isLast ? onDone() : goTo(index + 1))}
            accessibilityRole="button"
          >
            <Text style={[styles.navButtonText, { color: colors.onPrimary }]}>{isLast ? 'Get started' : 'Next'}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
};

/**
 * First-run walkthrough of every tab, with practice versions of the Daily and
 * Review swipes. Slides change by swiping anywhere outside a demo, or with
 * Back / Next.
 *
 * The Modal unmounts its children once hidden, so keeping the tour's state in
 * Tour means every opening starts on the first slide, and a closed tutorial
 * costs nothing on re-render.
 */
const OnboardingTutorial = ({ visible, onDone }: Props) => {
  const backRef = useRef(onDone);
  return (
    <Modal
      visible={visible}
      animationType="fade"
      onRequestClose={() => backRef.current()}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <Tour visible={visible} onDone={onDone} backRef={backRef} />
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  step: { fontSize: 13, fontWeight: '600' },
  skip: { fontSize: 15, fontWeight: '600' },
  hidden: { opacity: 0 },

  pager: { flex: 1, overflow: 'hidden' },
  strip: { flex: 1, flexDirection: 'row' },
  slideContent: { paddingHorizontal: 24, paddingBottom: 24 },
  visual: { minHeight: 180, justifyContent: 'center', alignItems: 'center', marginTop: 4, marginBottom: 20 },
  eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  eyebrowText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 8 },
  body: { fontSize: 15, lineHeight: 22, marginBottom: 16 },
  point: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  pointIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pointIconText: { fontSize: 15 },
  pointText: { flex: 1, fontSize: 14, lineHeight: 20, paddingTop: 6 },
  pointLead: { fontWeight: '700' },
  footnote: { fontSize: 13, textAlign: 'center', marginTop: 12 },

  footer: { paddingHorizontal: 20, paddingTop: 8 },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, marginBottom: 14 },
  dot: { height: 8, borderRadius: 4 },
  navRow: { flexDirection: 'row', gap: 12 },
  navButton: { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  primaryButton: { flex: 2 },
  navButtonText: { fontSize: 16, fontWeight: '700' },
});

export default OnboardingTutorial;
