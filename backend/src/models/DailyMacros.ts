import mongoose from 'mongoose'
 
import Meal from './meal'

const dailyMacrosSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ },   // "2026-10-27"
    kcal: { type: Number, required: true, min: 0 },
    protein: { type: Number, required: true, min: 0 },
    carbs: { type: Number, required: true, min: 0 },
    fat: { type: Number, required: true, min: 0 },
    meals: [Meal]
  }
)

export default dailyMacrosSchema