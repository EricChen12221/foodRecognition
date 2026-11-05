import { createPythonClient } from './pythonClient';

export const python = createPythonClient({
  baseUrl: process.env.PYTHON_URL ?? 'http://127.0.0.1:8000',
  apiKey: process.env.PYTHON_API_KEY,
  timeoutMs: Number(process.env.PYTHON_TIMEOUT_MS ?? 180000),
});