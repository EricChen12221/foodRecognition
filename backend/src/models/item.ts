import mongoose from 'mongoose'

const itemSchema = new mongoose.Schema({
    label: { type: String, required: true },
    grams: { type: Number, required: true },
    kcal: { type: Number, required: true },
    protein: { type: Number, required: true },
    carbs: { type: Number, required: true },
    fat: { type: Number, required: true },
})

export default itemSchema