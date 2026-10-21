import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { MealMacros } from '../../../types';

export type Goals = { kcal: number; protein: number; carbs: number; fat: number };

// Placeholder targets. Pass your own `goals` prop (e.g. from the Profile tab) to override.
export const DEFAULT_GOALS: Goals = { kcal: 2000, protein: 120, carbs: 220, fat: 65 };

const GREEN = '#14634b';
const AMBER = '#c27a12';   // used when a value goes over its goal

type Key = keyof Goals;

const r = (n: number) => Math.round(n);
const total = (meals: MealMacros[], key: Key) =>
  meals.reduce((t, m) => t + m.total.estimate[key], 0);

function Bar({ value, goal, color }: { value: number; goal: number; color: string }) {
  const pct = goal > 0 ? Math.min(value / goal, 1) : 0;
  return (
    <View style={styles.track}>
      <View
        style={[styles.fill, { width: `${pct * 100}%` as `${number}%`, backgroundColor: color }]}
      />
    </View>
  );
}

function MacroColumn({ label, value, goal }: { label: string; value: number; goal: number }) {
  const over = value > goal;
  return (
    <View style={styles.macro}>
      <Text style={styles.macroLabel}>{label}</Text>
      <Text style={styles.macroValue}>
        {r(value)}
        <Text style={styles.macroGoal}> / {goal} g</Text>
      </Text>
      <Bar value={value} goal={goal} color={over ? AMBER : GREEN} />
    </View>
  );
}

export function GoalCard({ meals, goals = DEFAULT_GOALS }: { meals: MealMacros[]; goals?: Goals }) {
  const kcal = total(meals, 'kcal');
  const protein = total(meals, 'protein');
  const carbs = total(meals, 'carbs');
  const fat = total(meals, 'fat');

  const left = goals.kcal - kcal;
  const over = left < 0;

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>Total calories</Text>
      <Text style={styles.kcal}>{r(kcal).toLocaleString()}</Text>

      <View style={styles.divider} />

      <View style={styles.macroRow}>
        <MacroColumn label="Protein" value={protein} goal={goals.protein} />
        <MacroColumn label="Carbs" value={carbs} goal={goals.carbs} />
        <MacroColumn label="Fat" value={fat} goal={goals.fat} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 20,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#dde3df',
    gap: 6,
  },
  eyebrow: { fontSize: 14, color: '#66706b' },
  kcal: { fontSize: 52, fontWeight: '800', color: '#1b2420', lineHeight: 58 },
  sub: { fontSize: 14, color: '#66706b', marginBottom: 6 },

  track: { height: 8, borderRadius: 4, backgroundColor: '#e6ebe7', overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },

  divider: { height: 1, backgroundColor: '#dde3df', marginVertical: 14 },

  macroRow: { flexDirection: 'row', gap: 14 },
  macro: { flex: 1, gap: 6 },
  macroLabel: { fontSize: 13, color: '#66706b' },
  macroValue: { fontSize: 20, fontWeight: '700', color: '#1b2420' },
  macroGoal: { fontSize: 12, fontWeight: '400', color: '#66706b' },
});