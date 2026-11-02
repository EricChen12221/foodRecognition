import crypto from 'node:crypto'
import { type NextFunction, type Request, type Response } from 'express'
import User from './models/user' 

import type { HydratedDocument } from 'mongoose'
import type { IUser } from './models/user'

const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex')

export const getUserId = (res: Response): string =>
  String((res.locals.user as HydratedDocument<IUser>)._id)

export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const token = /^Bearer ([0-9a-f]{64})$/.exec(req.header('authorization') ?? '')?.[1]
  const user = token ? await User.findOne({ tokenHash: hash(token) }) : null
 
  if (!user) {
    return res.status(401).json({ error: 'Not signed in.' })
  }
  res.locals.user = user
  next()
}