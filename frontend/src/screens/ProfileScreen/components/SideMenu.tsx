// src/screens/ProfileScreen/components/SideMenu.tsx
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

const MENU_WIDTH = 270;

type Item<T extends string> = { key: T; label: string; hint?: string };

export function SideMenu<T extends string>({
  open, items, selected, onSelect, onClose,
}: {
  open: boolean;
  items: Item<T>[];
  selected: T;
  onSelect: (key: T) => void;
  onClose: () => void;
}) {
  const progress = useRef(new Animated.Value(0)).current;   // 0 = closed, 1 = open
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) setMounted(true);
    Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: 220,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !open) setMounted(false);   // stop covering the screen once it's closed
    });
  }, [open, progress]);

  if (!mounted) return null;

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [-MENU_WIDTH, 0] });
  const scrimOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.35] });

  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: '#000', opacity: scrimOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close menu" />
      </Animated.View>

      <Animated.View style={[styles.panel, { transform: [{ translateX }] }]}>
        <Text style={styles.heading}>Menu</Text>
        {items.map((item) => {
          const active = item.key === selected;
          return (
            <Pressable
              key={item.key}
              onPress={() => onSelect(item.key)}
              style={[styles.item, active && styles.itemActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <View style={[styles.accent, active && styles.accentActive]} />
              <View style={styles.itemText}>
                <Text style={[styles.label, active && styles.labelActive]}>{item.label}</Text>
                {item.hint ? <Text style={styles.hint}>{item.hint}</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    width: MENU_WIDTH,
    paddingTop: 70,
    paddingHorizontal: 14,
    backgroundColor: '#ffffff',
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 16,
    shadowOffset: { width: 4, height: 0 },
    elevation: 12,
  },
  heading: { fontSize: 13, color: '#66706b', paddingHorizontal: 10, paddingBottom: 8 },

  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingRight: 10,
    borderRadius: 12,
  },
  itemActive: { backgroundColor: '#eaf3ef' },
  accent: { width: 4, height: 28, borderRadius: 2, marginHorizontal: 8, backgroundColor: 'transparent' },
  accentActive: { backgroundColor: '#14634b' },
  itemText: { flex: 1, gap: 2 },
  label: { fontSize: 16, fontWeight: '600', color: '#1b2420' },
  labelActive: { color: '#14634b' },
  hint: { fontSize: 12, color: '#66706b' },
});