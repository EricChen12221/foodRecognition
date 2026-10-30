import { API_URL } from '@env';

type DetectedContainer = {
  id: string;
  box: number[];
  score: number | null;
  thumbnail: string | null;
};

interface DetectedFood {
  id: number;
  label: string;
  containerId: string | null;
  box: number[];                 
  score: number | null;          
  thumbnail: string | null;      
  volume_ml?: number | null;
  volume_ml_low?: number | null;
  volume_ml_high?: number | null;
}

interface AnalysisResult {
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

  const res = await fetch(`${API_URL}/macros/analyze`, { method: 'POST', body: form, signal });
  if (!res.ok) throw new Error(`Server error (${res.status}).`);
  return (await res.json()) as AnalysisResult;
}

async function estimateMeal(
  sessionId: string,
  containers: {
    id: string;
    radial_profile?: { id: string; label: string; diameter: number };
  }[],
  foods: { id: number, newLabel?: string }[]
) {
  const res = await fetch(`${API_URL}/macros/estimate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: sessionId,
      containers,
      foods
    }),
  });
  
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Estimate failed (${res.status})`);
  }
  return res.json(); // { volumes: ... }
}

async function convertToMacros(volumes: { id: string; volume_ml?: number | null; volume_ml_low?: number | null; volume_ml_high?: number | null; }[]) {
  const res = await fetch(`${API_URL}/macros/convert`, 
    {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volumes }),
    }
  )
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Estimate failed (${res.status})`);
  }
  return res.json();
}

export default { analyzeMeal, estimateMeal, convertToMacros }