import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { requireAuth, AuthPayload } from '../middleware/auth';
import { redactMiddleware } from '../middleware/redact';

const router = Router();

router.use(redactMiddleware);

router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' });
    return;
  }

  const expectedUsername = process.env.ADMIN_USERNAME || 'admin';
  const passwordHash = process.env.ADMIN_PASSWORD_HASH || '';

  if (username !== expectedUsername) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  let valid = false;
  if (passwordHash) {
    valid = await bcrypt.compare(password, passwordHash);
  } else {
    // Fallback for dev: allow plain password match via env
    const plainPassword = process.env.ADMIN_PASSWORD || 'admin';
    valid = password === plainPassword;
  }

  if (!valid) {
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  const secret = process.env.JWT_SECRET || 'changeme-32chars-secret-key!!!';
  const expiresIn = process.env.JWT_EXPIRES_IN || '24h';

  const token = jwt.sign({ username }, secret, { expiresIn } as jwt.SignOptions);

  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';

  res.cookie('auth_token', token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: isHttps ? 'strict' : 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24h
    path: '/',
  });

  res.json({ ok: true, username });
});

router.post('/logout', (_req, res: Response) => {
  res.clearCookie('auth_token', { path: '/' });
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req: Request, res: Response) => {
  const user = (req as Request & { user: AuthPayload }).user;
  res.json({ username: user.username });
});

export default router;
