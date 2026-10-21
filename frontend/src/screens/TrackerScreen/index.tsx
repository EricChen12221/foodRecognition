import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import type { MealMacros } from '../../types';

import { Meals } from './components/Meals';
import { GoalCard, DEFAULT_GOALS, type Goals } from './components/GoalCard';

export default function TrackerScreen({
  meals,
  goals = DEFAULT_GOALS,
}: {
  meals: MealMacros[];
  goals?: Goals;
}) {
  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <GoalCard meals={meals} goals={goals} />
      <Meals meals={meals} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 70,
    paddingHorizontal: 20,
    paddingBottom: 120,   // room for the floating tab bar
    gap: 16,
  },
});