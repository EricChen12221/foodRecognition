import mongoose from 'mongoose'

const shapeSchema = new mongoose.Schema(
  {
    knotsZOverR: {
      type: [Number],
      required: true,
      validate: {
        validator: (v: number[]) => v.length === 64 && v.every(Number.isFinite),
        message: 'knotsZOverR must be 64 numbers',
      },
    },
    depthFrac: { type: Number, min: 0 },
    floorFrac: { type: Number, min: 0, max: 1 },
    fitRms: Number,
    scaleFactor: Number,
    nPhotos: { type: Number, default: 1 },
    calibratedAt: { type: Date, default: Date.now },
  },
  { _id: false },
)


const profileSchema = new mongoose.Schema({
  label: { type: String, required: true, trim: true, maxlength: 30 },
  diameter: { type: Number, required: true, min: 0.05, max: 0.8 },      // OUTER rim width in METERS
  shape: { type: shapeSchema, default: undefined }
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