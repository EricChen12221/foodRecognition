import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';   // npm i csv-parse

export type FoodInfo = {
  density: number;  // g/ml
  kcal: number;     // per 100 g
  protein: number;
  fat: number;
  carbs: number;
};

export type Macros = { grams: number; kcal: number; protein: number; fat: number; carbs: number };
export type Range = { estimate: Macros; low: Macros; high: Macros };

export type FoodInput = {
  id: string;
  label: string;
  volume_ml?: number | null;
  volume_ml_low?: number | null;
  volume_ml_high?: number | null;
};

const ZERO: Macros = { grams: 0, kcal: 0, protein: 0, fat: 0, carbs: 0 };

const BASE_PCT = 0.2;   
const CSV_PATH = path.join(__dirname, '..', 'src', 'data', 'foods.csv');
const FOODS = new Map<string, FoodInfo>();

const rows = parse(readFileSync(CSV_PATH, 'utf8'), {
  columns: true,
  skip_empty_lines: true,
}) as Record<string, string | undefined>[];

for (const r of rows) {
  const name = r.name?.toLowerCase().trim();
  if (!name) continue;                                   // blank or malformed row

  const info: FoodInfo = {
    density: Number(r.density),                          // Number(undefined) is NaN, caught below
    kcal: Number(r.kcal),
    protein: Number(r.protein),
    fat: Number(r.fat),
    carbs: Number(r.carbs),
  };
  if (Object.values(info).some(Number.isNaN)) {
    console.warn(`foods.csv: skipping row with bad numbers: ${name}`);
    continue;
  }
  FOODS.set(name, info);
}
console.log(`Loaded ${FOODS.size} foods from ${CSV_PATH}`);

function candidates(label: string): string[] {
  const k = label.toLowerCase().trim();
  const forms = (w: string) => [w, w.replace(/ies$/, 'y'), w.replace(/es$/, ''), w.replace(/s$/, '')];
  return [...forms(k), ...k.split(/\s+/).reverse().flatMap(forms)];
}

function lookup(label: string): FoodInfo | undefined {
  for (const c of candidates(label)) {
    const hit = FOODS.get(c);
    if (hit) return hit;
  }
  return undefined;
}

function fromVolume(info: FoodInfo, ml: number): Macros {
  const grams = ml * info.density;
  const per = (n: number) => (grams * n) / 100;
  return { grams, kcal: per(info.kcal), protein: per(info.protein), fat: per(info.fat), carbs: per(info.carbs) };
}

function scaleMacros(m: Macros, k: number): Macros {
  return { grams: m.grams * k, kcal: m.kcal * k, protein: m.protein * k, fat: m.fat * k, carbs: m.carbs * k };
}

const add = (a: Macros, b: Macros): Macros => ({
  grams: a.grams + b.grams,
  kcal: a.kcal + b.kcal,
  protein: a.protein + b.protein,
  fat: a.fat + b.fat,
  carbs: a.carbs + b.carbs,
});

function macrosFor(
  label: string,
  volume_ml?: number | null,
  volume_ml_low?: number | null,
  volume_ml_high?: number | null,
): Range | null {
  const info = lookup(label);
  if (!info || volume_ml == null || volume_ml <= 0) return null;   // unknown food or no volume

  const estimate = fromVolume(info, volume_ml);

  // relative spread of the pipeline's volume range, 0 if it didn't give one
  const volPct = volume_ml_low != null && volume_ml_high != null ? Math.max(volume_ml - volume_ml_low, volume_ml_high - volume_ml) / volume_ml: 0;

  // independent errors combine in quadrature; cap at 100% so "low" can't go negative
  const pct = Math.min(Math.sqrt(BASE_PCT ** 2 + volPct ** 2), 1);
  return { estimate, low: scaleMacros(estimate, 1 - pct), high: scaleMacros(estimate, 1 + pct) };
}

export function macrosForMeal(foods: FoodInput[]) {
  const items = foods.map((f) => ({ id: f.id, label: f.label, macros: macrosFor(f.label, f.volume_ml, f.volume_ml_low, f.volume_ml_high) }));

  const total = items.reduce<Range>(
    (t, i) =>
      i.macros ? {
            estimate: add(t.estimate, i.macros.estimate),
            low: add(t.low, i.macros.low),
            high: add(t.high, i.macros.high),
          } : t,
    { estimate: ZERO, low: ZERO, high: ZERO },
  );

  return {
    items,                                                        // per-food Range, or null if unknown
    total,                                                        // sum of the known foods, every macro
    unknown: items.filter((i) => !i.macros).map((i) => i.id),     // foods the table doesn't cover
  };
}