import User from '../models/user';
import type { MealItemJson } from '../types';

async function addMeal(
  userId: string,
  dailyMacroId: string,
  name: string,
  foods: MealItemJson[]
) {
  if (!foods.length) {
    throw new Error("A meal must contain at least one food.");
  }

  const totals = foods.reduce(
    (acc, food) => ({
      kcal: acc.kcal + food.kcal,
      protein: acc.protein + food.protein,
      carbs: acc.carbs + food.carbs,
      fat: acc.fat + food.fat
    }),
    {
      kcal: 0,
      protein: 0,
      carbs: 0,
      fat: 0
    }
  );

  const meal = {
    name,
    ...totals,
    items: foods
  };

  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      "dailyMacros._id": dailyMacroId
    },
    {
      $push: {
        "dailyMacros.$.meals": meal
      }
    },
    {
      returnDocument: "after",
      runValidators: true
    }
  );

  if (!user) {
    throw new Error("Daily macros not found.");
  }

  const dailyMacros = user.dailyMacros.find(
    d => d._id?.toString() === dailyMacroId
  );

  if (!dailyMacros) {
    throw new Error("Daily macros not found.");
  }

  return dailyMacros.meals.at(-1);
}

export default { addMeal };