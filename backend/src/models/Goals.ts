import mongoose from 'mongoose'
 
const goalsSchema = new mongoose.Schema(
  {
    kcal: { type: Number, required: true, min: 500, max: 10000, default: 2000 },
    protein: { type: Number, required: true, min: 1, max: 500, default: 120 },
    carbs: { type: Number, required: true, min: 1, max: 1000, default: 220 },
    fat: { type: Number, required: true, min: 1, max: 400, default: 65 },
  },
  { _id: false },   // goals is one object inside the user, it does not need its own _id
)
 
export default goalsSchema