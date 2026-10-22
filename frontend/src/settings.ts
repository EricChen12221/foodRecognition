export type Goals = { kcal: number; protein: number; carbs: number; fat: number };

export type Profile = { id: string; label: string; diameter: number };

export const DEFAULT_GOALS: Goals = { kcal: 2000, protein: 120, carbs: 220, fat: 65 };

export const DEFAULT_PROFILES: Profile[] = [
  { id: '1', label: 'Plate', diameter: 0.28 },
  { id: '2', label: 'Bowl', diameter: 0.15 },
];