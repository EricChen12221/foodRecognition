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

export interface EstimateRequest {
  session_id: string;
  containers: unknown[];
  foods?: unknown;
}

// Tighten this to match what your /estimate endpoint actually returns.
export type EstimateResponse = Record<string, unknown>;

export interface CalibrateResponse {
  shape: unknown; // tighten to whatever setProfileShape expects
  warnings?: string[];
}

/** Carries the HTTP status your own API should answer with. */
export class PythonServiceError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'PythonServiceError';
  }
}

export interface PythonClientOptions {
  baseUrl: string;                  // e.g. http://127.0.0.1:8000
  timeoutMs?: number | undefined;   // the models can be slow; default 3 minutes
  apiKey?: string | undefined;      // sent as x-internal-key; the Python side checks it
}

interface RequestOptions {
  method: 'GET' | 'POST';
  body?: BodyInit;
  headers?: Record<string, string>;
  signal?: AbortSignal | undefined;
  timeoutMs?: number;
  userId?: string | undefined;
}

async function readDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: unknown };
    if (typeof body.detail === 'string') return body.detail;
    if (body.detail !== undefined) return JSON.stringify(body.detail); // FastAPI 422 lists
  } catch {
    /* not JSON */
  }
  return res.statusText || `Python service returned ${res.status}`;
}

export function createPythonClient({ baseUrl, timeoutMs = 180000, apiKey }: PythonClientOptions) {
  /** Shared plumbing: auth header, timeout, client-abort, error mapping. */
  async function request(path: string, opts: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = { ...opts.headers };
    if (apiKey) headers['x-internal-key'] = apiKey;
    if (opts.userId) headers['x-user-id'] = opts.userId;

    const ctrl = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      ctrl.abort();
    }, opts.timeoutMs ?? timeoutMs);
    const onAbort = () => ctrl.abort();
    opts.signal?.addEventListener('abort', onAbort);

    try {
      let res: Response;
      try {
        res = await fetch(`${baseUrl}${path}`, {
          method: opts.method,
          headers,
          signal: ctrl.signal,
          ...(opts.body !== undefined ? { body: opts.body } : {}),
        });
      } catch {
        if (timedOut) throw new PythonServiceError('The analysis service timed out.', 504);
        if (opts.signal?.aborted) throw new PythonServiceError('Request cancelled by the client.', 499);
        throw new PythonServiceError('The analysis service is unreachable.', 502);
      }

      if (!res.ok) {
        const detail = await readDetail(res);
        throw new PythonServiceError(detail, res.status >= 400 && res.status < 500 ? res.status : 502);
      }
      return res;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  async function analyzeMeal(
    image: Uint8Array,    
    mimeType: string,
    userId: string,
    signal?: AbortSignal,
  ): Promise<AnalyzeResponse> {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(image)], { type: mimeType }), 'meal.jpg');

    // fetch sets the multipart boundary itself, so no Content-Type here.
    const res = await request('/analyze', { method: 'POST', body: form, userId, signal });
    return (await res.json()) as AnalyzeResponse;
  }

  async function estimateMeal(
    payload: EstimateRequest,
    userId: string,
    signal?: AbortSignal,
  ): Promise<EstimateResponse> {
    const res = await request('/estimate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), userId, signal });
    return (await res.json()) as EstimateResponse;
  }

  /** Best-effort: never throws, since a failed cancel shouldn't break the caller. */
  async function cancelAnalysis(id: string, userId: string,): Promise<void> {
    try {
      await request(`/cancel/${encodeURIComponent(id)}`, { method: 'POST', userId, timeoutMs: 5000 });
    } catch {
      /* ignore */
    }
  }

  async function calibrateProfile(
      image: Uint8Array,
      mimeType: string,
      userId: string,
      diameterM: number,
      measuredDepthMm?: number,
      signal?: AbortSignal,
    ): Promise<CalibrateResponse> {
      const form = new FormData();
      form.append('image', new Blob([new Uint8Array(image)], { type: mimeType }), 'dish.jpg');
      form.append('diameter_m', String(diameterM));
      if (measuredDepthMm !== undefined && Number.isFinite(measuredDepthMm) && measuredDepthMm > 0) {
        form.append('measured_depth_mm', String(measuredDepthMm));
      }

      // No Content-Type here: fetch sets the multipart boundary itself.
      const res = await request('/calibrate', { method: 'POST', body: form, userId, signal });
      return (await res.json()) as CalibrateResponse;
    }

  return { analyzeMeal, estimateMeal, cancelAnalysis, calibrateProfile };
}