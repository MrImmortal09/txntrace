import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path, Circle, Rect, Polyline, Line } from 'react-native-svg';
import { useTheme } from '../theme/ThemeProvider';

import StatementsScreen from './StatementsScreen';
import HomeScreen from './HomeScreen';
import ReviewScreen from './ReviewScreen';
import DailyScreen from './DailyScreen';
import LogsScreen from './LogsScreen';
import FriendsStack from './FriendsStack';
import SettingsScreen from './SettingsScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const MoreStack = () => {
  const { colors } = useTheme();
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text }}>
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Statements" component={StatementsScreen} />
      <Stack.Screen name="Logs" component={LogsScreen} />
    </Stack.Navigator>
  );
};

const IconHome = ({ color }: { color: string }) => (
  <Svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></Path><Polyline points="9 22 9 12 15 12 15 22"></Polyline></Svg>
);
const IconDaily = ({ color }: { color: string }) => (
  <Svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Rect x="3" y="4" width="18" height="18" rx="2" ry="2"></Rect><Line x1="16" y1="2" x2="16" y2="6"></Line><Line x1="8" y1="2" x2="8" y2="6"></Line><Line x1="3" y1="10" x2="21" y2="10"></Line></Svg>
);
const IconReview = ({ color }: { color: string }) => (
  <Svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></Path><Polyline points="14 2 14 8 20 8"></Polyline><Line x1="16" y1="13" x2="8" y2="13"></Line><Line x1="16" y1="17" x2="8" y2="17"></Line><Polyline points="10 9 9 9 8 9"></Polyline></Svg>
);
const IconFriends = ({ color }: { color: string }) => (
  <Svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></Path><Circle cx="9" cy="7" r="4"></Circle><Path d="M23 21v-2a4 4 0 0 0-3-3.87"></Path><Path d="M16 3.13a4 4 0 0 1 0 7.75"></Path></Svg>
);
const IconMore = ({ color }: { color: string }) => (
  <Svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Circle cx="12" cy="12" r="1"></Circle><Circle cx="19" cy="12" r="1"></Circle><Circle cx="5" cy="12" r="1"></Circle></Svg>
);

export const TabNavigator = () => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  
  const bottomPadding = Platform.OS === 'ios' ? insets.bottom : 12;

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.background, shadowColor: 'transparent', elevation: 0 },
        headerTintColor: colors.text,
        tabBarStyle: {
          backgroundColor: colors.tabBarBg,
          borderTopColor: colors.border,
          elevation: 10,
          shadowColor: colors.cardShadow,
          shadowOpacity: 1,
          shadowOffset: { width: 0, height: -4 },
          shadowRadius: 10,
          borderTopWidth: 1,
          height: 60 + bottomPadding,
          paddingBottom: bottomPadding,
          paddingTop: 8,
        },
        tabBarActiveTintColor: colors.tabBarActive,
        tabBarInactiveTintColor: colors.tabBarInactive,
        tabBarIcon: ({ color }) => {
          if (route.name === 'Home') return <IconHome color={color} />;
          if (route.name === 'Daily') return <IconDaily color={color} />;
          if (route.name === 'Review') return <IconReview color={color} />;
          if (route.name === 'Friends') return <IconFriends color={color} />;
          if (route.name === 'More') return <IconMore color={color} />;
          return null;
        },
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
      <Tab.Screen name="Daily" component={DailyScreen} />
      <Tab.Screen name="Review" component={ReviewScreen} />
      <Tab.Screen name="Friends" component={FriendsStack} options={{ headerShown: false }} />
      <Tab.Screen name="More" component={MoreStack} options={{ headerShown: false }} />
    </Tab.Navigator>
  );
};

const styles = StyleSheet.create({
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
