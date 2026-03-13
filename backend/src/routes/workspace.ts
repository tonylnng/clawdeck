import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { requireAuth } from '../middleware/auth';

const router = Router();
router.use(requireAuth);

// Agent workspace path mapping — dynamically built from env vars
// Each agent's workspace is set via WORKSPACE_<AGENT_ID_UPPERCASED> env var
// e.g. WORKSPACE_MAIN, WORKSPACE_TONIC_AI_TECH, WORKSPACE_TONIC_AI_WORKFLOW
// CLAWDECK_AGENTS is a comma-separated list of agent IDs
function buildWorkspacePaths(): Record<string, string> {
  const paths: Record<string, string> = {};
  const agentIds = (process.env.CLAWDECK_AGENTS || 'main')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  for (const agentId of agentIds) {
    const envKey = `WORKSPACE_${agentId.toUpperCase().replace(/-/g, '_')}`;
    const wsPath = process.env[envKey];
    if (wsPath) {
      paths[agentId] = wsPath;
    } else {
      // Fallback: derive from standard OpenClaw convention
      const home = process.env.HOME || '/home/tonic';
      const ocDir = process.env.OPENCLAW_DIR || `${home}/.openclaw`;
      paths[agentId] =
        agentId === 'main'
          ? `${ocDir}/workspace`
          : `${ocDir}/workspace-${agentId}`;
    }
  }

  return paths;
}

const WORKSPACE_PATHS: Record<string, string> = buildWorkspacePaths();

// Blacklisted filenames / patterns
const BLACKLIST_NAMES = ['auth-profiles.json', '.env', 'openclaw.json'];
const BLACKLIST_PATTERNS = [/^.*\.env$/, /^.*\.key$/, /^.*\.pem$/];

function isBlacklisted(filePath: string): boolean {
  const basename = path.basename(filePath);
  if (BLACKLIST_NAMES.includes(basename)) return true;
  for (const pattern of BLACKLIST_PATTERNS) {
    if (pattern.test(basename)) return true;
  }
  return false;
}

function getWorkspacePath(agentId: string): string | null {
  return WORKSPACE_PATHS[agentId] || null;
}

function safeResolvePath(workspaceRoot: string, relativePath: string): string | null {
  const resolved = path.resolve(workspaceRoot, relativePath);
  if (!resolved.startsWith(workspaceRoot)) return null; // path traversal guard
  return resolved;
}

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
}

function buildTree(dirPath: string, relBase: string, depth: number): TreeNode[] {
  if (depth > 3) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const nodes: TreeNode[] = [];
  for (const entry of entries) {
    // Skip hidden files/dirs at depth 1 except for relevant ones
    if (entry.name.startsWith('.') && depth === 1) continue;

    const relPath = path.join(relBase, entry.name);
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: relPath,
        type: 'directory',
        children: depth < 3 ? buildTree(path.join(dirPath, entry.name), relPath, depth + 1) : [],
      });
    } else if (entry.isFile()) {
      if (!isBlacklisted(entry.name)) {
        nodes.push({ name: entry.name, path: relPath, type: 'file' });
      }
    }
  }

  // Sort: directories first, then files
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return nodes;
}

// GET /api/workspace/:agentId/tree
router.get('/:agentId/tree', (req: Request, res: Response) => {
  const { agentId } = req.params;
  const workspaceRoot = getWorkspacePath(agentId);
  if (!workspaceRoot) {
    res.status(404).json({ error: `Unknown agent: ${agentId}` });
    return;
  }
  if (!fs.existsSync(workspaceRoot)) {
    res.status(404).json({ error: `Workspace not found for agent: ${agentId}` });
    return;
  }
  const tree = buildTree(workspaceRoot, '', 1);
  res.json({ agentId, root: workspaceRoot, tree });
});

// GET /api/workspace/:agentId/file?path=
router.get('/:agentId/file', (req: Request, res: Response) => {
  const { agentId } = req.params;
  const relPath = req.query.path as string;

  if (!relPath) {
    res.status(400).json({ error: 'Missing path query parameter' });
    return;
  }

  const workspaceRoot = getWorkspacePath(agentId);
  if (!workspaceRoot) {
    res.status(404).json({ error: `Unknown agent: ${agentId}` });
    return;
  }

  if (isBlacklisted(relPath)) {
    res.status(403).json({ error: 'Access to this file is not permitted' });
    return;
  }

  const fullPath = safeResolvePath(workspaceRoot, relPath);
  if (!fullPath) {
    res.status(403).json({ error: 'Path traversal not allowed' });
    return;
  }

  if (!fs.existsSync(fullPath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }

  const stat = fs.statSync(fullPath);
  if (!stat.isFile()) {
    res.status(400).json({ error: 'Path is not a file' });
    return;
  }

  const MAX_SIZE = 500 * 1024; // 500KB
  if (stat.size > MAX_SIZE) {
    res.status(413).json({ error: 'File too large (max 500KB)' });
    return;
  }

  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    res.json({ path: relPath, content, size: stat.size, mtime: stat.mtime });
  } catch (err) {
    res.status(500).json({ error: 'Failed to read file', detail: String(err) });
  }
});

// PUT /api/workspace/:agentId/file?path=
router.put('/:agentId/file', (req: Request, res: Response) => {
  const { agentId } = req.params;
  const relPath = req.query.path as string;
  const { content } = req.body as { content: string };

  if (!relPath) {
    res.status(400).json({ error: 'Missing path query parameter' });
    return;
  }
  if (typeof content !== 'string') {
    res.status(400).json({ error: 'Missing or invalid content in body' });
    return;
  }

  const workspaceRoot = getWorkspacePath(agentId);
  if (!workspaceRoot) {
    res.status(404).json({ error: `Unknown agent: ${agentId}` });
    return;
  }

  if (isBlacklisted(relPath)) {
    res.status(403).json({ error: 'Access to this file is not permitted' });
    return;
  }

  const fullPath = safeResolvePath(workspaceRoot, relPath);
  if (!fullPath) {
    res.status(403).json({ error: 'Path traversal not allowed' });
    return;
  }

  try {
    fs.writeFileSync(fullPath, content, 'utf-8');
    res.json({ ok: true, path: relPath });
  } catch (err) {
    res.status(500).json({ error: 'Failed to write file', detail: String(err) });
  }
});

export default router;
