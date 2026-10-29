import mongoose from 'mongoose'
import User from '../models/user'
 
type ProfileJson = { id: string; label: string; diameter: number }
 
const profilesOf = (user: { toJSON: () => unknown }) => (user.toJSON() as any).profiles as ProfileJson[]
 
function assertProfileId(profileId: string) {
  if (!mongoose.isValidObjectId(profileId)) throw new Error('Invalid profile id.')
}
 
async function makeProfile(userId: string, label: string, diameter: number) {
  const user = await User.findByIdAndUpdate(
    userId,
    { $push: { profiles: { label: label.trim(), diameter } } },
    { new: true, runValidators: true },   // runValidators applies the min/max on diameter
  )
  if (!user) throw new Error('Unknown user.')
 
  const created = profilesOf(user).at(-1)   // the one we just pushed
  if (!created) throw new Error('Profile was not saved.')
  return created
}
 
async function updateProfile(
  userId: string,
  profileId: string,
  patch: { label?: string; diameter?: number },
) {
  assertProfileId(profileId)
 
  const set: Record<string, unknown> = {}
  if (patch.label !== undefined) set['profiles.$.label'] = patch.label.trim()
  if (patch.diameter !== undefined) set['profiles.$.diameter'] = patch.diameter
  if (Object.keys(set).length === 0) throw new Error('Nothing to update.')
 
  const user = await User.findOneAndUpdate(
    { _id: userId, 'profiles._id': profileId },   
    { $set: set },                               
    { returnDocument: 'after', runValidators: true },
  )
  if (!user) throw new Error('Unknown user or profile.')
 
  const updated = profilesOf(user).find((p) => String(p.id) === profileId)
  if (!updated) throw new Error('Profile was not saved.')
  return updated
}
 
async function deleteProfile(userId: string, profileId: string) {
  assertProfileId(profileId)
 
  const user = await User.findOneAndUpdate(
    {
      _id: userId,
      'profiles._id': profileId,              // the profile exists
      'profiles.1': { $exists: true },        // and there are at least 2 profiles (an element at index 1)
    },
    { $pull: { profiles: { _id: profileId } } },   // remove the array element(s) with this _id
    { new: true },
  )
 
  if (!user) {
    const existing = await User.findById(userId)
    if (!existing) throw new Error('Unknown user.')
    if (!profilesOf(existing).some((p) => String(p.id) === profileId)) throw new Error('Unknown profile.')
    throw new Error('You must keep at least one profile.')
  }
 
  return profilesOf(user)
}

export default { makeProfile, updateProfile, deleteProfile }