import { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import type { PhotoFile } from 'react-native-vision-camera';
import MultiSelect from '../components/MultiSelect.tsx'
const standIns = [
  { id: '1', name: 'Plate', diameter: '28' },
  { id: '2', name: 'Bowl', diameter: '20' },
]

export default function MealScreen(path: PhotoFile)  {
    const [radialProfiles, setRadialProfiles] = useState(standIns);
    const [selectedIds, setSelectedIds] = useState<(string | number)[]>([]);
    
    const [max, setMax] = useState(1)

    /*
    useEffect(() => {
      setRadialProfiles(await retrieveDishware())
    }, [])
    */
    return (
      <>
        <View style={styles.container}>
          <Text style={styles.text}>Log Meal</Text>
        </View>
        <Image
          source={{ uri: `file://${path}` }}
          style={{ width: 300, height: 300 }}
          resizeMode="contain"
        />
        <View style={styles.container}>
          <Text style={styles.text}>Add Plateware Profiles</Text>
        </View>
        <View style={styles.pickerContainer}>
            <MultiSelect items={radialProfiles} value={selectedIds} onChange={setSelectedIds} max={max} />
        </View>
      </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  text: { fontSize: 20 },
  pickerContainer: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    marginTop: 8,
  },
});