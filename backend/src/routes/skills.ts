import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

// Skill directory — use env or fall back to standard location
const WORKSPACE_PATH = process.env['WORKSPACE_main'] || process.env['WORKSPACE_MAIN'] || '/home/tonic/.openclaw/workspace';
const SKILLS_DIR = path.join(WORKSPACE_PATH, 'skills');
const CLAWHUB_BIN = '/home/tonic/.npm-global/bin/clawhub';

interface SkillMeta {
  slug: string;
  name?: string;
  description?: string;
  version?: string;
  publishedAt?: number;
  ownerId?: string;
}

interface Skill {
  id: string;           // directory name
  name: string;
  description: string;
  version?: string;
  publishedAt?: number;
  hasSkillMd: boolean;
  files: string[];
  installed: boolean;   // always true for local
  fromClawHub: boolean;
}

function readSkillMd(skillDir: string): { name?: string; description?: string } {
  const mdPath = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(mdPath)) return {};
  const content = fs.readFileSync(mdPath, 'utf-8');
  // Parse frontmatter
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (!fmMatch) return { description: content.slice(0, 200) };
  const fm = fmMatch[1];
  const nameMatch = fm.match(/^name:\s*(.+)$/m);
  const descMatch = fm.match(/^description:\s*(.+)$/m);
  return {
    name: nameMatch?.[1]?.trim(),
    description: descMatch?.[1]?.trim(),
  };
}

function readMeta(skillDir: string): SkillMeta | null {
  const metaPath = path.join(skillDir, '_meta.json');
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf-8')) as SkillMeta;
  } catch {
    return null;
  }
}

function listSkills(): Skill[] {
  if (!fs.existsSync(SKILLS_DIR)) return [];

  const entries = fs.readdirSync(SKILLS_DIR, { withFileTypes: true });
  const skills: Skill[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

    const skillDir = path.join(SKILLS_DIR, entry.name);
    const skillMd = readSkillMd(skillDir);
    const meta = readMeta(skillDir);
    const files = fs.existsSync(skillDir)
      ? fs.readdirSync(skillDir).filter((f) => !f.startsWith('.')).slice(0, 20)
      : [];

    skills.push({
      id: entry.name,
      name: skillMd.name ?? meta?.slug ?? entry.name,
      description: skillMd.description ?? '',
      version: meta?.version,
      publishedAt: meta?.publishedAt,
      hasSkillMd: fs.existsSync(path.join(skillDir, 'SKILL.md')),
      files,
      installed: true,
      fromClawHub: !!meta,
    });
  }

  return skills.sort((a, b) => a.id.localeCompare(b.id));
}

// GET /api/skills — list installed skills
router.get('/', (_req: Request, res: Response) => {
  try {
    const skills = listSkills();
    res.json({ skills, skillsDir: SKILLS_DIR });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/skills/:id/readme — get SKILL.md content
router.get('/:id/readme', (req: Request, res: Response) => {
  const { id } = req.params;
  // Sanitize: no path traversal
  if (id.includes('..') || id.includes('/')) {
    res.status(400).json({ error: 'Invalid skill id' });
    return;
  }
  const mdPath = path.join(SKILLS_DIR, id, 'SKILL.md');
  if (!fs.existsSync(mdPath)) {
    res.status(404).json({ error: 'SKILL.md not found' });
    return;
  }
  res.json({ content: fs.readFileSync(mdPath, 'utf-8') });
});

// POST /api/skills/install — install from ClawHub
router.post('/install', (req: Request, res: Response) => {
  const { slug } = req.body as { slug?: string };
  if (!slug || typeof slug !== 'string' || !/^[a-z0-9_-]+$/i.test(slug)) {
    res.status(400).json({ error: 'Invalid slug' });
    return;
  }

  // Check clawhub exists
  if (!fs.existsSync(CLAWHUB_BIN)) {
    res.status(500).json({ error: 'clawhub CLI not found' });
    return;
  }

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const cmd = `${CLAWHUB_BIN} install --workdir "${WORKSPACE_PATH}" --no-input ${slug}`;
  const child = exec(cmd, { timeout: 60000 });

  child.stdout?.on('data', (chunk: Buffer) => res.write(chunk));
  child.stderr?.on('data', (chunk: Buffer) => res.write(chunk));
  child.on('close', (code) => {
    res.write(`\n[exit ${code}]`);
    res.end();
  });
  child.on('error', (err) => {
    res.write(`\nError: ${err.message}`);
    res.end();
  });
});

// POST /api/skills/update — update a skill (or all)
router.post('/update', (req: Request, res: Response) => {
  const { slug } = req.body as { slug?: string };

  if (!fs.existsSync(CLAWHUB_BIN)) {
    res.status(500).json({ error: 'clawhub CLI not found' });
    return;
  }

  const slugArg = slug && /^[a-z0-9_-]+$/i.test(slug) ? slug : '';

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Transfer-Encoding', 'chunked');

  const cmd = `${CLAWHUB_BIN} update --workdir "${WORKSPACE_PATH}" --no-input ${slugArg}`;
  const child = exec(cmd, { timeout: 120000 });

  child.stdout?.on('data', (chunk: Buffer) => res.write(chunk));
  child.stderr?.on('data', (chunk: Buffer) => res.write(chunk));
  child.on('close', (code) => { res.write(`\n[exit ${code}]`); res.end(); });
  child.on('error', (err) => { res.write(`\nError: ${err.message}`); res.end(); });
});

// DELETE /api/skills/:id — remove a skill directory
router.delete('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  if (id.includes('..') || id.includes('/')) {
    res.status(400).json({ error: 'Invalid skill id' });
    return;
  }

  const skillDir = path.join(SKILLS_DIR, id);
  if (!fs.existsSync(skillDir)) {
    res.status(404).json({ error: 'Skill not found' });
    return;
  }

  try {
    // Use clawhub uninstall if available, otherwise rm -rf
    if (fs.existsSync(CLAWHUB_BIN)) {
      const cmd = `${CLAWHUB_BIN} uninstall --workdir "${WORKSPACE_PATH}" --no-input ${id}`;
      exec(cmd, { timeout: 30000 }, (err, stdout, stderr) => {
        if (err && !fs.existsSync(skillDir)) {
          // Already removed
          res.json({ success: true });
        } else if (err) {
          // Fall back to rm
          fs.rmSync(skillDir, { recursive: true, force: true });
          res.json({ success: true });
        } else {
          res.json({ success: true, output: stdout + stderr });
        }
      });
    } else {
      fs.rmSync(skillDir, { recursive: true, force: true });
      res.json({ success: true });
    }
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /api/skills/search/:query — search ClawHub
router.get('/search/:query', (req: Request, res: Response) => {
  const { query } = req.params;

  if (!fs.existsSync(CLAWHUB_BIN)) {
    res.status(500).json({ error: 'clawhub CLI not found' });
    return;
  }

  exec(`${CLAWHUB_BIN} search --no-input "${query.replace(/"/g, '')}"`, { timeout: 15000 }, (err, stdout, stderr) => {
    if (err) {
      res.status(500).json({ error: stderr || String(err) });
      return;
    }
    res.json({ results: stdout });
  });
});

export default router;
