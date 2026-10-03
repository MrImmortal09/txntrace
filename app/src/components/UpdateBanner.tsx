import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { completeUpdate, useUpdateStatus } from '../services/playStoreUpdate';

/**
 * Bar shown above the tab bar once a Play Store update has finished downloading. The update
 * installs by itself when the phone is idle; this only offers to restart straight away.
 */
export const UpdateBanner = () => {
  const { colors } = useTheme();
  const status = useUpdateStatus();
  const [dismissed, setDismissed] = useState(false);
  const isReady = status.phase === 'ready';

  // A later update should be announced again even if an earlier one was dismissed
  useEffect(() => {
    if (!isReady) {
      setDismissed(false);
    }
  }, [isReady]);

  if (!isReady || dismissed) {
    return null;
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.surface, borderTopColor: colors.border }]}>
      <View style={styles.message}>
        <Text style={[styles.title, { color: colors.text }]}>Update ready</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Installs when your phone is idle</Text>
      </View>
      <TouchableOpacity style={styles.action} onPress={() => completeUpdate()}>
        <Text style={[styles.actionText, { color: colors.primary }]}>Restart</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.action} onPress={() => setDismissed(true)} accessibilityLabel="Dismiss">
        <Text style={[styles.dismissText, { color: colors.textSecondary }]}>✕</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingLeft: 16,
    paddingRight: 6,
    borderTopWidth: 1,
  },
  message: { flex: 1 },
  title: { fontSize: 14, fontWeight: '600' },
  subtitle: { fontSize: 12, marginTop: 2 },
  action: { paddingHorizontal: 10, paddingVertical: 8 },
  actionText: { fontSize: 14, fontWeight: '700' },
  dismissText: { fontSize: 16, fontWeight: '600' },
});
