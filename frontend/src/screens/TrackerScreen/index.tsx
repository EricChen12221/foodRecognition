import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import type { MealMacros } from '../../types';

import { Meals } from './components/Meals';   // adjust the path

export default function TrackerScreen({ meals }: { meals: MealMacros[] }) {
  return (
    <ScrollView contentContainerStyle={{ padding: 20 }}>
      <Meals meals={meals} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  text: { fontSize: 20 },
});