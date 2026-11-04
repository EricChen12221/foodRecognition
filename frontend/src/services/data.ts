import AsyncStorage from '@react-native-async-storage/async-storage'
import { BASE, KEY } from './session'
import type { DayTotals, Goals, Profile, MealMacros, MealItem, SavedMeal, DailyMacros } from '../types'
 
const JSON_HEADERS = { 'Content-Type': 'application/json' }
 
/** One logged day. `date` looks like "2026-10-27". */

/** Thrown for any failed request. `status` lets screens react, e.g. 401 means sign in again. */
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}
 
/** Sends a request to /api/user<path> with the saved session token. Returns the parsed JSON. */
async function request<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = await AsyncStorage.getItem(KEY)

  if (!token) throw new ApiError('Not signed in.', 401)
 
  const res = await fetch(`${BASE}/user${path}`, {
    method: options.method ?? 'GET',
    headers: { ...JSON_HEADERS, Authorization: `Bearer ${token}` },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
 
  const data = await res.json().catch(() => null)   // a failed request may not return JSON
  if (!res.ok) throw new ApiError(data?.error ?? `Request failed (${res.status}).`, res.status)
  return data as T
}
 
//goals
export const getGoals = () => request<Goals>('/goals')
 
export const updateGoals = (patch: Partial<Goals>) => 
  request<Goals>('/goals', { method: 'PATCH', body: patch })
 
//profiles
export const getProfiles = () => request<Profile[]>('/profiles')
 
export const createProfile = (label: string, diameter: number) =>
  request<Profile>('/profiles', { method: 'POST', body: { label, diameter } })
 
export const updateProfile = (id: string, patch: { label?: string; diameter?: number }) =>
  request<Profile>(`/profiles/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch })
 
export const deleteProfile = (id: string) =>
  request<Profile[]>(`/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' })
 
//daily macros
export const getDailyMacros = () => request<DailyMacros[]>('/dailyMacros')

export const addMeal = (entry: { date: string; name: string; foods: MealItem[] }) => {
  console.log(entry)
  return request<{ meal: SavedMeal; day: DailyMacros }>('/dailyMacros/meal', { method: 'POST', body: entry })
}
  

export const deleteMeal = (date: string, mealId: string) =>
  request<{ day: DailyMacros | null }>(
    `/dailyMacros/${encodeURIComponent(date)}/meals/${encodeURIComponent(mealId)}`,
    { method: 'DELETE' },
  )

/** Flattens the macro result into the items the server stores. Foods with no estimate are skipped. */
export const toMealItems = (meal: MealMacros): MealItem[] => {
  const r1 = (n: number) => Math.round(n * 10) / 10
  return meal.items.flatMap((i) =>
    i.macros
      ? [{
          label: i.label ?? i.id,
          grams: r1(i.macros.estimate.grams),
          kcal: r1(i.macros.estimate.kcal),
          protein: r1(i.macros.estimate.protein),
          carbs: r1(i.macros.estimate.carbs),
          fat: r1(i.macros.estimate.fat),
        }]
      : [],
  )
}
 
export const toDaysMap = (list: DailyMacros[]): Record<string, DayTotals> =>
  Object.fromEntries(
    list.map(({ date, kcal, protein, carbs, fat }) => [date, { kcal, protein, carbs, fat }]),
  )

export const mealsForDate = (list: DailyMacros[], date: string): SavedMeal[] => 
  list.find((d) => d.date === date)?.meals ?? []
