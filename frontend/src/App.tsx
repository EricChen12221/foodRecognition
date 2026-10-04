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
      return (
        <View style={styles.centered}>
          <Text style={styles.text}>No camera available</Text>
          <Button title="Close" onPress={() => setUseCam(false)} />
        </View>
      );
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
      <TouchableOpacity style={styles.captureButton} onPress={openCamera}>
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
    top: 60,
    right: 20,
  },
  captureButton: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'black',
    borderWidth: 5,
    borderColor: 'rgba(0, 0, 0, 0.3)',
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