import express from 'express';
import mongoose from 'mongoose';

import 'dotenv/config';

import macroRouter from './controllers/macro'
import userRouter from './controllers/user'

const PORT = Number(process.env.PORT ?? 3000);

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
    throw new Error('MONGO_URI is not defined');
}

mongoose.connect(MONGO_URI);

const app = express();

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api/macros', macroRouter)
app.use('/api/user', userRouter)

app.listen(PORT, () => console.log(`API listening on :${PORT}`));