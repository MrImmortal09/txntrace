import React from 'react';
import Svg, { Path, Circle, Rect, Polyline, Line } from 'react-native-svg';

interface IconProps {
  color: string;
  size?: number;
}

// Shared by the tab bar and the first-run tutorial, which points at each tab.
export const IconHome = ({ color, size = 24 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><Polyline points="9 22 9 12 15 12 15 22" /></Svg>
);
export const IconDaily = ({ color, size = 24 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><Line x1="16" y1="2" x2="16" y2="6" /><Line x1="8" y1="2" x2="8" y2="6" /><Line x1="3" y1="10" x2="21" y2="10" /></Svg>
);
export const IconReview = ({ color, size = 24 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><Polyline points="14 2 14 8 20 8" /><Line x1="16" y1="13" x2="8" y2="13" /><Line x1="16" y1="17" x2="8" y2="17" /><Polyline points="10 9 9 9 8 9" /></Svg>
);
export const IconFriends = ({ color, size = 24 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><Circle cx="9" cy="7" r="4" /><Path d="M23 21v-2a4 4 0 0 0-3-3.87" /><Path d="M16 3.13a4 4 0 0 1 0 7.75" /></Svg>
);
export const IconMore = ({ color, size = 24 }: IconProps) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><Circle cx="12" cy="12" r="1" /><Circle cx="19" cy="12" r="1" /><Circle cx="5" cy="12" r="1" /></Svg>
);
