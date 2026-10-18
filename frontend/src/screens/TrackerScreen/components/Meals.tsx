import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { MealMacros } from '../../../types';

const r = (n: number) => Math.round(n);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function MealCard({ meal }: { meal: MealMacros }) {
  const { items, total } = meal;

  return (
    <View style={styles.card}>
      {/* total */}
      <View style={styles.totalBlock}>
        <Text style={styles.kcal}>{r(total.estimate.kcal)} kcal</Text>
        <Text style={styles.range}>
          about {r(total.low.kcal)} to {r(total.high.kcal)}
        </Text>
        <View style={styles.macroRow}>
          <Text style={styles.macro}>Protein {r(total.estimate.protein)} g</Text>
          <Text style={styles.macro}>Carbs {r(total.estimate.carbs)} g</Text>
          <Text style={styles.macro}>Fat {r(total.estimate.fat)} g</Text>
        </View>
      </View>

      <View style={styles.divider} />

      {/* items */}
      {items.map((item) => (
        <View key={item.id} style={styles.itemRow}>
          <View style={styles.itemName}>
            <Text style={styles.itemLabel}>{cap(item.id)}</Text>
            {item.macros ? (
              <Text style={styles.itemSub}>{r(item.macros.estimate.grams)} g</Text>
            ) : null}
          </View>
          {item.macros ? (
            <Text style={styles.itemKcal}>{r(item.macros.estimate.kcal)} kcal</Text>
          ) : (
            <Text style={styles.noEstimate}>no estimate</Text>
          )}
        </View>
      ))}
    </View>
  );
}

export function Meals({ meals }: { meals: MealMacros[] }) {
  if (meals.length === 0) {
    return <Text style={styles.empty}>No meals logged yet.</Text>;
  }
  return (
    <View style={styles.list}>
      {meals.map((m, i) => (
        <MealCard key={i} meal={m} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12 },
  empty: { fontSize: 14, color: '#66706b', textAlign: 'center', marginTop: '110%', justifyContent: 'center' },

  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dde3df',
    backgroundColor: '#ffffff',
    gap: 10,
  },

  totalBlock: { gap: 2 },
  kcal: { fontSize: 28, fontWeight: '700', color: '#1b2420' },
  range: { fontSize: 13, color: '#66706b' },
  macroRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 6 },
  macro: { fontSize: 14, color: '#1b2420' },

  divider: { height: 1, backgroundColor: '#dde3df' },

  itemRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemName: { flexDirection: 'row', alignItems: 'baseline', gap: 8, flexShrink: 1 },
  itemLabel: { fontSize: 16, fontWeight: '600', color: '#1b2420' },
  itemSub: { fontSize: 13, color: '#66706b' },
  itemKcal: { fontSize: 15, color: '#1b2420' },
  noEstimate: { fontSize: 14, fontStyle: 'italic', color: '#66706b' },
});