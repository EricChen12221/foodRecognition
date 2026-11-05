import multer from 'multer';
import type { Response } from 'express';

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

/** Aborts when the phone disconnects before we've finished responding. */
export function abortOnDisconnect(res: Response): AbortController {
  const ctrl = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) ctrl.abort();
  });
  return ctrl;
}