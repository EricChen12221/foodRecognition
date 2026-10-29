// src/screens/ProfileScreen/index.tsx
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AccountData } from '../../hooks/useAccount';

import { SideMenu } from './components/SideMenu';
import { EditSection } from './components/EditSection';
import { ProgressSection } from './components/ProgressSection';

type Section = 'edit' | 'progress';

const ITEMS: { key: Section; label: string; hint: string }[] = [
  { key: 'edit', label: 'Goals & profiles', hint: 'Daily targets and bowl sizes' },
  { key: 'progress', label: 'Progress', hint: 'See which goals you met' },
];

// Goals, profiles and daily totals live in App (see useAccount) and arrive here as props.
// This screen only keeps UI state: which section is showing and whether the menu is open.
export default function ProfileScreen({
  goals, profiles, days,
  changeGoal, resetGoals, addProfile, changeProfile, deleteProfile,
}: AccountData) {
  const [section, setSection] = useState<Section>('edit');
  const [menuOpen, setMenuOpen] = useState(false);

  const current = ITEMS.find((i) => i.key === section)!;

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          onPress={() => setMenuOpen(true)}
          style={styles.menuButton}
          accessibilityRole="button"
          accessibilityLabel="Open menu"
        >
          <View style={styles.bar} />
          <View style={styles.bar} />
          <View style={styles.bar} />
        </Pressable>
        <Text style={styles.title}>{current.label}</Text>
      </View>

      {section === 'edit' ? (
        <EditSection
          goals={goals}
          profiles={profiles}
          onGoalChange={changeGoal}
          onProfileAdd={addProfile}
          onProfileChange={changeProfile}
          onProfileDelete={deleteProfile}
          onResetGoals={resetGoals}
        />
      ) : (
        <ProgressSection goals={goals} days={days} />
      )}

      <SideMenu
        open={menuOpen}
        items={ITEMS}
        selected={section}
        onSelect={(key) => {
          setSection(key);
          setMenuOpen(false);
        }}
        onClose={() => setMenuOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#f6f7f4' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingTop: 62,
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dde3df',
  },
  bar: { width: 20, height: 2.5, borderRadius: 2, backgroundColor: '#1b2420' },
  title: { fontSize: 24, fontWeight: '700', color: '#1b2420' },
});