export type Macros = { grams: number; kcal: number; protein: number; fat: number; carbs: number };
export type MacroRange = { estimate: Macros; low: Macros; high: Macros };

export type Goals = { kcal: number; protein: number; carbs: number; fat: number };

// What was actually eaten on one day (same fields as Goals)
export type DayTotals = { kcal: number; protein: number; carbs: number; fat: number };

export type Macro = 'protein' | 'carbs' | 'fat';

export type MealMacros = {
  items: { id: string; label: string; macros: MacroRange | null }[];
  total: MacroRange;
  unknown: string[];
};

export type MealVolume = {
  id: string;                   // for combined entries this is the label itself
  count?: number;               // how many detections were combined, if you use combine_by_label
  volume_ml?: number | null;
  volume_ml_low?: number | null;
  volume_ml_high?: number | null;
};

export type Profile = {
  id: string;
  label: string;
  diameter: number;
}

export type Food = {
  id: number;
  label: string;        // what the detector called it. This never changes.
  newLabel?: string;    // what the user renamed it to, if they did
  box: number[];
  score: number | null;
  thumbnail: string | null;
  volume_ml?: number | null;
  volume_ml_low?: number | null;
  volume_ml_high?: number | null;
};

export type Container = {
  id: string;
  box: number[];
  score: number | null;
  thumbnail: string | null;
  radial_profile?: Profile;   
};
