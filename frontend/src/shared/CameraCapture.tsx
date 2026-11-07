// src/components/CameraCapture.tsx
//
// One full-screen "take a photo" screen, used by both the meal flow (App.tsx) and the dish
// calibration flow. It owns the camera, so the screen that shows it needs no camera code at all.
// While it is mounted the camera is on; when it unmounts the camera is released.
import React from 'react';
import {
  Linking, Pressable, StatusBar, StyleSheet, Text, View, useWindowDimensions,
} from 'react-native';
import { Camera } from 'react-native-vision-camera';
import { useCameraCapture } from '../hooks/useCameraCapture';

export function CameraCapture({
  onCapture, onCancel, hint, guide = false,
}: {
  onCapture: (filePath: string) => void;   // called with the saved photo's path
  onCancel: () => void;
  hint?: string;                           // short instruction shown over the picture
  guide?: boolean;                         // draw a ring to line a round dish up with
}) {
  const { device, photoOutput, hasPermission, takePhoto, busy, error } = useCameraCapture();
  const { width } = useWindowDimensions();

  const shoot = async () => {
    const path = await takePhoto();
    if (path) onCapture(path);
  };

  if (!hasPermission) {
    return (
      <View style={[styles.root, styles.light, styles.center]}>
        <Text style={styles.title}>Camera access needed</Text>
        <Text style={styles.body}>Turn on camera access in Settings to take photos.</Text>
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
        <Text style={styles.body}>We couldn't access a camera on this device.</Text>
        <Pressable style={styles.primary} onPress={onCancel} accessibilityRole="button">
          <Text style={styles.primaryText}>Close</Text>
        </Pressable>
      </View>
    );
  }

  const ring = width * 0.86;
  return (
    <View style={[styles.root, styles.dark]}>
      <StatusBar barStyle="light-content" />
      <Camera style={StyleSheet.absoluteFill} device={device} isActive outputs={[photoOutput]} />

      {guide ? (
        <View pointerEvents="none" style={styles.guideWrap}>
          <View
            style={{
              width: ring, height: ring, borderRadius: ring / 2,
              borderWidth: 2, borderColor: 'rgba(255,255,255,0.75)',
            }}
          />
        </View>
      ) : null}

      <View style={styles.topBar}>
        <Pressable onPress={onCancel} hitSlop={10} accessibilityRole="button">
          <Text style={styles.topBarText}>Cancel</Text>
        </Pressable>
      </View>

      {hint || error ? (
        <View style={styles.hintBox}>
          {hint ? <Text style={styles.hintText}>{hint}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
      ) : null}

      <View style={styles.shutterWrap}>
        <Pressable
          style={[styles.shutter, busy && styles.shutterBusy]}
          onPress={shoot}
          disabled={busy}
          accessibilityLabel="Take photo"
        />
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
  error: { fontSize: 13, color: '#ff8a80', textAlign: 'center' },

  primary: { marginTop: 8, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 12, backgroundColor: '#14634b' },
  primaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  linkBtn: { paddingVertical: 10 },
  linkText: { fontSize: 15, color: '#14634b' },

  guideWrap: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingTop: 62, paddingHorizontal: 20, paddingBottom: 12,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  topBarText: { color: '#fff', fontSize: 17 },
  hintBox: {
    position: 'absolute', left: 20, right: 20, bottom: 150,
    padding: 12, borderRadius: 12, backgroundColor: 'rgba(0,0,0,0.55)', gap: 4,
  },
  hintText: { color: '#fff', fontSize: 14, lineHeight: 20, textAlign: 'center' },

  shutterWrap: { position: 'absolute', bottom: 50, width: '100%', alignItems: 'center' },
  shutter: {
    width: 80, height: 80, borderRadius: 40, borderWidth: 5,
    backgroundColor: 'rgba(230,229,229,0.93)', borderColor: 'rgba(230,229,229,0.93)',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 6, elevation: 8,
  },
  shutterBusy: { opacity: 0.5 },
});