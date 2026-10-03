/**
 * Sample React Native App
 * https://github.com/facebook/react-native
 *
 * @format
 */

import React, { useEffect } from 'react';
import { NewAppScreen } from '@react-native/new-app-screen';
import { StatusBar, StyleSheet, useColorScheme, View, Text } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import {Camera, useCameraDevice, useCameraPermission,} from 'react-native-vision-camera';

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  const device = useCameraDevice('back');
  const { hasPermission, requestPermission } = useCameraPermission();

  if (!hasPermission) {
    return (
      <View>
        <Text>Camera permission is required.</Text>

        {/* Add a button here to call requestPermission() */}
      </View>
    );
  }

  if (device == null) {
    return (
      <View>
        <Text>No camera available</Text>
      </View>
    );
  }

  if (device == null) {
    return (
      <View>
        <Text>No camera available</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <AppContent />
      <Camera
        style={{ flex: 1 }}
        device={device}
        isActive={true}
      />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const safeAreaInsets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      <NewAppScreen
        templateFileName="App.tsx"
        safeAreaInsets={safeAreaInsets}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default App;
