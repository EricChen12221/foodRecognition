import React from 'react';
import { View } from 'react-native';

export default function PencilIcon({ size = 20, color = '#1b2420' }: { size?: number; color?: string }) {
  const w = size * 0.24;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '45deg' }] }}>
      <View style={{ width: w, height: size * 0.16, backgroundColor: color, borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />
      <View style={{ width: w, height: size * 0.46, backgroundColor: color, marginTop: 1.5 }} />
      <View
        style={{
          width: 0, height: 0, marginTop: 1.5,
          borderLeftWidth: w / 2, borderRightWidth: w / 2, borderTopWidth: size * 0.2,
          borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: color,
        }}
      />
    </View>
  );
}