import React, { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { TabParamList, MealMacros } from '../../types';

import { Meals } from './components/Meals';   // adjust the path
import macroHelper from '../../services/macro.ts'

export default function TrackerScreen() {

  const route = useRoute<RouteProp<TabParamList, 'Tracker'>>();
  const navigation = useNavigation<any>();

  const newMeal = route.params?.volumes;

  const [meals, setMeals] = useState<MealMacros[]>([]);
  const handledRef = useRef<typeof newMeal>(undefined);

  useEffect(() => {
    if (!newMeal || handledRef.current === newMeal) return;
    handledRef.current = newMeal;
    navigation.setParams({ loggedMeal: undefined });

    (async () => {
      try {
        const meal = await macroHelper.convertToMacros(newMeal);
        setMeals((prev) => [...prev, meal]);
      } catch (e) {
        Alert.alert("Couldn't calculate macros", e instanceof Error ? e.message : String(e));
      }
    })();
  }, [newMeal]);

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