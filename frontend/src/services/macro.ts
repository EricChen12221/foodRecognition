import { API_URL } from '@env';

export type DetectedContainer = {
  id: string;
  box: number[];
  score: number | null;
  thumbnail: string | null;
};

export interface DetectedFood {
  id: string;
  label: string;
  containerId: string | null;
  volume_ml?: number | null;
  volume_ml_low?: number | null;
  volume_ml_high?: number | null;
}

export interface AnalysisResult {
  containers: DetectedContainer[];
  session_id: string;
  foods: DetectedFood[];
}

async function analyzeMeal(
  signal: AbortSignal,
  imageUri: string,
): Promise<AnalysisResult> {
  const form = new FormData();
  // React Native accepts a { uri, name, type } object here. Do not set Content-Type yourself;
  // fetch adds the multipart boundary.
  form.append('image', { uri: imageUri, name: 'meal.jpg', type: 'image/jpeg' } as unknown as Blob);

  const res = await fetch(`${API_URL}/analyze`, { method: 'POST', body: form, signal });
  if (!res.ok) throw new Error(`Server error (${res.status}).`);
  return (await res.json()) as AnalysisResult;
}

async function estimateMeal(
  sessionId: string,
  containers: {
    id: string;
    radial_profile?: { id: string; label: string; diameter: number };
  }[],
) {
  const res = await fetch(`${API_URL}/estimate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      containers,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Estimate failed (${res.status})`);
  }
  return res.json(); // { volumes: ... }
}

async function convertToMacros(volumes: { id: string; label: string; volume_ml?: number | null; volume_ml_low?: number | null; volume_ml_high?: number | null; }[]) {
  const res = await fetch(`${API_URL}/api/macros`, 
    {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(volumes)
    }
  )
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Estimate failed (${res.status})`);
  }
  return res.json();
}

export default { analyzeMeal, estimateMeal, convertToMacros }