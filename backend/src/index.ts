import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';

import authRouter from './routes/auth';
import agentsRouter from './routes/agents';
import logsRouter from './routes/logs';
import workspaceRouter from './routes/workspace';
import memoryRouter from './routes/memory';
import configRouter from './routes/config';
import analyticsRouter from './routes/analytics';
import authProfilesRouter from './routes/auth-profiles';
import { redactMiddleware } from './middleware/redact';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.BACKEND_PORT || '3001', 10);
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';

// Security
app.use(helmet());

// CORS — allow localhost and Tailscale IP
const allowedOrigins = [
  FRONTEND_URL,
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://100.79.10.35:3000',
];
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, mobile apps) or matching origins
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: origin ${origin} not allowed`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Cookie parsing
app.use(cookieParser());

// Routes (redact middleware applied inside each route for SSE compatibility)
app.use('/api/auth', authRouter);
app.use('/api/agents', agentsRouter);
app.use('/api/logs', logsRouter);
app.use('/api/workspace', workspaceRouter);
app.use('/api/memory', memoryRouter);
app.use('/api/config', configRouter);
app.use('/api/auth-profiles', authProfilesRouter);
app.use('/api/analytics', analyticsRouter);

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend running on port ${PORT}`);
});

export default app;
