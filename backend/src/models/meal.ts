import mongoose from 'mongoose'

import Item from './item'

const mealSchema = new mongoose.Schema({
    lower: { type: Number, required: true },
    upper: { type: Number, required: true },
    kcal: { type: Number, required: true },
    protein: { type: Number, required: true },
    fat: { type: Number, required: true },
    items: [Item]
})

export default mealSchema