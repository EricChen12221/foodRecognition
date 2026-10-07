import React, { useState } from 'react';
import { Modal, View, Text, Pressable, FlatList, StyleSheet } from 'react-native';

export type Id = string | number;

export interface SelectItem {
  id: Id;
  name: string;
}

interface MultiSelectProps {
  items: SelectItem[];
  value: Id[];
  onChange: (ids: Id[]) => void;
  placeholder?: string;
  /** Optional cap on how many items can be selected. */
  max?: number;
}

export default function MultiSelect({
  items,
  value,
  onChange,
  placeholder = 'Select a type...',
  max,
}: MultiSelectProps) {
  const [open, setOpen] = useState<boolean>(false);
  const selected = new Set<Id>(value);
  const selectedItems = items.filter((i) => selected.has(i.id));

  const toggle = (id: Id): void => {
    const next = new Set<Id>(selected);
    if (next.has(id)) {
      next.delete(id);
    } else if (!max || next.size < max) {
      next.add(id);
    }
    onChange(Array.from(next));
  };

  return (
    <View>
      {/* Field that looks like a dropdown */}
      <Pressable
        style={styles.field}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={placeholder}
      >
        {selectedItems.length === 0 ? (
          <Text style={styles.placeholder}>{placeholder}</Text>
        ) : (
          <View style={styles.chips}>
            {selectedItems.map((item) => (
              <Pressable
                key={String(item.id)}
                style={styles.chip}
                onPress={() => toggle(item.id)}
                accessibilityLabel={`Remove ${item.name}`}
              >
                <Text style={styles.chipText}>{item.name}  ✕</Text>
              </Pressable>
            ))}
          </View>
        )}
        <Text style={styles.caret}>▾</Text>
      </Pressable>

      {/* Full list in a modal */}
      <Modal
        visible={open}
        animationType="slide"
        transparent
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.header}>
              <Text style={styles.title}>
                {max ? `Choose up to ${max}` : 'Choose one or more'}
              </Text>
              <Pressable onPress={() => setOpen(false)} accessibilityRole="button">
                <Text style={styles.done}>Done</Text>
              </Pressable>
            </View>

            <FlatList<SelectItem>
              data={items}
              extraData={value}
              keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => {
                const isOn = selected.has(item.id);
                const locked = !isOn && !!max && selected.size >= max;
                return (
                  <Pressable
                    style={[styles.row, locked && styles.rowLocked]}
                    onPress={() => toggle(item.id)}
                    disabled={locked}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: isOn, disabled: locked }}
                  >
                    <Text style={styles.rowText}>{item.name}</Text>
                    <Text style={styles.check}>{isOn ? '✓' : ''}</Text>
                  </Pressable>
                );
              }}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#c9c9c9',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  placeholder: { flex: 1, color: '#888', fontSize: 16 },
  chips: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    backgroundColor: '#e6f2ee',
  },
  chipText: { color: '#14634b', fontSize: 14 },
  caret: { marginLeft: 8, color: '#666', fontSize: 16 },

  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    maxHeight: '70%',
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 24,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ddd',
  },
  title: { fontSize: 16, fontWeight: '600' },
  done: { fontSize: 16, color: '#14634b', fontWeight: '600' },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  rowLocked: { opacity: 0.4 },
  rowText: { fontSize: 16 },
  check: { fontSize: 18, color: '#14634b' },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: '#eee' },
});