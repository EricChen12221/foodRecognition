import express, { Router } from 'express';
import multer from 'multer';
import { macrosForMeal } from '../helpers/foods';
import { PythonServiceError } from '../helpers/pythonClient';
import { python } from '../helpers/python';
import { upload, abortOnDisconnect } from '../helpers/upload';
import { requireUser, getUserId } from '../middleware';

const router = Router();

router.post('/api/cancel/:id', requireUser, async (req, res) => {
  const id = req.params.id;
  if (typeof id !== 'string' || id === '') return res.status(400).json({ error: 'id required' });

  await python.cancelAnalysis(id, getUserId(res));
  res.json({ ok: true });
});

router.post('/analyze', requireUser, upload.single('image'), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: 'An "image" file is required.' });
    return;
  }

  const clientGone = abortOnDisconnect(res);

  try {
    const result = await python.analyzeMeal(req.file.buffer, req.file.mimetype, getUserId(res), clientGone.signal);
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

router.post('/estimate', requireUser, express.json(), async (req, res) => {
  const { session_id, containers, foods } = req.body ?? {};
  if (!session_id || !Array.isArray(containers)) {
    return res.status(400).json({ detail: 'session_id and containers are required.' });
  }

  const clientGone = abortOnDisconnect(res);

  try {
    const result = await python.estimateMeal({ session_id, containers, foods }, getUserId(res), clientGone.signal );
    res.json(result);
  } catch (e) {
    if (e instanceof PythonServiceError) {
      if (e.status !== 499) res.status(e.status).json({ detail: e.message });
      return;
    }
    console.error(e);
    res.status(500).json({ detail: 'Unexpected server error.' });
  }
});

router.post('/convert', requireUser, express.json(), async (req, res) => {
  const { volumes } = req.body ?? {};
  if (!Array.isArray(volumes)) {
    return res.status(400).json({ detail: 'volumes are required.' });
  }
  res.status(200).json(macrosForMeal(volumes));
});

export default router;