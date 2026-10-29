// src/screens/ProfileScreen/components/EditSection.tsx
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import type { Profile, Goals } from '../../../types';

/** Numeric input that only saves on blur, and puts the old value back if the text is invalid. */
function NumberField({
  label, unit, value, min, max, onCommit,
}: {
  label: string; unit: string; value: number; min: number; max: number;
  onCommit: (n: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);

  const commit = () => {
    const n = Number(text.replace(',', '.'));
    if (text.trim() !== '' && Number.isFinite(n) && n >= min && n <= max) {
      onCommit(n);
    } else {
      setText(String(value));
    }
  };

  return (
    <View style={styles.fieldRow}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.inputWrap}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          onEndEditing={commit}
          keyboardType="decimal-pad"
          selectTextOnFocus
          accessibilityLabel={label}
        />
        <Text style={styles.unit}>{unit}</Text>
      </View>
    </View>
  );
}

function NameField({ value, onCommit }: { value: string; onCommit: (s: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); }, [value]);

  const commit = () => {
    const t = text.trim();
    if (t) onCommit(t);
    else setText(value);
  };

  return (
    <TextInput
      style={styles.nameInput}
      value={text}
      onChangeText={setText}
      onEndEditing={commit}
      placeholder="Name"
      maxLength={30}
      returnKeyType="done"
      accessibilityLabel="Profile name"
    />
  );
}

// This screen only draws the form and asks before destructive actions.
// The parent decides what each change does (here: save it through the API).
export function EditSection({
  goals, profiles, onGoalChange, onProfileAdd, onProfileChange, onProfileDelete, onResetGoals,
}: {
  goals: Goals;
  profiles: Profile[];
  onGoalChange: (key: keyof Goals, value: number) => void;
  onProfileAdd: () => void;
  onProfileChange: (id: string, patch: { label?: string; diameter?: number }) => void;
  onProfileDelete: (id: string) => void;
  onResetGoals: () => void;
}) {
  const removeProfile = (p: Profile) => {
    if (profiles.length <= 1) {
      Alert.alert('Keep at least one profile', 'You need a profile to choose from when you log a meal.');
      return;
    }
    Alert.alert(`Delete "${p.label}"?`, undefined, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onProfileDelete(p.id) },
    ]);
  };

  const resetGoals = () =>
    Alert.alert('Reset goals to defaults?', 'Your bowl profiles are not changed.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Reset', style: 'destructive', onPress: onResetGoals },
    ]);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      automaticallyAdjustKeyboardInsets
      showsVerticalScrollIndicator={false}
    >
      {/* ---------------- goals ---------------- */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Daily goals</Text>
        <View style={styles.card}>
          <NumberField label="Calories" unit="kcal" value={goals.kcal} min={500} max={10000} onCommit={(n) => onGoalChange('kcal', n)} />
          <View style={styles.rule} />
          <NumberField label="Protein" unit="g" value={goals.protein} min={1} max={500} onCommit={(n) => onGoalChange('protein', n)} />
          <View style={styles.rule} />
          <NumberField label="Carbs" unit="g" value={goals.carbs} min={1} max={1000} onCommit={(n) => onGoalChange('carbs', n)} />
          <View style={styles.rule} />
          <NumberField label="Fat" unit="g" value={goals.fat} min={1} max={400} onCommit={(n) => onGoalChange('fat', n)} />
        </View>
      </View>

      {/* ---------------- bowl profiles ---------------- */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Bowl and plate profiles</Text>
        <Text style={styles.hint}>
          Enter the width across the outer rim, from edge to edge. Portion sizes scale with the cube of
          this number, so a few centimeters off makes a big difference. Measure with a ruler if you can.
        </Text>

        {profiles.map((p) => (
          <View key={p.id} style={styles.card}>
            <NameField value={p.label} onCommit={(label) => onProfileChange(p.id, { label })} />
            <View style={styles.rule} />
            <NumberField
              label="Outer diameter"
              unit="cm"
              value={Math.round(p.diameter * 1000) / 10}
              min={5}
              max={80}
              onCommit={(cm) => onProfileChange(p.id, { diameter: cm / 100 })}
            />
            <Pressable onPress={() => removeProfile(p)} style={styles.deleteBtn} accessibilityRole="button">
              <Text style={styles.deleteText}>Delete profile</Text>
            </Pressable>
          </View>
        ))}

        <Pressable onPress={onProfileAdd} style={styles.addBtn} accessibilityRole="button">
          <Text style={styles.addText}>Add a profile</Text>
        </Pressable>
      </View>

      <Pressable onPress={resetGoals} style={styles.resetBtn} accessibilityRole="button">
        <Text style={styles.resetText}>Reset goals to defaults</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingTop: 8, paddingHorizontal: 20, paddingBottom: 140, gap: 24 },

  section: { gap: 10 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#1b2420' },
  hint: { fontSize: 13, lineHeight: 19, color: '#66706b' },

  card: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#dde3df',
    backgroundColor: '#ffffff',
  },
  rule: { height: 1, backgroundColor: '#eef1ef' },

  fieldRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  fieldLabel: { fontSize: 16, color: '#1b2420' },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  input: {
    minWidth: 76,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#f6f7f4',
    textAlign: 'right',
    fontSize: 16,
    color: '#1b2420',
  },
  unit: { width: 34, fontSize: 14, color: '#66706b' },

  nameInput: { paddingVertical: 12, fontSize: 17, fontWeight: '600', color: '#1b2420' },

  deleteBtn: { alignSelf: 'flex-start', paddingVertical: 12 },
  deleteText: { fontSize: 14, color: '#c0392b' },

  addBtn: {
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#14634b',
    alignItems: 'center',
  },
  addText: { fontSize: 16, fontWeight: '600', color: '#14634b' },

  resetBtn: { alignItems: 'center', paddingVertical: 8 },
  resetText: { fontSize: 14, color: '#66706b' },
});