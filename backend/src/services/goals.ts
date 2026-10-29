import User from '../models/user';

async function updateGoals(
  userId: string,
  patch: {
    kcal: number;
    protein: number;
    carbs: number;
    fat: number;
  },
) {
  const user = await User.findByIdAndUpdate(
    userId,
    {
      $set: {
        'goals.kcal': patch.kcal,
        'goals.protein': patch.protein,
        'goals.carbs': patch.carbs,
        'goals.fat': patch.fat,
      },
    },
    { returnDocument: 'after', runValidators: true },
  );

  if (!user) {
    throw new Error('Unknown user.');
  }

  return user.goals;
}

export default { updateGoals };