import crypto from 'node:crypto'
import express, { Router, type NextFunction, type Request, type Response } from 'express'
import User from '../models/user' 

import dailyMacrosHelper from '../services/dailyMacros'
import goalsHelper from '../services/goals'
import profilesHelper from '../services/profiles'
 
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
 
  const user = await User.create({
    user: `guest-${token.slice(0, 8)}`,
    tokenHash: hash(token),
    goals: DEFAULT_GOALS,
    profiles: DEFAULT_PROFILES,
    dailyMacros: [],
  })
 
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
 
export async function requireUser(req: Request, res: Response, next: NextFunction) {
  // match[1] has type string | undefined when noUncheckedIndexedAccess is on, so check it first
  const token = /^Bearer ([0-9a-f]{64})$/.exec(req.header('authorization') ?? '')?.[1]
  const user = token ? await User.findOne({ tokenHash: hash(token) }) : null
 
  if (!user) {
    return res.status(401).json({ error: 'Not signed in.' })
  }
  res.locals.user = user
  next()
}
 
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
 
router.patch('/goals:goalsId', requireUser, handle(async (req, res) => {
  const goalsId = paramOf(req, 'goalsId')
  const { kcals, protein, carbs, fats } = req.body ?? {}
  res.json(await goalsHelper.updateGoals(res.locals.user.id, goalsId, { kcals, protein, carbs, fats }))
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
 
router.post('/dailyMacros', requireUser, handle(async (req, res) => {   // note the leading slash
  const { kcals, protein, carbs, fats, date } = req.body ?? {}
 
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error('date must look like "2026-10-27".')
  }
  for (const v of [kcals, protein, carbs, fats]) {
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new Error('kcal, protein, carbs and fat must be numbers, zero or more.')
    }
  }
 
  res.status(201).json(
    await dailyMacrosHelper.addDailyMacros(res.locals.user.id, { kcals, protein, carbs, fats, date }),
  )
}))

export default router