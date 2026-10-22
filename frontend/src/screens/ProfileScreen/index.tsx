// src/screens/ProfileScreen/index.tsx
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  DEFAULT_GOALS, DEFAULT_PROFILES,
  type DayTotals, type Goals, type Profile,
} from '../../settings';

import { SideMenu } from './components/SideMenu.tsx';
import { EditSection } from './components/EditSection.tsx';
import { ProgressSection, dayKey } from './components/ProgressSection.tsx';

type Section = 'edit' | 'progress';

const ITEMS: { key: Section; label: string; hint: string }[] = [
  { key: 'edit', label: 'Goals & profiles', hint: 'Daily targets and bowl sizes' },
  { key: 'progress', label: 'Progress', hint: 'See which goals you met' },
];


// SAMPLE DATA so you can see the calendar working. Delete this once the database supplies `days`.
function makeSampleDays(): Record<string, DayTotals> {
  const out: Record<string, DayTotals> = {};
  const now = new Date();
  for (let i = 0; i < 70; i++) {
    const dt = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const seed = dt.getDate() + dt.getMonth() * 7;
    const protein = 70 + ((seed * 17) % 80);
    const carbs = 150 + ((seed * 29) % 120);
    const fat = 40 + ((seed * 13) % 45);
    out[dayKey(dt.getFullYear(), dt.getMonth(), dt.getDate())] = {
      kcal: 4 * protein + 4 * carbs + 9 * fat,
      protein,
      carbs,
      fat,
    };
  }
  return out;
}

export default function ProfileScreen() {
  const [section, setSection] = useState<Section>('edit');
  const [menuOpen, setMenuOpen] = useState(false);

  const [goals, setGoals] = useState<Goals>(DEFAULT_GOALS);
  const [profiles, setProfiles] = useState<Profile[]>(DEFAULT_PROFILES);
  // TODO(db): replace with real daily totals, e.g. { "2026-10-22": { kcal, protein, carbs, fat } }
  const days = useMemo(makeSampleDays, []);

  // TODO(db): load saved values on mount
  // useEffect(() => { loadFromDb().then((d) => { setGoals(d.goals); setProfiles(d.profiles); }); }, []);

  const changeGoals = (next: Goals) => {
    setGoals(next);
  };
  const changeProfiles = (next: Profile[]) => {
    setProfiles(next);
  };

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
          onGoalsChange={changeGoals}
          profiles={profiles}
          onProfilesChange={changeProfiles}
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