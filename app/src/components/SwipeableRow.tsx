import React, { useRef } from 'react';
import { View, Text, StyleSheet, Animated, PanResponder } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

interface Props {
  onSwipeRight: () => void;
  children: React.ReactNode;
}

const SWIPE_THRESHOLD = 40;

/**
 * Built on core PanResponder/Animated rather than react-native-gesture-handler
 * — this app already has enough native-rebuild cycles in flight (App Intents,
 * new modules), and a plain swipe-right-to-confirm gesture doesn't need a new
 * native dependency to feel right.
 */
const SwipeableRow = ({ onSwipeRight, children }: Props) => {
  const { colors } = useTheme();
  const pan = useRef(new Animated.ValueXY()).current;
  const rowOpacity = useRef(new Animated.Value(1)).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 4 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
      onPanResponderMove: (_, gesture) => {
        if (gesture.dx > 0) pan.setValue({ x: gesture.dx, y: 0 });
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx > SWIPE_THRESHOLD) {
          Animated.parallel([
            Animated.timing(pan, { toValue: { x: 500, y: 0 }, duration: 200, useNativeDriver: false }),
            Animated.timing(rowOpacity, { toValue: 0, duration: 200, useNativeDriver: false }),
          ]).start(() => onSwipeRight());
        } else {
          Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
        }
      },
      // A release is a clean finger-lift; a *terminate* is the gesture being
      // taken away mid-drag (most commonly the FlatList's own scroll
      // responder grabbing it). Without handling this too, a swipe that
      // gets interrupted before crossing the threshold is left frozen at
      // its last dragged offset forever, since only onPanResponderRelease
      // was ever springing it back to 0.
      onPanResponderTerminate: () => {
        Animated.spring(pan, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
      },
    })
  ).current;

  return (
    <View style={styles.wrapper}>
      <View style={[styles.background, { backgroundColor: colors.accent }]}>
        <Text style={styles.backgroundText}>✓ Mine</Text>
      </View>
      <Animated.View
        style={{ transform: pan.getTranslateTransform(), opacity: rowOpacity }}
        {...panResponder.panHandlers}
      >
        {children}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: { marginBottom: 10 },
  background: {
    ...StyleSheet.absoluteFill,
    borderRadius: 14,
    justifyContent: 'center',
    paddingLeft: 20,
    marginVertical: 2, // matches the visual card spacing better than touching edges
  },
  backgroundText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});

export default SwipeableRow;
