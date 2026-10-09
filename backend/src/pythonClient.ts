/**
 * Client for the Python (FastAPI) service that wraps the macro calculator.
 * Uses only built-in Node 18+ globals: fetch, FormData, Blob, AbortController.
 */

export interface AnalyzedFood {
  id: string;
  label: string;
  containerId: string | null;
  box: number[];
  score: number | null;
  contained_fraction: number | null;
  volume_ml: number | null;
  volume_ml_low: number | null;
  volume_ml_high: number | null;
}

export interface AnalyzeResponse {
  containers: { id: string }[];
  foods: AnalyzedFood[];
}

/** Carries the HTTP status your own API should answer with. */
export class PythonServiceError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'PythonServiceError';
  }
}

export interface PythonClientOptions {
  baseUrl: string;          // e.g. http://127.0.0.1:8000
  timeoutMs?: number | undefined;   // the models can be slow; default 3 minutes
  apiKey?: string | undefined;   // sent as x-internal-key; the Python side checks it
}

async function readDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === 'string') return body.detail;
    if (body.detail !== undefined) return JSON.stringify(body.detail);   // FastAPI 422 lists
  } catch {
    /* not JSON */
  }
  return res.statusText || `Python service returned ${res.status}`;
}

export function createPythonClient({ baseUrl, timeoutMs = 180000, apiKey }: PythonClientOptions) {
  async function analyzeMeal(
    image: Uint8Array,                 // a Node Buffer works
    mimeType: string,
    plateDiameterM?: number,
    signal?: AbortSignal,              // abort when your own client disconnects
  ): Promise<AnalyzeResponse> {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(image)], { type: mimeType }), 'meal.jpg');
    if (plateDiameterM !== undefined) form.append('plate_diameter_m', String(plateDiameterM));

    // With exactOptionalPropertyTypes a property must be left out, not set to undefined.
    const headers: Record<string, string> = {};
    if (apiKey) headers['x-internal-key'] = apiKey;

    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, timeoutMs);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener('abort', onAbort);

    try {
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/analyze`, {
          method: 'POST',
          body: form,                  // fetch sets the multipart boundary itself
          headers,
          signal: ctrl.signal,
        });
      } catch {
        if (timedOut) throw new PythonServiceError('The analysis service timed out.', 504);
        if (signal?.aborted) throw new PythonServiceError('Request cancelled by the client.', 499);
        throw new PythonServiceError('The analysis service is unreachable.', 502);
      }

      if (!res.ok) {
        const detail = await readDetail(res);
        // Pass client errors (bad image, bad key) through; hide Python crashes behind a 502.
        throw new PythonServiceError(detail, res.status >= 400 && res.status < 500 ? res.status : 502);
      }
      return (await res.json()) as AnalyzeResponse;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  return { analyzeMeal };
}