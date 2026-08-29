import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import FriendsScreen from './FriendsScreen';
import FriendDetailScreen from './FriendDetailScreen';

const Stack = createNativeStackNavigator();

export const FriendsStack = () => (
  <Stack.Navigator>
    <Stack.Screen name="FriendsList" component={FriendsScreen} options={{ headerShown: false }} />
    <Stack.Screen
      name="FriendDetail"
      component={FriendDetailScreen}
      options={({ route }: any) => ({ title: route.params?.contactName ?? 'Friend' })}
    />
  </Stack.Navigator>
);

export default FriendsStack;
