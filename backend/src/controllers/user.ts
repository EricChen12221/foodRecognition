import crypto from 'node:crypto'
import express, { Router, type Request, type Response } from 'express'
import User from '../models/user' 

import mealHelper from '../services/meal'
import goalsHelper from '../services/goals'
import profilesHelper from '../services/profiles'

import { requireUser } from '../middleware' 

const router = Router()
 
const DEFAULT_GOALS = { kcal: 2000, protein: 120, carbs: 220, fat: 65 }
const DEFAULT_PROFILES = [
  { id: '1', label: 'Plate', diameter: 0.28 },   // diameter in meters
  { id: '2', label: 'Bowl', diameter: 0.2 },
]
 
// Only a hash of the token is stored, so a leaked database doesn't leak working sessions.
const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex')
 
// POST /register   (no body)
// First launch: create an anonymous account and hand the app its secret token, ONCE.
router.post('/register', async (_req, res) => {
  const token = crypto.randomBytes(32).toString('hex')   // 64 hex characters
  const encrypted = hash(token)

  const user = await User.create({
    user: `guest-${token.slice(0, 8)}`,
    tokenHash: encrypted,
    goals: DEFAULT_GOALS,
    profiles: DEFAULT_PROFILES,
    dailyMacros: [],
  })

  console.log(encrypted)
 
  res.status(201).json({ token, user })
})
 

router.post('/session', express.json(), async (req, res) => {
  const token = req.body?.token
  if (typeof token !== 'string' || token.length !== 64) {
    return res.status(400).json({ error: 'A valid token is required.' })
  }
 
  const user = await User.findOne({ tokenHash: hash(token) })
  if (!user) {
    return res.status(401).json({ error: 'Unknown session.' })   // the app should register again
  }
 
  res.json(user)
})
 
const handle =
  (fn: (req: Request, res: Response) => Promise<void> | void) =>
  async (req: Request, res: Response) => {
    try {
      await fn(req, res)
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Bad request.' })
    }
  }
 

function paramOf(req: Request, name: string): string {
  const value = req.params[name]
  if (typeof value !== 'string' || value === '') throw new Error(`${name} is required.`)
  return value
}
 
// goals
router.get('/goals', requireUser, (_req, res) => {
  res.json(res.locals.user.goals)
})
 
router.patch('/goals', requireUser, handle(async (req, res) => {
  console.log('hi')
  console.log('Content-Type:', req.headers['content-type'])
  console.log('Body:', req.body)

  const { kcal, protein, carbs, fat } = req.body ?? {}

  const updated = await goalsHelper.updateGoals(
    res.locals.user.id,
    { kcal, protein, carbs, fat },
  )

  res.json(updated)
}))
 
// profiles
router.get('/profiles', requireUser, (_req, res) => {
  res.json(res.locals.user.profiles)
})
 
router.post('/profiles', requireUser, handle(async (req, res) => {
  const { label, diameter } = req.body ?? {}
  if (typeof label !== 'string' || typeof diameter !== 'number') {
    throw new Error('label (text) and diameter (number, in meters) are required.')
  }
  res.status(201).json(await profilesHelper.makeProfile(res.locals.user.id, label, diameter))
}))
 
router.patch('/profiles/:profileId', requireUser, handle(async (req, res) => {
  const profileId = paramOf(req, 'profileId')
 
  const { label, diameter } = req.body ?? {}
  res.json(await profilesHelper.updateProfile(res.locals.user.id, profileId, { label, diameter }))
}))
 
router.delete('/profiles/:profileId', requireUser, handle(async (req, res) => {
  const profileId = paramOf(req, 'profileId')
 
  res.json(await profilesHelper.deleteProfile(res.locals.user.id, profileId))   // the remaining profiles
}))
 
//dailyMacros
router.get('/dailyMacros', requireUser, (_req, res) => {
  res.json(res.locals.user.dailyMacros)
})
 
router.post('/dailyMacros/meal', requireUser, handle(async (req, res) => {
  const { name, date, foods } = req.body ?? {}

  console.log(foods)

  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) {
    throw new Error('date must look like "2026-10-27".')
  }
  if (typeof name !== 'string' || name.trim() === '' || name.length > 60) {
    throw new Error('A meal needs a name of up to 60 characters.')
  }
  if (!Array.isArray(foods)) {
    throw new Error('foods must be a list.')
  }

  res.status(201).json(await mealHelper.addMeal(res.locals.user.id, date, name.trim(), foods))
}))

router.delete('/dailyMacros/:date/meals/:mealId', requireUser, handle(async (req, res) => {
  const date = paramOf(req, 'date')
  const mealId = paramOf(req, 'mealId')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('date must look like "2026-10-27".')

  res.json(await mealHelper.deleteMeal(res.locals.user.id, date, mealId))
}))

export default router