import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Profile, Container } from '../../../types'


type Props = {
  containers: Container[];
  profiles: Profile[];
  onChoose: (containerId: string, profileId: string) => void;
};

// One card per detected container: thumbnail, title, and a row of profile chips.
export default function ContainerProfileList({ containers, profiles, onChoose }: Props) {
  return (
    <View style={styles.list}>
      {containers.map((c, i) => (
        <View key={c.id} style={styles.card}>
          <View style={styles.cardHeader}>
            {c.thumbnail ? (
              <Image
                source={{ uri: `data:image/jpeg;base64,${c.thumbnail}` }}
                style={styles.thumb}
              />
            ) : (
              <View style={[styles.thumb, styles.thumbEmpty]} />
            )}
            <Text style={styles.cardTitle}>Profile {i + 1}</Text>
          </View>

          <View style={styles.chips}>
            {profiles.map((p) => {
              const selected = c.radial_profile?.id === p.id;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => onChoose(c.id, p.id)}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {p.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: 12, marginTop: 8 },
  card: {
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#dde3df',
    backgroundColor: '#ffffff',
    gap: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: { width: 56, height: 56, borderRadius: 10, backgroundColor: '#e6ebe7' },
  thumbEmpty: { borderWidth: 1, borderColor: '#dde3df' },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#1b2420' },

  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#dde3df',
    backgroundColor: '#f6f7f4',
  },
  chipSelected: { backgroundColor: '#14634b', borderColor: '#14634b' },
  chipText: { fontSize: 14, color: '#1b2420' },
  chipTextSelected: { color: '#ffffff', fontWeight: '600' },
});