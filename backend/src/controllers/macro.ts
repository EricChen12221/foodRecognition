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

router.post('/api/cancel/:id', async (req, res) => {
  const id = req.params.id
  if (typeof id !== 'string' || id === '') return res.status(400).json({ error: 'id required' })

  await fetch(`${PYTHON_URL}/cancel/${encodeURIComponent(id)}`, { method: 'POST' }).catch(() => {})
  res.json({ ok: true })
})

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
  const { session_id, containers, foods } = req.body ?? {};
  if (!session_id || !Array.isArray(containers)) {
    return res.status(400).json({ detail: 'session_id and containers are required.' });
  }

  const clientGone = new AbortController()
  let timedOut = false
  res.on('close', () => { if (!res.writableFinished) clientGone.abort() })
  const timer = setTimeout(() => { timedOut = true; clientGone.abort() }, PYTHON_TIMEOUT_MS)

  try {
    const upstream = await fetch(`${PYTHON_URL}/estimate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(process.env.PYTHON_API_KEY ? { 'x-internal-key': process.env.PYTHON_API_KEY } : {}),
      },
      body: JSON.stringify({ session_id, containers, foods }),
      signal: clientGone.signal,
    });
    const body = await upstream.json().catch(() => ({}));
    console.log(body)
    res.status(upstream.status).json(body);         
  } catch (e) {
    console.log(e)
    if (timedOut) return res.status(504).json({ detail: 'The analysis took too long.' })
    if (clientGone.signal.aborted) return
    return res.status(502).json({ detail: 'Could not reach the analysis server.' });
  } finally {
    clearTimeout(timer)
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