import AsyncStorage from '@react-native-async-storage/async-storage'
import { API_URL } from '@env'

export const BASE = `${API_URL}/api`
export const KEY = 'session-token'
const JSON_HEADERS = { 'Content-Type': 'application/json' }

export type Account = {
  id: string
  user: string
  goals: { kcal: number; protein: number; carbs: number; fat: number }
  profiles: { id: string; label: string; diameter: number }[]
  dailyMacros: unknown[]
}

export type Session = { token: string; account: Account }

async function register(): Promise<Session> {
  const res = await fetch(`${BASE}/user/register`, { method: 'POST' })
  if (!res.ok) throw new Error(`Could not create an account (${res.status}).`)
  const { token, user } = await res.json()
  await AsyncStorage.setItem(KEY, token)
  return { token, account: user }
}

export async function signInAutomatically(): Promise<Session> {
  const saved = await AsyncStorage.getItem(KEY)

  if (saved) {
    const res = await fetch(`${BASE}/user/session`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: JSON.stringify({ token: saved }),
    })
    if (res.ok) return { token: saved, account: await res.json() }
    if (res.status !== 401) throw new Error(`Could not sign in (${res.status}).`)
    // 401: the server doesn't know this token (e.g. the database was reset), so start fresh
  }

  return register()
}

/** Headers for any later request that needs the signed-in user. */
export const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` })