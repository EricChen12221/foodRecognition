// src/screens/ProfileScreen/components/ProgressSection.tsx
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MACROS, MACRO_COLORS, type DayTotals, type Goals } from '../../../settings';

// A macro counts as "met" when the day's total reaches this share of its goal.
// Change this, or isMet below, if you want a different rule (e.g. "within 10% either way" for fat).
const MET_AT = 0.9;
export const isMet = (value: number, goal: number) => goal > 0 && value >= goal * MET_AT;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_HEADERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const pad = (n: number) => String(n).padStart(2, '0');
/** Key used for the `days` data: "YYYY-MM-DD" (month is 0-based, like JavaScript's Date). */
export const dayKey = (y: number, m: number, d: number) => `${y}-${pad(m + 1)}-${pad(d)}`;

export function ProgressSection({
  goals, days,
}: {
  goals: Goals;
  days: Record<string, DayTotals>;   // "YYYY-MM-DD" -> totals for that day
}) {
  const now = new Date();
  const todayKey = dayKey(now.getFullYear(), now.getMonth(), now.getDate());

  const [cursor, setCursor] = useState(new Date(now.getFullYear(), now.getMonth(), 1));
  const [selected, setSelected] = useState(todayKey);

  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const leading = new Date(y, m, 1).getDay();          // blank cells before the 1st
  const count = new Date(y, m + 1, 0).getDate();       // days in this month

  const cells: (number | null)[] = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: count }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);
  const rows = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));

  const shift = (delta: number) => setCursor(new Date(y, m + delta, 1));

  const [sy, sm, sd] = selected.split('-').map(Number);
  const selectedDate = new Date(sy, sm - 1, sd);
  const selectedLabel = `${WEEKDAYS_SHORT[selectedDate.getDay()]}, ${MONTHS_SHORT[sm - 1]} ${sd}`;
  const sel = days[selected];

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* ---------------- calendar ---------------- */}
      <View style={styles.card}>
        <View style={styles.monthRow}>
          <Pressable onPress={() => shift(-1)} style={styles.arrow} accessibilityLabel="Previous month">
            <Text style={styles.arrowText}>‹</Text>
          </Pressable>
          <Text style={styles.monthTitle}>{MONTHS[m]} {y}</Text>
          <Pressable onPress={() => shift(1)} style={styles.arrow} accessibilityLabel="Next month">
            <Text style={styles.arrowText}>›</Text>
          </Pressable>
        </View>

        <View style={styles.weekRow}>
          {WEEKDAY_HEADERS.map((w, i) => (
            <Text key={i} style={styles.weekday}>{w}</Text>
          ))}
        </View>

        {rows.map((row, ri) => (
          <View key={ri} style={styles.weekRow}>
            {row.map((d, ci) => {
              if (d === null) return <View key={ci} style={styles.cell} />;

              const k = dayKey(y, m, d);
              const t = days[k];
              const isSelected = k === selected;
              const isToday = k === todayKey;

              return (
                <Pressable
                  key={ci}
                  style={[styles.cell, isSelected && styles.cellSelected]}
                  onPress={() => setSelected(k)}
                  accessibilityLabel={`${MONTHS[m]} ${d}`}
                >
                  <Text style={[styles.dayNum, isToday && styles.dayToday]}>{d}</Text>
                  <View style={styles.dots}>
                    {t
                      ? MACROS.map(({ key }) => {
                          const met = isMet(t[key], goals[key]);
                          return (
                            <View
                              key={key}
                              style={[
                                styles.dot,
                                met
                                  ? { backgroundColor: MACRO_COLORS[key], borderColor: MACRO_COLORS[key] }
                                  : styles.dotOff,
                              ]}
                            />
                          );
                        })
                      : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        ))}

        {/* legend */}
        <View style={styles.legend}>
          {MACROS.map(({ key, label }) => (
            <View key={key} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: MACRO_COLORS[key], borderColor: MACRO_COLORS[key] }]} />
              <Text style={styles.legendText}>{label}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.legendHint}>
          A filled dot means that macro reached {Math.round(MET_AT * 100)}% of its goal. An empty dot means it did not.
        </Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.detailTitle}>{selectedLabel}</Text>
        {sel ? (
          <>
            <Text style={styles.detailKcal}>
              {Math.round(sel.kcal).toLocaleString()}
              <Text style={styles.detailKcalSub}> of {goals.kcal.toLocaleString()} kcal</Text>
            </Text>
            <View style={styles.rule} />
            {MACROS.map(({ key, label }) => {
              const met = isMet(sel[key], goals[key]);
              return (
                <View key={key} style={styles.detailRow}>
                  <View style={[styles.dot, { backgroundColor: MACRO_COLORS[key], borderColor: MACRO_COLORS[key] }]} />
                  <Text style={styles.detailLabel}>{label}</Text>
                  <Text style={styles.detailValue}>
                    {Math.round(sel[key])} / {goals[key]} g
                  </Text>
                  <Text style={[styles.detailStatus, { color: met ? MACRO_COLORS[key] : '#66706b' }]}>
                    {met ? 'Met' : 'Not met'}
                  </Text>
                </View>
              );
            })}
          </>
        ) : (
          <Text style={styles.empty}>Nothing logged on this day.</Text>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingTop: 8, paddingHorizontal: 20, paddingBottom: 140, gap: 16 },

  card: {
    padding: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dde3df',
    backgroundColor: '#ffffff',
    gap: 6,
  },

  monthRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  monthTitle: { fontSize: 18, fontWeight: '700', color: '#1b2420' },
  arrow: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  arrowText: { fontSize: 28, color: '#14634b', lineHeight: 30 },

  weekRow: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', fontSize: 12, color: '#66706b', paddingBottom: 4 },

  cell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    minHeight: 48,
  },
  cellSelected: { borderColor: '#14634b', backgroundColor: '#f2f8f5' },
  dayNum: { fontSize: 14, color: '#1b2420' },
  dayToday: { fontWeight: '800', color: '#14634b' },

  dots: { flexDirection: 'row', gap: 3, marginTop: 5, height: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5 },
  dotOff: { backgroundColor: 'transparent', borderColor: '#c9d1cc' },

  legend: { flexDirection: 'row', gap: 16, marginTop: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { fontSize: 13, color: '#1b2420' },
  legendHint: { fontSize: 12, lineHeight: 17, color: '#66706b' },

  detailTitle: { fontSize: 16, fontWeight: '700', color: '#1b2420' },
  detailKcal: { fontSize: 32, fontWeight: '800', color: '#1b2420' },
  detailKcalSub: { fontSize: 14, fontWeight: '400', color: '#66706b' },
  rule: { height: 1, backgroundColor: '#eef1ef', marginVertical: 6 },
  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  detailLabel: { flex: 1, fontSize: 15, color: '#1b2420' },
  detailValue: { fontSize: 15, color: '#1b2420' },
  detailStatus: { width: 62, textAlign: 'right', fontSize: 13, fontWeight: '600' },
  empty: { fontSize: 14, color: '#66706b' },
});