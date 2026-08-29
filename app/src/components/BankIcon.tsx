import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { bankStyleFor } from '../constants/banks';

interface Props {
  bank: string | null | undefined;
  size?: number;
}

const BankIcon = ({ bank, size = 32 }: Props) => {
  const style = bankStyleFor(bank);

  if (style.logo) {
    return (
      <View style={[styles.logoWrap, { width: size * 1.6, height: size }]}>
        <SvgXml xml={style.logo} width="100%" height="100%" />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.circle,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: style.color },
      ]}
    >
      <Text style={[styles.code, { fontSize: size * 0.3 }]} numberOfLines={1} adjustsFontSizeToFit>
        {style.code}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  circle: { alignItems: 'center', justifyContent: 'center' },
  logoWrap: { alignItems: 'center', justifyContent: 'center' },
  code: { color: '#fff', fontWeight: '700' },
});

export default BankIcon;
