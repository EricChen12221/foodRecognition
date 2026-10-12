export type MealVolume = {
  id: string;                  // "food_0", ...
  volume_ml?: number | null;
  volume_ml_low?: number | null;
  volume_ml_high?: number | null;
  containerId?: string | null;
};

export type TabParamList = {
  Tracker: { volumes?: MealVolume[] } | undefined;
  Profile: undefined;
};