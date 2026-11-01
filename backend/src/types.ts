import { Types } from 'mongoose';

export interface MealItemJson {
  _id?: Types.ObjectId;
  name: string;
  quantity: number;
  unit: string;

  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface MealJson {
  _id?: Types.ObjectId;
  name: string;

  kcal: number;
  protein: number;
  carbs: number;
  fat: number;

  items: MealItemJson[];
}

export interface DailyMacrosJson {
  _id?: Types.ObjectId;
  date: string;

  kcal: number;
  protein: number;
  carbs: number;
  fat: number;

  meals: MealJson[];
}