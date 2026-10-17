import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { createBottomTabNavigator, BottomTabBar, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { UpdateBanner } from '../components/UpdateBanner';
import { IconHome, IconDaily, IconReview, IconFriends, IconMore } from '../components/TabIcons';

import StatementsScreen from './StatementsScreen';
import HomeScreen from './HomeScreen';
import ReviewScreen from './ReviewScreen';
import DailyScreen from './DailyScreen';
import LogsScreen from './LogsScreen';
import FriendsStack from './FriendsStack';
import SettingsScreen from './SettingsScreen';
import CardsScreen from './CardsScreen';
import CardDetailScreen from './CardDetailScreen';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

const MoreStack = () => {
  const { colors } = useTheme();
  return (
    <Stack.Navigator screenOptions={{ headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text }}>
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Statements" component={StatementsScreen} />
      <Stack.Screen name="Logs" component={LogsScreen} />
      <Stack.Screen name="Cards" component={CardsScreen} options={{ title: 'Credit Cards' }} />
      <Stack.Screen name="CardDetail" component={CardDetailScreen} options={({ route }: any) => ({ title: route.params?.title || 'Card' })} />
    </Stack.Navigator>
  );
};

const renderTabBar = (props: BottomTabBarProps) => (
  <>
    <UpdateBanner />
    <BottomTabBar {...props} />
  </>
);

export const TabNavigator = () => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  
  const bottomPadding = insets.bottom > 0 ? insets.bottom : 12;

  return (
    <Tab.Navigator
      tabBar={renderTabBar}
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
