import mongoose from 'mongoose';
import User from '../models/user';

type Goal = {
  id: string;
  kcal: number;
  protein: number;
  carbs: number;
  fats: number;
};

const goalsOf = (user: { toJSON: () => unknown }) =>
  (user.toJSON() as { goals: Goal[] }).goals;

function assertGoalId(goalId: string) {
  if (!mongoose.isValidObjectId(goalId)) {
    throw new Error('Invalid goal id.');
  }
}

async function updateGoals(
  userId: string,
  goalId: string,
  patch: {
    kcal: number;
    protein: number;
    carbs: number;
    fat: number;
  }) {
  assertGoalId(goalId);

  const user = await User.findOneAndUpdate(
    { _id: userId, 'goals._id': goalId },
    {
      $set: {
        'goals.$.kcal': patch.kcal,
        'goals.$.protein': patch.protein,
        'goals.$.carbs': patch.carbs,
        'goals.$.fats': patch.fat,
      },
    },
    { new: true, runValidators: true },
  );

  if (!user) {
    throw new Error('Unknown user or goal.');
  }

  const updated = goalsOf(user).find((g) => String(g.id) === goalId,);

  if (!updated) {
    throw new Error('Goal was not saved.');
  }

  return updated;
}

export default { updateGoals };
