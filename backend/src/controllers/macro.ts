import express, { Router } from 'express'
import { macrosForMeal } from '../helpers/foods'
import { createPythonClient, PythonServiceError } from '../helpers/pythonClient';
import multer from 'multer';

const router = Router()

const PYTHON_URL = process.env.PYTHON_URL ?? 'http://127.0.0.1:8000';
const PYTHON_TIMEOUT_MS = Number(process.env.PYTHON_TIMEOUT_MS ?? 180000);

const python = createPythonClient({
  baseUrl: process.env.PYTHON_URL ?? 'http://127.0.0.1:8000',
  apiKey: process.env.PYTHON_API_KEY,
  timeoutMs: Number(process.env.PYTHON_TIMEOUT_MS ?? 180000),
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });


router.post('/analyze', upload.single('image'), async (req, res) => {
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

router.post('/estimate', express.json(), async (req, res) => {
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
    console.log(body)
    return res.status(upstream.status).json(body);               // keeps 404 (expired session), 400, 500
  } catch (e) {
    console.log(e)
    return res.status(502).json({ detail: 'Could not reach the analysis server.' });
  }
});

router.post('/convert', express.json(), async(req, res) => {
  console.log('macros body:', req.headers['content-type'], JSON.stringify(req.body));
  const { volumes } = req.body ?? {};
  if (!Array.isArray(volumes)) {
    return res.status(400).json({ detail: 'volumes are required.' });
  }

  const macros = macrosForMeal(volumes)
  console.log(macros)
  res.status(200).json(macros)
})

export default router