import express from 'express';
import multer from 'multer';
import { createPythonClient, PythonServiceError } from './pythonClient';

const PORT = Number(process.env.PORT ?? 3000);

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

  let plateDiameterM: number | undefined;
  if (req.body?.plate_diameter_m !== undefined && req.body.plate_diameter_m !== '') {
    plateDiameterM = Number(req.body.plate_diameter_m);
    if (!Number.isFinite(plateDiameterM) || plateDiameterM < 0.05 || plateDiameterM > 0.6) {
      res.status(400).json({ error: 'plate_diameter_m must be between 0.05 and 0.6 (meters).' });
      return;
    }
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
      plateDiameterM,
      clientGone.signal,
    );
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

app.listen(PORT, () => console.log(`API listening on :${PORT}`));