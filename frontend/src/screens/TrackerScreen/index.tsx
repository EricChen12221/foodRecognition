import React, { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { TabParamList, MealVolume } from '../../types/navigation';

let meals: MealVolume[][] = []

export default function TrackerScreen() {

  const route = useRoute<RouteProp<TabParamList, 'Tracker'>>();
  const navigation = useNavigation<any>();

  const newMeal = route.params?.volumes;

  useEffect(() => {
    if (!newMeal) return;
    meals.push(newMeal)
    navigation.setParams({ loggedMeal: undefined });  // used up, so it can't be added twice
  }, [newMeal]);

  return (
    <View style={styles.container}>
      <Text style={styles.text}>Tracker</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  text: { fontSize: 20 },
});