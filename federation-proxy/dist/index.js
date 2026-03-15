"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const node_fetch_1 = __importDefault(require("node-fetch"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const app = (0, express_1.default)();
app.use(express_1.default.json({ limit: '10mb' }));
// ── Config ────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PROXY_PORT || '18790', 10);
const BIND_HOST = process.env.BIND_HOST || '0.0.0.0';
const FEDERATION_TOKEN = process.env.FEDERATION_TOKEN || '';
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:18789';
const GATEWAY_TOKEN = process.env.GATEWAY_TOKEN || '';
const ALLOWED_IPS = process.env.ALLOWED_IPS || ''; // comma-separated CIDRs or IPs, empty = allow all
const RATE_LIMIT_RPM = parseInt(process.env.RATE_LIMIT_RPM || '120', 10);
const AUDIT_LOG = process.env.AUDIT_LOG !== 'false';
const LOG_DIR = process.env.LOG_DIR || '/app/logs';
if (!FEDERATION_TOKEN) {
    console.error('FATAL: FEDERATION_TOKEN is not set');
    process.exit(1);
}
if (!GATEWAY_TOKEN) {
    console.error('FATAL: GATEWAY_TOKEN is not set');
    process.exit(1);
}
// ── Audit Log ─────────────────────────────────────────────────────────────────
function writeAudit(entry) {
    if (!AUDIT_LOG)
        return;
    try {
        fs_1.default.mkdirSync(LOG_DIR, { recursive: true });
        const line = JSON.stringify({ ...entry, ts: new Date().toISOString() }) + '\n';
        fs_1.default.appendFileSync(path_1.default.join(LOG_DIR, 'audit.jsonl'), line);
    }
    catch { /* non-fatal */ }
}
// ── Rate Limiter ──────────────────────────────────────────────────────────────
const rateMap = new Map();
function checkRateLimit(ip) {
    const now = Date.now();
    const windowMs = 60000;
    const entry = rateMap.get(ip);
    if (!entry || now - entry.windowStart > windowMs) {
        rateMap.set(ip, { count: 1, windowStart: now });
        return true;
    }
    if (entry.count >= RATE_LIMIT_RPM)
        return false;
    entry.count++;
    return true;
}
// ── IP Allowlist ──────────────────────────────────────────────────────────────
function isIpAllowed(ip) {
    if (!ALLOWED_IPS)
        return true;
    const allowed = ALLOWED_IPS.split(',').map((s) => s.trim()).filter(Boolean);
    return allowed.some((cidr) => {
        if (!cidr.includes('/'))
            return ip === cidr;
        // Simple CIDR check for /8 /16 /24 ranges
        const [network, bits] = cidr.split('/');
        const mask = ~((1 << (32 - parseInt(bits))) - 1) >>> 0;
        const ipNum = ip.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct), 0) >>> 0;
        const netNum = network.split('.').reduce((acc, oct) => (acc << 8) + parseInt(oct), 0) >>> 0;
        return (ipNum & mask) === (netNum & mask);
    });
}
// ── Auth Middleware ───────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
    const clientIp = req.headers['x-forwarded-for']?.split(',')[0].trim()
        || req.socket.remoteAddress
        || 'unknown';
    // IP allowlist check
    if (!isIpAllowed(clientIp)) {
        writeAudit({ event: 'ip_blocked', ip: clientIp, path: req.path });
        res.status(403).json({ error: 'IP not allowed' });
        return;
    }
    // Rate limit check
    if (!checkRateLimit(clientIp)) {
        writeAudit({ event: 'rate_limited', ip: clientIp, path: req.path });
        res.status(429).json({ error: 'Rate limit exceeded' });
        return;
    }
    // Token check
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token || token !== FEDERATION_TOKEN) {
        writeAudit({ event: 'auth_failed', ip: clientIp, path: req.path });
        res.status(401).json({ error: 'Invalid federation token' });
        return;
    }
    writeAudit({ event: 'request', ip: clientIp, method: req.method, path: req.path });
    next();
}
// ── Health (no auth) ──────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', proxy: 'clawdeck-federation-proxy', version: '1.0.0' });
});
// ── Security Summary (auth required) ─────────────────────────────────────────
app.get('/security/summary', authMiddleware, (_req, res) => {
    try {
        const logFile = path_1.default.join(LOG_DIR, 'audit.jsonl');
        if (!fs_1.default.existsSync(logFile)) {
            res.json({ authFailures: 0, rateLimited: 0, ipBlocked: 0, totalRequests: 0 });
            return;
        }
        const lines = fs_1.default.readFileSync(logFile, 'utf-8').trim().split('\n').filter(Boolean);
        const oneHourAgo = Date.now() - 3600000;
        const recent = lines
            .map((l) => { try {
            return JSON.parse(l);
        }
        catch {
            return null;
        } })
            .filter((e) => e && new Date(e.ts).getTime() > oneHourAgo);
        res.json({
            authFailures: recent.filter((e) => e.event === 'auth_failed').length,
            rateLimited: recent.filter((e) => e.event === 'rate_limited').length,
            ipBlocked: recent.filter((e) => e.event === 'ip_blocked').length,
            totalRequests: recent.filter((e) => e.event === 'request').length,
            window: '1h',
        });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
// ── Proxy All Other Requests ───────────────────────────────────────────────────
app.all('*', authMiddleware, async (req, res) => {
    const targetUrl = `${GATEWAY_URL}${req.path}${req.url.includes('?') ? '?' + req.url.split('?')[1] : ''}`;
    // Build safe headers — strip federation token, inject gateway token
    const forwardHeaders = {
        'Content-Type': req.headers['content-type'] || 'application/json',
        'Authorization': `Bearer ${GATEWAY_TOKEN}`,
    };
    // Forward safe headers only
    const safeHeaders = ['accept', 'accept-language', 'user-agent'];
    safeHeaders.forEach((h) => {
        if (req.headers[h])
            forwardHeaders[h] = req.headers[h];
    });
    try {
        const body = ['GET', 'HEAD'].includes(req.method) ? undefined : JSON.stringify(req.body);
        const upstream = await (0, node_fetch_1.default)(targetUrl, {
            method: req.method,
            headers: forwardHeaders,
            body,
            signal: AbortSignal.timeout(30000),
        });
        const contentType = upstream.headers.get('content-type') || 'application/json';
        res.status(upstream.status);
        res.setHeader('Content-Type', contentType);
        res.setHeader('X-Federation-Proxy', '1');
        const text = await upstream.text();
        res.send(text);
    }
    catch (err) {
        res.status(502).json({ error: 'Gateway unreachable', detail: String(err) });
    }
});
// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, BIND_HOST, () => {
    console.log(`ClawDeck Federation Proxy v1.0.0`);
    console.log(`Listening on ${BIND_HOST}:${PORT}`);
    console.log(`Gateway: ${GATEWAY_URL}`);
    console.log(`IP Allowlist: ${ALLOWED_IPS || 'all (no restriction)'}`);
    console.log(`Rate Limit: ${RATE_LIMIT_RPM} req/min`);
    console.log(`Audit Log: ${AUDIT_LOG ? LOG_DIR + '/audit.jsonl' : 'disabled'}`);
});
exports.default = app;
