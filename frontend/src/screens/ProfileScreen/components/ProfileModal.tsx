// src/screens/ProfileScreen/components/ProfileModal.tsx
import React, { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View,
} from 'react-native';
import type { Profile } from '../../../types';
import { CalibrateDishFlow } from './CalibrateDishFlow';

/**
 * Popup used for both adding and editing a bowl or plate profile.
 *  - profile = null  -> "Add a profile" (empty form)
 *  - profile = {...} -> "Edit profile" (filled in, with a Delete option that asks to confirm, and
 *                       a "Dish shape" section that calibrates the dish from an empty-dish photo)
 */
export function ProfileModal({
  visible, profile, canDelete, onSave, onDelete, onClose, onCalibrated,
}: {
  visible: boolean;
  profile: Profile | null;
  canDelete: boolean;                                   // false when it is the only profile left
  onSave: (label: string, diameterMeters: number) => void;
  onDelete: () => void;
  onClose: () => void;
  onCalibrated?: (profile: Profile) => void;            // called with the profile that now has a shape
}) {
  const [label, setLabel] = useState('');
  const [cm, setCm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [calibrating, setCalibrating] = useState(false);

  // Every time the popup opens, start from the profile being edited (or a blank form).
  useEffect(() => {
    if (!visible) return;
    setLabel(profile?.label ?? '');
    setCm(profile ? String(Math.round(profile.diameter * 1000) / 10) : '');
    setError(null);
    setConfirmingDelete(false);
    setCalibrating(false);
  }, [visible, profile]);

  const save = () => {
    const name = label.trim();
    const n = Number(cm.replace(',', '.'));
    if (!name) {
      setError('Give the profile a name.');
      return;
    }
    if (cm.trim() === '' || !Number.isFinite(n) || n < 5 || n > 80) {
      setError('The diameter must be between 5 and 80 cm.');
      return;
    }
    onSave(name, n / 100);   // stored in meters
  };

  // Calibration uses the diameter that is SAVED on the server, so unsaved edits would be ignored.
  const typedCm = Number(cm.replace(',', '.'));
  const hasUnsavedDiameter =
    !!profile && (!Number.isFinite(typedCm) || Math.abs(typedCm / 100 - profile.diameter) > 1e-6);

  const shapeStatus = profile?.shape
    ? `Calibrated, about ${Math.round(profile.shape.depthFrac * profile.diameter * 500)} mm deep`
    : 'Not calibrated yet';

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => (calibrating ? setCalibrating(false) : onClose())}
    >
      {calibrating && profile ? (
        <CalibrateDishFlow
          profile={profile}
          onCancel={() => setCalibrating(false)}
          onFinished={(updated) => {
            setCalibrating(false);
            onCalibrated?.(updated);   // puts the new shape into the app's state
            onClose();
          }}
        />
      ) : (
        <KeyboardAvoidingView
          style={styles.backdrop}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* tapping the dimmed area closes the popup */}
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />

          <View style={styles.card}>
            {confirmingDelete && profile ? (
              <>
                <Text style={styles.title}>Delete "{profile.label}"?</Text>
                <Text style={styles.body}>This can't be undone.</Text>
                <View style={styles.buttonRow}>
                  <Pressable style={styles.secondary} onPress={() => setConfirmingDelete(false)} accessibilityRole="button">
                    <Text style={styles.secondaryText}>Keep it</Text>
                  </Pressable>
                  <Pressable style={styles.danger} onPress={onDelete} accessibilityRole="button">
                    <Text style={styles.primaryText}>Delete</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={styles.title}>{profile ? 'Edit profile' : 'Add a profile'}</Text>

                <Text style={styles.label}>Name</Text>
                <TextInput
                  style={styles.input}
                  value={label}
                  onChangeText={(t) => { setLabel(t); setError(null); }}
                  placeholder="e.g. Cereal bowl"
                  maxLength={30}
                  autoFocus={!profile}
                  returnKeyType="next"
                  accessibilityLabel="Profile name"
                />

                <Text style={styles.label}>Outer diameter</Text>
                <View style={styles.inputWrap}>
                  <TextInput
                    style={[styles.input, styles.inputFlex]}
                    value={cm}
                    onChangeText={(t) => { setCm(t); setError(null); }}
                    placeholder="e.g. 20"
                    keyboardType="decimal-pad"
                    accessibilityLabel="Outer diameter in centimeters"
                  />
                  <Text style={styles.unit}>cm</Text>
                </View>
                <Text style={styles.hint}>
                  Measure the diameter of the bowl or plate. Try to be as accurate as possible.
                </Text>

                {/* dish shape: only for a profile that already exists */}
                {profile && onCalibrated ? (
                  <View style={styles.shapeBox}>
                    <Text style={styles.label}>Dish shape</Text>
                    <Text style={styles.shapeStatus}>{shapeStatus}</Text>
                    <Pressable
                      style={[styles.outline, hasUnsavedDiameter && styles.disabled]}
                      disabled={hasUnsavedDiameter}
                      onPress={() => setCalibrating(true)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.outlineText}>
                        {profile.shape ? 'Calibrate again' : 'Calibrate with an empty-dish photo'}
                      </Text>
                    </Pressable>
                    <Text style={styles.hint}>
                      {hasUnsavedDiameter
                        ? 'Save your change to the diameter first. Calibration uses the saved diameter.'
                        : 'Take one photo of the empty dish from above. Meals in this dish are then measured against its real shape.'}
                    </Text>
                  </View>
                ) : null}

                {error ? <Text style={styles.error}>{error}</Text> : null}

                <View style={styles.buttonRow}>
                  <Pressable style={styles.secondary} onPress={onClose} accessibilityRole="button">
                    <Text style={styles.secondaryText}>Cancel</Text>
                  </Pressable>
                  <Pressable style={styles.primary} onPress={save} accessibilityRole="button">
                    <Text style={styles.primaryText}>{profile ? 'Save' : 'Add'}</Text>
                  </Pressable>
                </View>
                

                {profile ? (
                  canDelete ? (
                    <Pressable style={styles.deleteLink} onPress={() => setConfirmingDelete(true)} accessibilityRole="button">
                      <Text style={styles.deleteText}>Delete profile</Text>
                    </Pressable>
                  ) : (
                    <Text style={styles.hint}>This is your only profile, so it can't be deleted.</Text>
                  )
                ) : null}
              </>
            )}
          </View>
        </KeyboardAvoidingView>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  card: {
    width: '100%',
    maxWidth: 420,
    padding: 20,
    borderRadius: 20,
    backgroundColor: '#ffffff',
    gap: 8,
  },

  title: { fontSize: 20, fontWeight: '700', color: '#1b2420', marginBottom: 4 },
  body: { fontSize: 15, color: '#66706b' },
  label: { fontSize: 13, color: '#66706b', marginTop: 6 },
  hint: { fontSize: 12, lineHeight: 17, color: '#66706b' },
  error: { fontSize: 13, color: '#c0392b' },

  input: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#f6f7f4',
    fontSize: 16,
    color: '#1b2420',
  },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  inputFlex: { flex: 1 },
  unit: { fontSize: 15, color: '#66706b', width: 28 },

  shapeBox: {
    marginTop: 8,
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#f6f7f4',
    gap: 6,
  },
  shapeStatus: { fontSize: 15, fontWeight: '600', color: '#1b2420' },
  outline: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#14634b',
    backgroundColor: '#ffffff',
  },
  outlineText: { fontSize: 15, fontWeight: '600', color: '#14634b' },
  disabled: { opacity: 0.4 },

  buttonRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  primary: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: '#14634b' },
  danger: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: '#c0392b' },
  secondary: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#dde3df',
  },
  primaryText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  secondaryText: { color: '#1b2420', fontSize: 16, fontWeight: '600' },

  deleteLink: { alignSelf: 'center', paddingVertical: 10 },
  deleteText: { fontSize: 14, color: '#c0392b' },
});