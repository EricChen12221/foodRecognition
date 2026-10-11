import express from 'express';
import multer from 'multer';
import { createPythonClient, PythonServiceError } from './pythonClient';

const PORT = Number(process.env.PORT ?? 3000);

const PYTHON_URL = process.env.PYTHON_URL ?? 'http://127.0.0.1:8000';
const PYTHON_TIMEOUT_MS = Number(process.env.PYTHON_TIMEOUT_MS ?? 180000);

const python = createPythonClient({
  baseUrl: process.env.PYTHON_URL ?? 'http://127.0.0.1:8000',
  apiKey: process.env.PYTHON_API_KEY,
  timeoutMs: Number(process.env.PYTHON_TIMEOUT_MS ?? 180000),
});

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// The app calls THIS endpoint. It validates the request, forwards the photo to Python,
// and returns Python's JSON. Put auth, rate limits, saving to a database, etc. here.
app.post('/api/analyze', upload.single('image'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'An "image" file is required.' });
    return;
  }

  // If the phone gives up, stop waiting on Python too.
  const clientGone = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) clientGone.abort();
  });

  try {
    const result = await python.analyzeMeal(
      req.file.buffer,
      req.file.mimetype,
      clientGone.signal,
    );
    console.log(result)
    res.json(result);
  } catch (e) {
    if (e instanceof PythonServiceError) {
      if (e.status !== 499) res.status(e.status).json({ error: e.message });
      return;
    }
    console.error(e);
    res.status(500).json({ error: 'Unexpected server error.' });
  }
});

app.post('/api/estimate', express.json(), async (req, res) => {
  const { session_id, containers } = req.body ?? {};
  if (!session_id || !Array.isArray(containers)) {
    return res.status(400).json({ detail: 'session_id and containers are required.' });
  }

  try {
    const upstream = await fetch(`${PYTHON_URL}/estimate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.PYTHON_API_KEY ? { 'x-internal-key': process.env.PYTHON_API_KEY } : {}),
      },
      body: JSON.stringify({ session_id, containers }),
      signal: AbortSignal.timeout(PYTHON_TIMEOUT_MS),
    });
    const body = await upstream.json().catch(() => ({}));
    res.status(upstream.status).json(body);               // keeps 404 (expired session), 400, 500
  } catch (e) {
    console.log(e)
    res.status(502).json({ detail: 'Could not reach the analysis server.' });
  }
});

app.listen(PORT, () => console.log(`API listening on :${PORT}`));