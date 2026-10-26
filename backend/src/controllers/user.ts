import crypto from 'node:crypto'
import express, { Router, type NextFunction, type Request, type Response } from 'express'
import User from '../models/user'  
 
const router = Router()
 
// What a brand-new account starts with (same values as the app's settings.ts).
// Field names must match your Goals and Profile sub-schemas.
const DEFAULT_GOALS = { kcal: 2000, protein: 120, carbs: 220, fat: 65 }
const DEFAULT_PROFILES = [
  { id: '1', label: 'Plate', diameter: 0.28 },   // diameter in meters
  { id: '2', label: 'Bowl', diameter: 0.2 },
]
 
// Only a hash of the token is stored, so a leaked database doesn't leak working sessions.
const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex')
 
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
 
// POST /session   body: { "token": "<saved token>" }
// Every later launch: the app sends its saved token and gets the account back.
router.post('/session', express.json(), async (req, res) => {
  const token = req.body?.token
  if (typeof token !== 'string' || token.length !== 64) {
    return res.status(400).json({ error: 'A valid token is required.' })
  }
 
  const user = await User.findOne({ tokenHash: hash(token) })
  if (!user) {
    return res.status(401).json({ error: 'Unknown session.' })  
  }
 
  res.json(user)
})
 
// ---- protect any route with this: the app sends  Authorization: Bearer <token> ----
export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const match = /^Bearer ([0-9a-f]{64})$/.exec(req.header('authorization') ?? '')
  const user = match ? await User.findOne({ tokenHash: hash(match[1]) }) : null
 
  if (!user) {
    return res.status(401).json({ error: 'Not signed in.' })
  }
  res.locals.user = user
  next()
}
 
// GET /goals
router.get('/goals', requireUser, (_req, res) => {
  res.json(res.locals.user.goals)
})
 
export default router