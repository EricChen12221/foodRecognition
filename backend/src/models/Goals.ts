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
})

schema.set("toJSON", {
  transform: (_document, returnedObject) => {
    const goals = returnedObject as any

    goals.id = goals._id

    delete goals._id;
    delete goals.__v;

    return goals
  }
})
export const Goals = mongoose.model("Goals", schema);

export default Goals;