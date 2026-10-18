import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import type { MealMacros } from '../../types';

import { Meals } from './components/Meals';   // adjust the path

export default function TrackerScreen({ meals }: { meals: MealMacros[] }) {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Meals meals={meals} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingTop: '70', width: '100%' },
  text: { fontSize: 20 },
});