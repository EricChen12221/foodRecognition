// src/hooks/useCameraCapture.ts
import { useCallback, useEffect, useState } from 'react';
import { useCameraDevice, useCameraPermission, usePhotoOutput } from 'react-native-vision-camera';

/**
 * Everything about taking a photo that has nothing to do with how it looks:
 * the back camera, the permission, the photo output, and the capture call.
 * Each component that calls this gets its OWN copy (a hook shares code, not state). That is fine here,
 * because only one camera screen is ever on screen at a time.
 */

export function useCameraCapture() {
  const device = useCameraDevice('back');
  const photoOutput = usePhotoOutput({});
  const { hasPermission, requestPermission } = useCameraPermission();

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ask once, when a camera screen opens.
  useEffect(() => {
    if (!hasPermission) requestPermission();
  }, [hasPermission, requestPermission]);

  /** Returns the saved photo's file path, or null if it failed or a capture is already running. */
  const takePhoto = useCallback(async (): Promise<string | null> => {
    if (busy) return null;                         // ignore a second tap while the first is saving
    setBusy(true);
    setError(null);
    try {
      const photo = await photoOutput.capturePhotoToFile({}, {});
      return photo.filePath;
    } catch {
      setError('Could not take the photo. Try again.');
      return null;
    } finally {
      setBusy(false);
    }
  }, [busy, photoOutput]);

  return { device, photoOutput, hasPermission, takePhoto, busy, error };
}