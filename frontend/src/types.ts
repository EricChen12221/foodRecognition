export type Macros = { grams: number; kcal: number; protein: number; fat: number; carbs: number };
export type MacroRange = { estimate: Macros; low: Macros; high: Macros };

export type Goals = { kcal: number; protein: number; carbs: number; fat: number };

export type DayTotals = { kcal: number; protein: number; carbs: number; fat: number };

export type Macro = 'protein' | 'carbs' | 'fat';

export type MealMacros = {
  items: { id: string; label: string; macros: MacroRange | null }[];
  total: MacroRange;
  unknown: string[];
};

export type MealVolume = {
  id: string;                   
  count?: number;               
  volume_ml?: number | null;
  volume_ml_low?: number | null;
  volume_ml_high?: number | null;
};

export type Profile = {
  id: string;
  label: string;
  diameter: number;
  shape?: {                              
    knotsZOverR: number[]
    depthFrac: number
    floorFrac: number
    fitRms?: number
    scaleFactor?: number
    nPhotos?: number
    calibratedAt?: string
  }
}

export type Food = {
  id: number;
  label: string;        
  newLabel?: string;   
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

export type MealItem = {
  label: string
  grams: number
  kcal: number
  protein: number
  carbs: number
  fat: number
}

export type SavedMeal = {
  _id: string
  name: string
  kcal: number
  protein: number
  carbs: number
  fat: number
  items: MealItem[]
}

export type DailyMacros = DayTotals & { date: string; id?: string; meals: SavedMeal[] }
