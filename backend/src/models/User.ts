import mongoose, { type Model } from 'mongoose'

import DailyMacros from './dailyMacros'
import Goals from './goals'
import Profile from './profile'

export interface IUser {
  user: string,
  tokenHash: string,
  profiles: { id: string; label: string; diameter: number }[]
  goals: { kcal: number; protein: number; carbs: number; fat: number }
  dailyMacros: { date: string; kcal: number; protein: number; carbs: number; fat: number }[]
}

const schema = new mongoose.Schema<IUser>({
  user: { type: String, required: true, unique: true },
  profiles: [Profile],
  goals: Goals,
  dailyMacros: [DailyMacros],
})

schema.set('toJSON', {
  transform: (_document, returnedObject) => {
    const user = returnedObject as any
    user.id = user._id
    delete user._id
    delete user.__v
    return user
  },
})

const User: Model<IUser> = mongoose.model<IUser>('User', schema)
export default User