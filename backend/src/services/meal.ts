import User from '../models/user'
import type { MealItemJson } from '../types'
import mongoose from 'mongoose'

const TOTAL_KEYS = ['kcal', 'protein', 'carbs', 'fat'] as const

async function addMeal(userId: string, date: string, name: string, foods: MealItemJson[]) {
  if (!Array.isArray(foods) || foods.length === 0) {
    throw new Error('A meal must contain at least one food.')
  }

  // Numbers that are missing, negative or NaN would quietly corrupt the day's totals.
  for (const food of foods) {
    for (const key of TOTAL_KEYS) {
      const v = food[key]
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
        throw new Error(`Every food needs a ${key} of zero or more.`)
      }
    }
  }

  const totals = foods.reduce(
    (acc, food) => ({
      kcal: acc.kcal + food.kcal,
      protein: acc.protein + food.protein,
      carbs: acc.carbs + food.carbs,
      fat: acc.fat + food.fat,
    }),
    { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  )

  // Step 1: make sure the day exists. The filter only matches when NO entry has this date, so this
  // does nothing for an existing day, and two requests at once cannot create it twice.
  await User.updateOne(
    { _id: userId, 'dailyMacros.date': { $ne: date } },
    { $push: { dailyMacros: { date, kcal: 0, protein: 0, carbs: 0, fat: 0, meals: [] } } },
  )

  // Step 2: add the meal and raise the day's totals in one atomic update.
  const user = await User.findOneAndUpdate(
    { _id: userId, 'dailyMacros.date': date },
    {
      $push: { 'dailyMacros.$.meals': { name, ...totals, items: foods } },
      $inc: {
        'dailyMacros.$.kcal': totals.kcal,
        'dailyMacros.$.protein': totals.protein,
        'dailyMacros.$.carbs': totals.carbs,
        'dailyMacros.$.fat': totals.fat,
      },
    },
    { returnDocument: 'after', runValidators: true },
  )
  if (!user) throw new Error('Could not save the meal.')

  const day = user.dailyMacros.find((d) => d.date === date)
  const meal = day?.meals.at(-1)
  if (!day || !meal) throw new Error('Could not save the meal.')

  return {
    meal,
    day: { date: day.date, kcal: day.kcal, protein: day.protein, carbs: day.carbs, fat: day.fat },
  }
}

async function deleteMeal(userId: string, date: string, mealId: string) {
  if (!mongoose.isValidObjectId(mealId)) throw new Error('Invalid meal id.')

  // $elemMatch makes both conditions apply to the SAME day (without it they could match different days)
  const match = { dailyMacros: { $elemMatch: { date, 'meals._id': mealId } } }

  // 1. Read the meal: its totals have to come off the day.
  const found = await User.findOne({ _id: userId, ...match })
  const day = found?.dailyMacros.find((d) => d.date === date)
  const meal = day?.meals.find((m) => String(m._id) === mealId)
  if (!meal) throw new Error('Meal not found.')

  // 2. Remove it and subtract its totals in one atomic update. The filter still names the meal, so a
  //    second delete of the same meal matches nothing and cannot subtract the totals twice.
  const user = await User.findOneAndUpdate(
    { _id: userId, ...match },
    {
      $pull: { 'dailyMacros.$.meals': { _id: mealId } },
      $inc: {
        'dailyMacros.$.kcal': -meal.kcal,
        'dailyMacros.$.protein': -meal.protein,
        'dailyMacros.$.carbs': -meal.carbs,
        'dailyMacros.$.fat': -meal.fat,
      },
    },
    { returnDocument: 'after' },
  )
  if (!user) throw new Error('Meal not found.')

  const updated = user.dailyMacros.find((d) => d.date === date)
  if (!updated) throw new Error('Meal not found.')

  // A day with no meals left is removed, so the calendar shows nothing for it
  // (and rounding leftovers like -0.0000001 never show up).
  if (updated.meals.length === 0) {
    await User.updateOne({ _id: userId }, { $pull: { dailyMacros: { date, meals: { $size: 0 } } } })
    return { day: null }
  }

  return {
    day: { date: updated.date, kcal: updated.kcal, protein: updated.protein, carbs: updated.carbs, fat: updated.fat },
  }
}

export default { addMeal, deleteMeal }