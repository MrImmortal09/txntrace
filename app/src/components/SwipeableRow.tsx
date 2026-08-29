import React, { useRef } from 'react';
import { View, Text, StyleSheet, Animated, PanResponder } from 'react-native';

interface Props {
  onSwipeRight: () => void;
  children: React.ReactNode;
}

const SWIPE_THRESHOLD = 90;

/**
 * Built on core PanResponder/Animated rather than react-native-gesture-handler
 * — this app already has enough native-rebuild cycles in flight (App Intents,
 * new modules), and a plain swipe-right-to-confirm gesture doesn't need a new
 * native dependency to feel right.
 */
const SwipeableRow = ({ onSwipeRight, children }: Props) => {
  const pan = useRef(new Animated.ValueXY()).current;
  const rowOpacity = useRef(new Animated.Value(1)).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) =>
        Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 2,
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
    })
  ).current;

  return (
    <View style={styles.wrapper}>
      <View style={styles.background}>
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
    backgroundColor: '#34C759',
    borderRadius: 10,
    justifyContent: 'center',
    paddingLeft: 20,
  },
  backgroundText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
});

export default SwipeableRow;
