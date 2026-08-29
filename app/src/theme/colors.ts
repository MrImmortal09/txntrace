export const lightTheme = {
  background: '#F9FAFB',
  surface: '#FFFFFF',
  text: '#111827',
  textSecondary: '#6B7280',
  primary: '#2563EB', // Simple royal blue
  accent: '#10B981', // Clean green
  border: '#E5E7EB',
  danger: '#EF4444',
  success: '#10B981',
  cardShadow: 'rgba(0, 0, 0, 0.05)',
  tabBarBg: '#FFFFFF',
  tabBarActive: '#2563EB',
  tabBarInactive: '#9CA3AF',
};

export const darkTheme = {
  background: '#111827',
  surface: '#1F2937',
  text: '#F9FAFB',
  textSecondary: '#9CA3AF',
  primary: '#3B82F6', // Soft blue
  accent: '#34D399', // Soft green
  border: '#374151',
  danger: '#F87171',
  success: '#34D399',
  cardShadow: 'rgba(0, 0, 0, 0.3)',
  tabBarBg: '#1F2937',
  tabBarActive: '#3B82F6',
  tabBarInactive: '#6B7280',
};

export type ThemeColors = typeof lightTheme;
