import AsyncStorage from '@react-native-async-storage/async-storage'
import { API_URL } from '@env'
import { KEY } from './session'
import type { Profile, MealMacros } from '../types'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export type DetectedContainer = {
  id: string
  box: number[]
  score: number | null
  thumbnail: string | null
}

export type DetectedFood = {
  id: number
  label: string
  containerId: string | null
  box: number[]
  score: number | null
  thumbnail: string | null
  volume_ml?: number | null
  volume_ml_low?: number | null
  volume_ml_high?: number | null
}

export type AnalysisResult = {
  containers: DetectedContainer[]
  session_id: string
  foods: DetectedFood[]
}

export type VolumeEstimate = {
  id: string
  volume_ml?: number | null
  volume_ml_low?: number | null
  volume_ml_high?: number | null
}

export type EstimateResult = { volumes: VolumeEstimate[] }

/** Thrown for any failed request. `status` lets screens react, e.g. 401 means sign in again. */
export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** Returns the saved session token, or throws a 401 if the user isn't signed in. */
async function getToken() {
  const token = await AsyncStorage.getItem(KEY)
  if (!token) throw new ApiError('Not signed in.', 401)
  return token
}

/** Sends a request to /macros<path> as the signed-in user. Returns the parsed JSON. */
async function request<T>(
  path: string,
  options: { method?: string; body?: BodyInit_; headers?: Record<string, string>; signal?: AbortSignal } = {},
): Promise<T> {
  const token = await getToken()
  const res = await fetch(`${API_URL}/macros${path}`, {
    method: options.method ?? 'POST',
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
    body: options.body,
    signal: options.signal,
  })
  const data = await res.json().catch(() => null)   // a failed request may not return JSON
  if (!res.ok) throw new ApiError(data?.error ?? data?.detail ?? `Request failed (${res.status}).`, res.status)
  return data as T
}

/** Uploads a meal photo and returns the detected containers and foods. Cancels server-side on abort. */
export async function analyzeMeal(signal: AbortSignal, imageUri: string) {
  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`   // a label, not a secret

  signal.addEventListener('abort', () => {
    request(`/cancel/${requestId}`).catch(() => {})
  })

  const form = new FormData()
  form.append('image', { uri: imageUri, name: 'meal.jpg', type: 'image/jpeg' } as unknown as Blob)

  return request<AnalysisResult>('/analyze', {
    body: form,
    headers: { 'x-request-id': requestId },   // no Content-Type: fetch sets the multipart boundary
    signal,
  })
}

/** Estimates food volumes for an analyzed session. */
export const estimateMeal = (
  sessionId: string,
  containers: { id: string; radial_profile?: Profile }[],
  foods: { id: number; newLabel?: string }[],
) =>
  request<EstimateResult>('/estimate', {
    body: JSON.stringify({ session_id: sessionId, containers, foods }),
    headers: JSON_HEADERS,
  })

/** Converts estimated volumes into macros. Returns the full meal result (items, total, unknown). */
export const convertToMacros = (volumes: VolumeEstimate[]) =>
  request<MealMacros>('/convert', {
    body: JSON.stringify({ volumes }),
    headers: JSON_HEADERS,
  })

export default { analyzeMeal, estimateMeal, convertToMacros }