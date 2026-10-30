// src/screens/ContainerScreen/components/FoodList.tsx
import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import PencilIcon from '../../../assets/PencilIcon';   // adjust to where you saved PencilIcon.tsx

import type { Food } from '../../../types'

type Props = {
  foods: Food[];
  // newLabel = the new name, or null to go back to the detected name
  onRename: (id: number, newLabel: string | null) => void;
};

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function FoodCard({ food, onRename }: { food: Food; onRename: Props['onRename'] }) {
  const shown = food.newLabel ?? food.label;
  const edited = food.newLabel !== undefined;

  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(shown);

  const startEditing = () => {
    setText(shown);
    setEditing(true);
  };

  // Runs when the keyboard closes, whether by pressing Done or tapping elsewhere.
  const finish = () => {
    setEditing(false);
    const next = text.trim().toLowerCase();
    if (!next || next === shown) return;                       // blank or unchanged: keep what we had
    onRename(food.id, next === food.label ? null : next);      // typing the original name back clears the edit
  };

  return (
    <View style={styles.card}>
      {food.thumbnail ? (
        <Image source={{ uri: `data:image/jpeg;base64,${food.thumbnail}` }} style={styles.thumb} />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty]} />
      )}

      <View style={styles.textCol}>
        {editing ? (
          <TextInput
            style={styles.nameInput}
            value={text}
            onChangeText={setText}
            onEndEditing={finish}
            autoFocus
            selectTextOnFocus
            maxLength={40}
            autoCapitalize="none"
            returnKeyType="done"
            accessibilityLabel="Food name"
          />
        ) : (
          <Text style={styles.name} numberOfLines={1}>{cap(shown)}</Text>
        )}

        {edited && !editing ? (
          <View style={styles.editedRow}>
            <Text style={styles.editedText} numberOfLines={1}>Detected as {cap(food.label)}</Text>
            <Pressable onPress={() => onRename(food.id, null)} hitSlop={8} accessibilityRole="button">
              <Text style={styles.resetText}>Reset</Text>
            </Pressable>
          </View>
        ) : null}
      </View>

      {!editing ? (
        <Pressable
          onPress={startEditing}
          style={styles.pencilBtn}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={`Rename ${shown}`}
        >
          <PencilIcon />
        </Pressable>
      ) : null}
    </View>
  );
}

export default function FoodList({ foods, onRename }: Props) {
  return (
    <View style={styles.list}>
      {foods.map((f) => (
        <FoodCard key={f.id} food={f} onRename={onRename} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12, marginTop: 8 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dde3df',
    backgroundColor: '#ffffff',
  },
  thumb: { width: 56, height: 56, borderRadius: 10, backgroundColor: '#e6ebe7' },
  thumbEmpty: { borderWidth: 1, borderColor: '#dde3df' },

  textCol: { flex: 1, gap: 3 },
  name: { fontSize: 17, fontWeight: '600', color: '#1b2420' },
  nameInput: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#f6f7f4',
    fontSize: 17,
    fontWeight: '600',
    color: '#1b2420',
  },
  editedRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  editedText: { flexShrink: 1, fontSize: 12, color: '#66706b' },
  resetText: { fontSize: 12, fontWeight: '600', color: '#14634b' },

  pencilBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f6f7f4',
  },
});