import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

const Tab = createBottomTabNavigator();

import StatementsScreen from './StatementsScreen';
import HomeScreen from './HomeScreen';
import ReviewScreen from './ReviewScreen';
import DailyScreen from './DailyScreen';
import LogsScreen from './LogsScreen';
import FriendsStack from './FriendsStack';

import SettingsScreen from './SettingsScreen';

export const TabNavigator = () => {
  return (
    <Tab.Navigator>
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Daily" component={DailyScreen} />
      <Tab.Screen name="Review" component={ReviewScreen} />
      <Tab.Screen name="Friends" component={FriendsStack} options={{ headerShown: false }} />
      <Tab.Screen name="Statements" component={StatementsScreen} />
      <Tab.Screen name="Logs" component={LogsScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
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
