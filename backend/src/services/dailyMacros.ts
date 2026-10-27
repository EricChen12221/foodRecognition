import User from '../models/user'

type DailyMacrosJson = { id: string; kcal: number; protein: number; carbs: number; fats: number; date: string; }
 
const dailyMacrosOf = (user: { toJSON: () => unknown }) => (user.toJSON() as any).profiles as DailyMacrosJson[]
 
async function makeProfile(userId: string, dailyMacros: DailyMacrosJson){
  const user = await User.findByIdAndUpdate(
    userId,
    { $push: { dailyMacros } },
    { new: true, runValidators: true },   // runValidators applies the min/max on diameter
  )
  if (!user) throw new Error('Unknown user.')
 
  const created = dailyMacrosOf(user).at(-1)   // the one we just pushed
  if (!created) throw new Error('Profile was not saved.')
  return created
}

export default { makeProfile }