import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAsyncTask } from '../helpers/useAsyncTask.ts';

import ContainerProfileList, { type Container, Profile } from './components/ContainerProfileList.tsx';
import type { MealVolume } from '../../types.ts'

import macroHelper from '../../services/macro.ts'

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

function NoFoodsView({ onCancel }: {
  onCancel: () => void;
}) {
  return (
    <View style={styles.center}>
      <Text style={styles.title}>No Foods were found</Text>
      <Text style={styles.primaryText}>Please try again</Text>
      <Pressable style={styles.secondary} onPress={onCancel} accessibilityRole="button">
        <Text style={styles.secondaryText}>Back</Text>
      </Pressable>
    </View>
  );
}

const standIns: Profile[] = [
  { id: '1', label: 'Plate', diameter: 0.28 },
  { id: '2', label: 'Bowl', diameter: 0.2 },
];

export default function ContainerScreen({ path, onCancel, onLogged }: {
  path: string;              
  onCancel: () => void;  
  onLogged: (volumes: MealVolume[]) => void;  
}) {
  const { status, data, error, run, cancel } = useAsyncTask(macroHelper.analyzeMeal);
  const [radialProfiles] = useState(standIns);

  // The user's profile pick per container id, merged onto the detected containers.
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => { setChoices({}); }, [data]);

  const containers: Container[] = (data?.containers ?? []).map((c) => ({
    ...c,
    radial_profile: radialProfiles.find((p) => p.id === choices[c.id]),
  }));

  const allChosen = containers.length > 0 && containers.every((c) => c.radial_profile);

  useEffect(() => {
    run(path);
  }, [path, run]);

  const handleCancel = () => {
    cancel();
    onCancel();
  };

  async function handleEstimate() {
    if (!data) return;
    setSubmitting(true);
    let step = 'estimateMeal';
    try {
      const { volumes } = await macroHelper.estimateMeal(
        data.session_id,
        containers.map(({ id, radial_profile }) => ({ id, radial_profile })),
      );
      
      step = 'onLogged';
      onLogged(volumes);
    } catch (e) {
      Alert.alert(`Failed at ${step}`, e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

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
  if(data.foods.length == 0) {
    return (
      <NoFoodsView 
        onCancel={handleCancel}
      />
    )
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.screenContent}
      showsVerticalScrollIndicator={false}
    >
      <Text style={styles.title}>Log meal</Text>

      <View style={styles.photoCard}>
        <Image
          source={{ uri: `file://${path}` }}
          style={styles.photo}
          resizeMode="cover"
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Plateware profiles</Text>
        <Text style={styles.sectionHint}>
          Choose the profile for each plate, bowl, or cup so portions are measured accurately.
        </Text>

        {containers.length === 0 ? (
          <Text style={styles.sectionHint}>No plates detected.</Text>
        ) : (
          <ContainerProfileList
            containers={containers}
            profiles={radialProfiles}
            onChoose={(cid, pid) => setChoices((prev) => ({ ...prev, [cid]: pid }))}
          />
        )}
      </View>

      <Pressable
        style={[styles.primary, (!allChosen || submitting) && styles.primaryDisabled]}
        disabled={!allChosen || submitting}
        onPress={handleEstimate}
        accessibilityRole="button"
      >
        <Text style={styles.primaryText}>{submitting ? 'Estimating…' : 'Estimate portions'}</Text>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  hint: { fontSize: 14, color: '#666', textAlign: 'center' },
  primary: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 8, backgroundColor: '#14634b' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  primaryDisabled: { opacity: 0.4 },
  secondary: { paddingHorizontal: 20, paddingVertical: 10 },
  secondaryText: { color: '#14634b', fontSize: 16 },

  screen: { flex: 1, backgroundColor: '#f6f7f4', paddingTop: 30 },
  screenContent: { padding: 20, paddingBottom: 40, gap: 20 },

  title: { fontSize: 18, fontWeight: '700', color: '#1b2420' },

  photoCard: {
    borderRadius: 20,
    overflow: 'hidden',
    backgroundColor: '#e6ebe7',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  photo: { width: '100%', aspectRatio: 4 / 3 },

  section: { gap: 6 },
  sectionTitle: { fontSize: 18, fontWeight: '600', color: '#1b2420' },
  sectionHint: { fontSize: 14, lineHeight: 20, color: '#66706b' },
});