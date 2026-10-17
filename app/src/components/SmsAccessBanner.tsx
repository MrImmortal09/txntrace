import React from 'react';
import { StyleProp, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { requestSmsAccess, useSmsAccess } from '../services/permissions';

/**
 * Android only: says SMS capture is off, and why it matters, instead of the
 * app just staying empty. Turn on opens PermissionSheet, which walks through
 * Android's prompt or its settings. Renders nothing on iOS or once granted.
 */
const SmsAccessBanner = ({ style }: { style?: StyleProp<ViewStyle> }) => {
  const { colors } = useTheme();
  const granted = useSmsAccess();
  if (granted) return null;

  return (
    <View style={[styles.banner, { backgroundColor: colors.surface, borderColor: colors.warning }, style]}>
      <View style={styles.text}>
        <Text style={[styles.title, { color: colors.text }]}>SMS access is off</Text>
        <Text style={[styles.body, { color: colors.textSecondary }]}>
          Transaction Trace needs it to add bank SMS to Daily as they arrive.
        </Text>
      </View>
      <TouchableOpacity
        style={[styles.button, { backgroundColor: colors.primary }]}
        onPress={() => requestSmsAccess()}
        accessibilityRole="button"
        accessibilityLabel="Turn on SMS access"
      >
        <Text style={[styles.buttonText, { color: colors.onPrimary }]}>Turn on</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderLeftWidth: 4,
  },
  text: { flex: 1 },
  title: { fontSize: 14, fontWeight: '700' },
  body: { fontSize: 13, marginTop: 2, lineHeight: 18 },
  button: { borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
  buttonText: { fontSize: 13, fontWeight: '700' },
});

export default SmsAccessBanner;
