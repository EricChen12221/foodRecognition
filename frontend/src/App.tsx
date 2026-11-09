import 'react-native-gesture-handler'; // first line

import React, { useEffect, useState, useCallback } from 'react';
import {
  Alert,
  Text,
  StatusBar,
  ActivityIndicator,
  StyleSheet,
  useColorScheme,
  View,
  TouchableOpacity,
  Button
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { PhotoFile } from 'react-native-vision-camera';

import ProfileScreen from './screens/ProfileScreen/index.tsx'
import TrackerScreen from './screens/TrackerScreen/index.tsx'
import ContainerScreen from './screens/ContainerScreen'

import { floatingTabBar } from './tabBarStyle';

import { TrackerIcon, ProfileIcon } from './assets/TabIcons';
import CameraIcon from './assets/CameraIcon.tsx'

import macroHelper from './services/macro.ts';
import { signInAutomatically, type Session} from './services/session'
import { addMeal, deleteMeal, toMealItems } from './services/data'

import { dayKey } from './screens/ProfileScreen/components/ProgressSection'

import type { MealVolume, SavedMeal, DailyMacros } from './types';
import { useAccount } from './hooks/useAccount';

import { CameraCapture } from './shared/CameraCapture'



const Tab = createBottomTabNavigator();

function App() {
  const isDarkMode = useColorScheme() === 'dark';

  const [useCam, setUseCam] = useState(false);
  const [photoPath, setPhotoPath] = useState<string>('');
  const [imageChosen, setImageChosen] = useState(false)

  const [meals, setMeals] = useState<SavedMeal[]>([]);

  const [session, setSession] = useState<Session | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);

  const todayKey = () => {
    const n = new Date();
    return dayKey(n.getFullYear(), n.getMonth(), n.getDate());
  };

  const signIn = useCallback(() => {
    setSignInError(null);
    signInAutomatically()
      .then(setSession)
      .catch((e) => setSignInError(e instanceof Error ? e.message : String(e)));
  }, []); 

  useEffect(() => { signIn(); }, [signIn]);

  const account = useAccount(session);

  useEffect(() => {
    if (!session) return;
    const day = (session.account.dailyMacros as DailyMacros[]).find((d) => d.date === todayKey());
    setMeals(day?.meals ?? []);
  }, [session]);

  if (!session) {
    return (
      <View style={styles.centered}>
        {signInError ? (
          <>
            <Text style={styles.text}>{signInError}</Text>
            <Button title="Try again" onPress={signIn} />
          </>
        ) : (
          <ActivityIndicator size="large" />
        )}
      </View>
    );
  }

  const mealNameForNow = () => {
    const h = new Date().getHours()
    return h < 11 ? 'Breakfast' : h < 15 ? 'Lunch' : h < 21 ? 'Dinner' : 'Snack'
  }

  const handleLogged = async (volumes: MealVolume[]) => {
    setImageChosen(false)
    setPhotoPath('')
    try {
      const macros = await macroHelper.convertToMacros(volumes)
      const foods = toMealItems(macros)
      if (foods.length === 0) {
        Alert.alert('No estimate', "None of the foods could be estimated, so nothing was saved.")
        return
      }
      const { meal, day } = await addMeal({ date: todayKey(), name: mealNameForNow(), foods })
      account.recordDay(day.date, day)
      setMeals((prev) => [...prev, meal])
    } catch (e) {
      Alert.alert("Couldn't save the meal", e instanceof Error ? e.message : String(e))
    }
  }

  const handleDeleteMeal = async (meal: SavedMeal) => {
    try {
      const { day } = await deleteMeal(todayKey(), meal._id)
      if (day) account.recordDay(day.date, day)
      else account.removeDay(todayKey())
      setMeals((prev) => prev.filter((m) => m._id !== meal._id))
    } catch (e) {
      Alert.alert("Couldn't remove the meal", e instanceof Error ? e.message : String(e))
    }
  }

  if (useCam) {
    return (
    <CameraCapture
      onUse={(path: string) => {
        setPhotoPath(path)          // keep the photo
        setUseCam(false)            // leave the camera
        setImageChosen(true)        // go on to the meal screen
      }}
      onCancel={() => setUseCam(false)}
    />
    )
  }

  if (imageChosen && photoPath) {
    return (
    <ContainerScreen
      key={photoPath}
      path={photoPath}
      onCancel={() => { setImageChosen(false); setPhotoPath(''); }}
      onLogged={handleLogged}
      profiles={account.profiles}
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
            options={{
              tabBarIcon: ({ color, size }) => <TrackerIcon color={color} size={size} />,
            }}>
            {() => <TrackerScreen meals={meals} goals={account.goals} onDeleteMeal={handleDeleteMeal} />}
          </Tab.Screen>
          <Tab.Screen
            name="Profile"
            options={{
              tabBarIcon: ({ color, size }) => <ProfileIcon color={color} size={size} />,
            }}
          >
            {() => <ProfileScreen {...account} />}
          </Tab.Screen>
        </Tab.Navigator>
      </NavigationContainer>
      <StatusBar barStyle={isDarkMode ? 'light-content' : 'dark-content'} />
      <View style={styles.buttonContainer}>
        <TouchableOpacity style={styles.useCamButton} onPress={() => setUseCam(true)}>
          <CameraIcon size={48} color="black" fillColor="white" />
        </TouchableOpacity>
      </View>
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