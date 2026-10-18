export type Macros = { grams: number; kcal: number; protein: number; fat: number; carbs: number };
export type MacroRange = { estimate: Macros; low: Macros; high: Macros };

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

export type TabParamList = {
  Tracker: { volumes?: MealVolume[] } | undefined;
  Profile: undefined;
};