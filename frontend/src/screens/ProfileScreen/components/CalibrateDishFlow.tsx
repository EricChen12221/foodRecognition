// src/screens/ProfileScreen/components/CalibrateDishFlow.tsx
//
// Lives inside the profile popup. The camera and the Use/Retake review are CameraCapture's job.
// This file only adds what is specific to calibrating: an optional ruler depth, the upload, a
// "measuring" overlay, and the result.
import React, { useState, useRef, useEffect } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { CameraCapture } from '../../../shared/CameraCapture';
import type { Profile } from '../../../types';
import { calibrateProfile } from '../../../services/data';

export function CalibrateDishFlow({
  profile, onFinished, onCancel,
}: {
  profile: Profile;
  onFinished: (updated: Profile) => void;   // puts the new shape into the app's state and closes the popup
  onCancel: () => void;
}) {
  const [depthText, setDepthText] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ profile: Profile; warnings: string[] } | null>(null);
  const requestId = useRef(0);                       // lets us ignore a result that arrives after cancel
  const abortRef = useRef<AbortController | null>(null);

  // if the popup closes mid-upload, abort and don't touch state afterwards
  useEffect(() => () => { requestId.current++; abortRef.current?.abort(); }, []);

  const upload = async (photoPath: string) => {
    Keyboard.dismiss();
    const mm = Number(depthText.replace(',', '.'));
    const myId = ++requestId.current;
    const controller = new AbortController();
    abortRef.current = controller;

    setError(null);
    setWorking(true);
    try {
      const res = await calibrateProfile(
        profile.id, photoPath,
        Number.isFinite(mm) && mm > 0 ? mm : undefined,
        controller.signal,
      );
      if (myId !== requestId.current) return;        // cancelled
      setResult(res);
    } catch (e) {
      if (myId !== requestId.current) return;        // cancelled, so no error message
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (myId === requestId.current) setWorking(false);
    }
  };

  const cancelMeasuring = () => {
    requestId.current++;                             // invalidates the in-flight call
    abortRef.current?.abort();
    setWorking(false);                               // back to the review screen
  };

  // result
  if (result) {
    const saved = result.profile;
    const mm = saved.shape ? Math.round(saved.shape.depthFrac * saved.diameter * 500) : null;
    return (
      <View style={[styles.root, styles.light, styles.center]}>
        <Text style={styles.title}>{result.warnings.length ? 'Saved, with a warning' : 'Dish calibrated'}</Text>
        {mm !== null ? <Text style={styles.body}>Measured inside depth: about {mm} mm</Text> : null}
        {result.warnings.map((w, i) => (
          <Text key={i} style={styles.warning}>{w}</Text>
        ))}
        <Text style={styles.body}>
          {result.warnings.length
            ? 'You can keep it, or calibrate again with a clearer photo.'
            : 'Meals served in this dish will now use its real shape.'}
        </Text>
        <Pressable style={styles.primary} onPress={() => onFinished(saved)} accessibilityRole="button">
          <Text style={styles.primaryText}>Done</Text>
        </Pressable>
      </View>
    );
  }

  // camera, review, upload
  return (
    <View style={styles.root}>
      <CameraCapture
        guide
        hint={`Empty ${profile.label.toLowerCase()}, straight from above, filling the ring. Plain surface, no shadows across the dish.`}
        useLabel={error ? 'Try again' : 'Use this photo'}
        onUse={upload}
        onCancel={onCancel}
        previewNote={error}
        previewExtra={
          <View style={styles.extra}>
            <Text style={styles.extraTitle}>Is the whole dish empty and in view?</Text>
            <Text style={styles.extraHint}>
              Optional: measure the inside depth (floor to rim) with a ruler and enter it, so the app can
              check its own result.
            </Text>
            <View style={styles.depthRow}>
              <TextInput
                style={styles.depthInput}
                value={depthText}
                onChangeText={setDepthText}
                placeholder="e.g. 47"
                placeholderTextColor="#8a948f"
                keyboardType="decimal-pad"
                accessibilityLabel="Inside depth in millimeters"
              />
              <Text style={styles.extraHint}>mm</Text>
            </View>
          </View>
        }
      />

      {/* covers the review screen while the photo is being measured, so nothing can be tapped */}
      {working ? (
        <View style={[StyleSheet.absoluteFill, styles.light, styles.center]}>
          <ActivityIndicator size="large" />
          <Text style={styles.title}>Measuring the dish…</Text>
          <Text style={styles.body}>This takes about 20 seconds.</Text>
          <Pressable style={styles.secondary} onPress={cancelMeasuring} accessibilityRole="button">
            <Text style={styles.secondaryText}>Cancel</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  light: { backgroundColor: '#f6f7f4' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },

  title: { fontSize: 20, fontWeight: '700', color: '#1b2420', textAlign: 'center' },
  body: { fontSize: 15, color: '#66706b', textAlign: 'center' },
  warning: { fontSize: 14, lineHeight: 20, color: '#c27a12', textAlign: 'center' },

  primary: { marginTop: 8, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 12, backgroundColor: '#14634b' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondary: { marginTop: 8, paddingHorizontal: 28, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: '#14634b' },
secondaryText: { color: '#14634b', fontSize: 16, fontWeight: '600' },

  extra: { gap: 8 },
  extraTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  extraHint: { color: '#c9d1cc', fontSize: 13, lineHeight: 18 },
  depthRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  depthInput: {
    width: 100, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 16,
  },
});