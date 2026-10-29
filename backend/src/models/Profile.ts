import mongoose from 'mongoose'
 
const profileSchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true, maxlength: 30 },
  diameter: { type: Number, required: true, min: 0.05, max: 0.8 },      // OUTER rim width in METERS
})
 
// Each profile keeps its own _id; this turns it into the `id` the app uses.
profileSchema.set('toJSON', {
  transform: (_document, returnedObject) => {
    const profile = returnedObject as any
    profile.id = profile._id
    delete profile._id
    delete profile.__v
    return profile
  },
})
 
export default profileSchema