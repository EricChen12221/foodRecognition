// src/screens/ProfileScreen/components/CalibrateDishFlow.tsx
//
// A full-screen flow that lives inside the profile popup, so nothing in App.tsx has to change:
//   camera -> preview (optional ruler depth) -> working -> result (with any warnings)
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions,
} from 'react-native';
import { Camera, useCameraDevice, useCameraPermission, usePhotoOutput } from 'react-native-vision-camera';
import type { Profile } from '../../../types';
import { calibrateProfile } from '../../../services/data';

type Step = 'camera' | 'preview' | 'working' | 'result';

export function CalibrateDishFlow({
  profile, onFinished, onCancel,
}: {
  profile: Profile;
  onFinished: (updated: Profile) => void;   // puts the new shape into the app's state and closes the popup
  onCancel: () => void;
}) {
  const device = useCameraDevice('back');
  const photoOutput = usePhotoOutput({});
  const { hasPermission, requestPermission } = useCameraPermission();
  const { width } = useWindowDimensions();

  const [step, setStep] = useState<Step>('camera');
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [depthText, setDepthText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ profile: Profile; warnings: string[] } | null>(null);

  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  const takePhoto = async () => {
    try {
      setError(null);
      const photo = await photoOutput.capturePhotoToFile({}, {});
      setPhotoPath(photo.filePath);
      setStep('preview');
    } catch {
      setError('Could not take the photo. Try again.');
    }
  };

  const upload = async () => {
    if (!photoPath) return;
    setError(null);
    setStep('working');
    const mm = Number(depthText.replace(',', '.'));
    try {
      const r = await calibrateProfile(profile.id, photoPath, Number.isFinite(mm) && mm > 0 ? mm : undefined);
      setResult(r);
      setStep('result');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep('preview');                       // keep the photo so they can retry or retake
    }
  };

  // working
  if (step === 'working') {
    return (
      <View style={[styles.root, styles.light, styles.center]}>
        <ActivityIndicator size="large" />
        <Text style={styles.title}>Measuring the dish…</Text>
        <Text style={styles.body}>This takes about 20 seconds.</Text>
      </View>
    );
  }

  // result
  if (step === 'result' && result) {
    const saved = result.profile;
    const mm = saved.shape ? Math.round(saved.shape.depthFrac * saved.diameter * 500) : null;
    return (
      <View style={[styles.root, styles.light, styles.center]}>
        <Text style={styles.title}>{result.warnings.length ? 'Saved, with a warning' : 'Dish calibrated'}</Text>
        {mm !== null ? <Text style={styles.body}>Measured inside depth: about {mm} mm</Text> : null}
        {result.warnings.map((w, i) => (
          <Text key={i} style={styles.warning}>{w}</Text>
        ))}
        {result.warnings.length ? (
          <Text style={styles.body}>You can keep it, or calibrate again with a clearer photo.</Text>
        ) : (
          <Text style={styles.body}>Meals served in this dish will now use its real shape.</Text>
        )}
        <Pressable style={styles.primary} onPress={() => onFinished(saved)} accessibilityRole="button">
          <Text style={styles.primaryText}>Done</Text>
        </Pressable>
      </View>
    );
  }

  // preview
  if (step === 'preview' && photoPath) {
    return (
      <View style={[styles.root, styles.dark]}>
        <Image
          source={{ uri: photoPath.startsWith('file://') ? photoPath : `file://${photoPath}` }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
        />
        <View style={styles.previewPanel}>
          <Text style={styles.panelTitle}>Is the whole dish empty and in view?</Text>
          <Text style={styles.panelHint}>
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
            <Text style={styles.panelHint}>mm</Text>
          </View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.buttonRow}>
            <Pressable
              style={styles.secondary}
              onPress={() => { setPhotoPath(null); setError(null); setStep('camera'); }}
              accessibilityRole="button"
            >
              <Text style={styles.secondaryText}>Retake</Text>
            </Pressable>
            <Pressable style={styles.primaryFlex} onPress={upload} accessibilityRole="button">
              <Text style={styles.primaryText}>{error ? 'Try again' : 'Use this photo'}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  // camera
  if (!hasPermission) {
    return (
      <View style={[styles.root, styles.light, styles.center]}>
        <Text style={styles.title}>Camera access needed</Text>
        <Text style={styles.body}>Allow the camera so the app can photograph the empty dish.</Text>
        <Pressable style={styles.primary} onPress={() => Linking.openSettings()} accessibilityRole="button">
          <Text style={styles.primaryText}>Open Settings</Text>
        </Pressable>
        <Pressable style={styles.linkBtn} onPress={onCancel} accessibilityRole="button">
          <Text style={styles.linkText}>Cancel</Text>
        </Pressable>
      </View>
    );
  }
  if (device == null) {
    return (
      <View style={[styles.root, styles.light, styles.center]}>
        <Text style={styles.title}>No camera available</Text>
        <Pressable style={styles.primary} onPress={onCancel} accessibilityRole="button">
          <Text style={styles.primaryText}>Close</Text>
        </Pressable>
      </View>
    );
  }

  const guide = width * 0.86;
  return (
    <View style={[styles.root, styles.dark]}>
      <Camera style={StyleSheet.absoluteFill} device={device} isActive outputs={[photoOutput]} />

      {/* a ring to line the dish up with */}
      <View pointerEvents="none" style={styles.guideWrap}>
        <View style={{ width: guide, height: guide, borderRadius: guide / 2, borderWidth: 2, borderColor: 'rgba(255,255,255,0.75)' }} />
      </View>

      <View style={styles.topBar}>
        <Pressable onPress={onCancel} hitSlop={10} accessibilityRole="button">
          <Text style={styles.topBarText}>Cancel</Text>
        </Pressable>
      </View>

      <View style={styles.hintBox}>
        <Text style={styles.hintText}>
          Empty {profile.label.toLowerCase()}, straight from above, filling the ring. Plain surface, no shadows
          across the dish.
        </Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>

      <View style={styles.shutterWrap}>
        <Pressable style={styles.shutter} onPress={takePhoto} accessibilityLabel="Take photo" />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  dark: { backgroundColor: '#000' },
  light: { backgroundColor: '#f6f7f4' },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },

  title: { fontSize: 20, fontWeight: '700', color: '#1b2420', textAlign: 'center' },
  body: { fontSize: 15, color: '#66706b', textAlign: 'center' },
  warning: { fontSize: 14, lineHeight: 20, color: '#c27a12', textAlign: 'center' },
  error: { fontSize: 13, color: '#ff8a80', textAlign: 'center' },

  primary: { marginTop: 8, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 12, backgroundColor: '#14634b' },
  primaryFlex: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: '#14634b' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondary: {
    flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.5)',
  },
  secondaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  linkBtn: { paddingVertical: 10 },
  linkText: { fontSize: 15, color: '#14634b' },

  guideWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 62, paddingHorizontal: 20, paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  topBarText: { color: '#fff', fontSize: 17 },
  hintBox: {
    position: 'absolute', left: 20, right: 20, bottom: 150, padding: 12, borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.55)', gap: 4,
  },
  hintText: { color: '#fff', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  shutterWrap: { position: 'absolute', bottom: 50, width: '100%', alignItems: 'center' },
  shutter: {
    width: 80, height: 80, borderRadius: 40, borderWidth: 5,
    backgroundColor: 'rgba(230,229,229,0.93)', borderColor: 'rgba(230,229,229,0.93)',
  },

  previewPanel: {
    position: 'absolute', left: 0, right: 0, bottom: 0, padding: 20, paddingBottom: 40, gap: 10,
    backgroundColor: 'rgba(0,0,0,0.75)',
  },
  panelTitle: { color: '#fff', fontSize: 18, fontWeight: '700' },
  panelHint: { color: '#c9d1cc', fontSize: 13, lineHeight: 18 },
  depthRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  depthInput: {
    width: 100, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.12)', color: '#fff', fontSize: 16,
  },
  buttonRow: { flexDirection: 'row', gap: 10, marginTop: 6 },
});