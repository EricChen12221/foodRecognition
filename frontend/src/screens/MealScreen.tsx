import React, { useEffect, useState } from 'react';
import { ActivityIndicator, View, Text, Pressable, Image, StyleSheet } from 'react-native';
import { useAsyncTask } from './helpers/useAsyncTask';

import macroHelper from '../services/macro.ts'
import MultiSelect from '../components/MultiSelect.tsx'

function LoadingView({ onCancel }: { onCancel: () => void }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <View style={styles.center}>
      <ActivityIndicator size="large" />
      <Text style={styles.title}>Analyzing your meal…</Text>
      <Text style={styles.hint}>
        {seconds < 15
          ? 'Finding the containers and foods in your photo.'
          : 'This can take a minute for large photos. Still working…'}
      </Text>
      <Pressable style={styles.secondary} onPress={onCancel} accessibilityRole="button">
        <Text style={styles.secondaryText}>Cancel</Text>
      </Pressable>
    </View>
  );
}

function ErrorView({ message, onRetry, onCancel }: {
  message: string; onRetry: () => void; onCancel: () => void;
}) {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>Couldn't analyze the photo</Text>
      <Text style={styles.hint}>{message}</Text>
      <Pressable style={styles.primary} onPress={onRetry} accessibilityRole="button">
        <Text style={styles.primaryText}>Try again</Text>
      </Pressable>
      <Pressable style={styles.secondary} onPress={onCancel} accessibilityRole="button">
        <Text style={styles.secondaryText}>Back</Text>
      </Pressable>
    </View>
  );
}

const standIns = [
  { id: '1', name: 'Plate', diameter: '28' },
  { id: '2', name: 'Bowl', diameter: '20' },
]

export default function MealSelectScreen({ path, plateDiameterM, onCancel }: {
  path: string;              // pass toFileUri(photo.<your path field>)
  plateDiameterM?: number;       // e.g. 0.26 once the user confirms the plate size
  onCancel: () => void;          // e.g. navigation.goBack
}) {
  const { status, data, error, run, cancel } = useAsyncTask(macroHelper.analyzeMeal);
  
  const [radialProfiles, setRadialProfiles] = useState(standIns);
  const [selectedIds, setSelectedIds] = useState<(string | number)[]>([]);
    
  const [max, setMax] = useState(1)

  useEffect(() => {
    run(path);
  }, [path, run]);

  const handleCancel = () => {
    cancel();
    onCancel();
  };

  if (status === 'idle' || status === 'loading') {
    return <LoadingView onCancel={handleCancel} />;
  }
  if (status === 'error' || data === null) {
    return (
      <ErrorView
        message={error ?? 'No result was returned.'}
        onRetry={() => run(path)}
        onCancel={handleCancel}
      />
    );
  }

  // Success: containers and foods are here. Put your selection UI
  // (one Picker per container, food list, ...) in place of this list.
  return (
    <>
      <View style={styles.container}>
        <Text style={styles.text}>Log Meal</Text>
      </View>
      <Image
        source={{ uri: `file://${path}` }}
        style={{ width: 300, height: 300 }}
        resizeMode="contain"
      />
      <View style={styles.container}>
        <Text style={styles.text}>Add Plateware Profiles</Text>
      </View>
      <View style={styles.pickerContainer}>
        <MultiSelect items={radialProfiles} value={selectedIds} onChange={setSelectedIds} max={max} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  content: { padding: 16, gap: 8 },
  title: { fontSize: 18, fontWeight: '600', textAlign: 'center' },
  spaced: { marginTop: 16 },
  hint: { fontSize: 14, color: '#666', textAlign: 'center' },
  row: { fontSize: 16, paddingVertical: 6 },
  primary: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8, backgroundColor: '#14634b' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondary: { paddingHorizontal: 20, paddingVertical: 10 },
  secondaryText: { color: '#14634b', fontSize: 16 },
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  text: { fontSize: 20 },
  pickerContainer: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    marginTop: 8,
  },
});