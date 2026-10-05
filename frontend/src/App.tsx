import CameraIcon from './assets/CameraIcon.tsx'
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  StatusBar,
  StyleSheet,
  useColorScheme,
  View,
  Text,
  Button,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  usePhotoOutput,
} from 'react-native-vision-camera';

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  const device = useCameraDevice('back');
  const photoOutput = usePhotoOutput({});
  const { hasPermission, requestPermission } = useCameraPermission();

  const [useCam, setUseCam] = useState(false);

  const openCamera = async () => {
    if (hasPermission) {
      setUseCam(true);
      return;
    }

    const granted = await requestPermission();
    if (granted) {
      setUseCam(true);
    } else {
      Alert.alert(
        'Camera access needed',
        'Turn on camera access in Settings to take photos.',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open Settings', onPress: () => Linking.openSettings() },
        ],
      );
    }
  };

  const takePhoto = async () => {
    try {
      const { filePath } = await photoOutput.capturePhotoToFile({}, {});
      console.log('Photo saved at:', filePath);
    } catch (e) {
      console.log('Failed to take photo', e);
    }
  };

  if (useCam) {
    if (device == null) {
      Alert.alert(
        'Camera Unavailable',
        'We couldn\’t access a camera on this device. You can continue without using the camera.',
        [
          {
            text: 'Continue',
            style: 'default',
          },
        ],
      );
      setUseCam(false)
      return
    }

    return (
      <SafeAreaProvider>
        <StatusBar barStyle="light-content" />
        <Camera
          style={StyleSheet.absoluteFill}
          device={device}
          isActive={true}
          outputs={[photoOutput]}
        />
        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.captureButton} onPress={takePhoto} />
        </View>
        <View style={styles.closeContainer}>
          <Button title="Close" color="white" onPress={() => setUseCam(false)} />
        </View>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      {useCam && device && <Camera
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={true}
        outputs={[photoOutput]}
      />}
      {!useCam && <View style={styles.buttonContainer}>
      <TouchableOpacity style={styles.useCamButton} onPress={openCamera}>
        <CameraIcon size={48} color="black" fillColor="white" />
      </TouchableOpacity>
    </View>}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    textAlign: 'center',
    fontSize: 16,
  },
  buttonContainer: {
    position: 'absolute',
    bottom: 50,
    width: '100%',
    alignItems: 'center',
  },
  closeContainer: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: '100%',
    height: '110',
    backgroundColor: 'rgba(2, 2, 2, 0.6)',
    alignItems: 'flex-end',
    paddingRight: '10',
    paddingTop: '65'
  },
  useCamButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(2, 2, 2, 0.93)',
    borderWidth: 5,
    borderColor: 'rgba(3, 3, 3, 0.93)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 8,
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(230, 229, 229, 0.93)',
    borderWidth: 5,
    borderColor: 'rgba(230, 229, 229, 0.93)',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 8,
  },
});

export default App;