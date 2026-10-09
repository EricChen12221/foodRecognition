import { API_URL } from '@env';

export interface DetectedContainer {
  id: string;
  suggestedClass?: string;       // e.g. 'dinner_plate'
}
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
  foods: DetectedFood[];
}

async function analyzeMeal(
  signal: AbortSignal,
  imageUri: string,
  plateDiameterM?: number,
): Promise<AnalysisResult> {
  const form = new FormData();
  // React Native accepts a { uri, name, type } object here. Do not set Content-Type yourself;
  // fetch adds the multipart boundary.
  form.append('image', { uri: imageUri, name: 'meal.jpg', type: 'image/jpeg' } as unknown as Blob);

  if (plateDiameterM) form.append('plate_diameter_m', String(plateDiameterM));

  const res = await fetch(`${API_URL}/analyze`, { method: 'POST', body: form, signal });
  if (!res.ok) throw new Error(`Server error (${res.status}).`);
  return (await res.json()) as AnalysisResult;
}

export default { analyzeMeal }