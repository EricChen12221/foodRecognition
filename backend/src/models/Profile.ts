import mongoose from 'mongoose'

const schema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  diameter: {
    type: Number,
    required: true
  }
})

schema.set("toJSON", {
  transform: (_document, returnedObject) => {
    const profiles = returnedObject as any

    profiles.id = profiles._id

    delete profiles._id;
    delete profiles.__v;

    return profiles
  }
})

export const Profile = mongoose.model("Profile", schema);

export default Profile;