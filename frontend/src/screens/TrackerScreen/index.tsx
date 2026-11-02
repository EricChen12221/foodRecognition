import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import type { Goals, LoggedMeal } from '../../types';

import { Meals } from './components/Meals';
import { GoalCard, DEFAULT_GOALS } from './components/GoalCard';

export default function TrackerScreen({
  meals,
  goals = DEFAULT_GOALS,
  onDeleteMeal
}: {
  meals: LoggedMeal[];
  goals?: Goals;
  onDeleteMeal?: (meal: LoggedMeal) => void;
}) {
  return (
    <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      <GoalCard meals={meals} goals={goals} />
      <Meals meals={meals} onDelete={onDeleteMeal} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: 70,
    paddingHorizontal: 20,
    paddingBottom: 120,
    gap: 16,
  },
});