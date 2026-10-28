import { type Macro, Profile, Goals  } from './types'

// src/settings.ts
export const MACROS: { key: Macro; label: string }[] = [
  { key: 'protein', label: 'Protein' },
  { key: 'carbs', label: 'Carbs' },
  { key: 'fat', label: 'Fat' },
];

// One color per macro, used by the calendar (GoalCard uses the same values)
export const MACRO_COLORS: Record<Macro, string> = {
  protein: '#14634b',
  carbs: '#3a6ea5',
  fat: '#d9922e',
};

// diameter is the OUTER rim width in METERS (the pipeline works in meters)
export const DEFAULT_PROFILES: Profile[] = [
  { id: '1', label: 'Plate', diameter: 0.28 },
  { id: '2', label: 'Bowl', diameter: 0.2 },
];

export const DEFAULT_GOALS: Goals = { kcal: 2000, protein: 120, carbs: 220, fat: 65 };
