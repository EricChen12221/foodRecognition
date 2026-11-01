import User from '../models/user'
import type { DailyMacrosJson } from '../types'
 
const dailyMacrosOf = (user: { toJSON: () => unknown }) => (user.toJSON() as any).profiles as DailyMacrosJson[]
 
async function addDailyMacros(userId: string, dailyMacros: DailyMacrosJson){
  const user = await User.findByIdAndUpdate(
    userId,
    { $push: { dailyMacros } },
    { returnDocument: 'after', runValidators: true },   // runValidators applies the min/max on diameter
  )
  if (!user) throw new Error('Unknown user.')
 
  const created = dailyMacrosOf(user).at(-1)   // the one we just pushed
  if (!created) throw new Error('Profile was not saved.')
  return created
}

export default { addDailyMacros }