import express from 'express';

import macroRouter from './controllers/macro'
import userRouter from './controllers/user'

const PORT = Number(process.env.PORT ?? 3000);

const app = express();

app.use('/api/macros', macroRouter)
app.use('/api/user', userRouter)

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`API listening on :${PORT}`));