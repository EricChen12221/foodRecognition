import mongoose from 'mongoose'

const schema = new mongoose.Schema({
  kcals: {
    type: Number,
    required: true
  },
  protein: {
    type: Number,
    required: true
  },
  carbs: {
    type: Number,
    required: true
  },
  fats: {
    type: Number,
    required: true
  },
  date: {
    type: String,
    required: true
  }
})

schema.set("toJSON", {
  transform: (_document, returnedObject) => {
    const macros = returnedObject as any

    macros.id = macros._id

    delete macros._id;
    delete macros.__v;

    return macros
  }
})
export const DailyMacros = mongoose.model('DailyMacros', schema);
export default DailyMacros