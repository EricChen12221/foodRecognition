import 'react-native-gesture-handler'; // first line

import React, { useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  StatusBar,
  StyleSheet,
  useColorScheme,
  View,
  Text,
  Image,
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
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { PhotoFile } from 'react-native-vision-camera';

import ProfileScreen from './screens/ProfileScreen.tsx'
import TrackerScreen from './screens/TrackerScreen.tsx'
import MealScreen from './screens/MealScreen.tsx'

import { floatingTabBar } from './tabBarStyle';

import { TrackerIcon, ProfileIcon } from './assets/TabIcons';
import CameraIcon from './assets/CameraIcon.tsx'

const Tab = createBottomTabNavigator();

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  const device = useCameraDevice('back');
  const photoOutput = usePhotoOutput({});
  const { hasPermission, requestPermission } = useCameraPermission();

  const [useCam, setUseCam] = useState(false);
  const [photoTaken, setPhotoTaken] = useState(false);

  const [filePath, setFilePath] = useState<PhotoFile | undefined>()
  const [imageChosen, setImageChosen] = useState(false)

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
      setFilePath(await photoOutput.capturePhotoToFile({}, {}));
      console.log('Photo saved at:', filePath);
      setPhotoTaken(true)
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
    if (!photoTaken) {
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
    } else {
      return (
        <>
          {filePath && (
            <SafeAreaProvider>
              <StatusBar barStyle="light-content" />
              <Image
                source={{ uri: `file://${filePath.filePath}` }}
                style={{ width: '100%', height: '100%' }}
              />
              <View style={styles.useContainer}>
                <Button
                  title="Use"
                  color="white"
                  onPress={() => {
                    setUseCam(false);
                    setPhotoTaken(false);
                    setImageChosen(true)
                  }}
                />
                <Button
                  title="Retake"
                  color="rgb(253, 209, 77)"
                  onPress={() => {
                    setUseCam(true);
                    setPhotoTaken(false);
                    setFilePath(undefined);
                  }}
                />
                <View style={styles.closeLastItem}>
                  <Button
                    title="Close"
                    color="white"
                    onPress={() => {
                      setUseCam(false);
                      setPhotoTaken(false);
                      setFilePath(undefined);
                    }}
                  />
                </View>
              </View>
            </SafeAreaProvider>
          )}
        </>
      );
    }
  }

  if (imageChosen && filePath) {
    return (
    <MealScreen
      key={filePath.filePath}
      path={filePath.filePath}
      onCancel={() => { setImageChosen(false); setFilePath(undefined); }}
    />
  );
  }

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: 'black',
            tabBarItemStyle: { justifyContent: 'center' },
            tabBarStyle: floatingTabBar,
            tabBarLabelStyle: { fontSize: 14, fontWeight: '600' },
          }}
        >
          <Tab.Screen
            name="Tracker"
            component={TrackerScreen}
            options={{
              tabBarIcon: ({ color, size }) => <TrackerIcon color={color} size={size} />,
            }}
          />
          <Tab.Screen
            name="Profile"
            component={ProfileScreen}
            options={{
              tabBarIcon: ({ color, size }) => <ProfileIcon color={color} size={size} />,
            }}
          />
        </Tab.Navigator>
      </NavigationContainer>
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
  closeLastItem: {
    marginLeft: 'auto',
  },
  useContainer: {
    position: 'absolute',
    top: 0,
    right: 0,
    alignItems: 'center',
    display: 'flex',
    flexDirection: 'row',
    gap: '15',
    width: '100%',
    height: '110',
    backgroundColor: 'rgba(2, 2, 2, 0.6)',
    paddingRight: '10',
    paddingLeft: '15',
    paddingTop: '65',
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