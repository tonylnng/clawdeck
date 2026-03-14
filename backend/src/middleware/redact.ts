import { Request, Response, NextFunction } from 'express';

const SENSITIVE_KEYS = /\b(token|secret|password|api_key|apikey|passwd|pwd|botToken|apiKey|gatewayToken|authToken|accessToken|refreshToken|privateKey)\b/i;

export function redactString(input: string): string {
  // sk- keys (OpenAI style)
  input = input.replace(/sk-[A-Za-z0-9]{20,}/g, (match) => {
    const last4 = match.slice(-4);
    return `sk-***...${last4}`;
  });

  // tvly- keys (Tavily)
  input = input.replace(/tvly-[A-Za-z0-9-]{20,}/g, (match) => {
    const last4 = match.slice(-4);
    return `tvly-***...${last4}`;
  });

  // jina_ keys
  input = input.replace(/jina_[A-Za-z0-9]{40,}/g, (match) => {
    const last4 = match.slice(-4);
    return `jina_***...${last4}`;
  });

  // ntn_ keys (Notion)
  input = input.replace(/ntn_[A-Za-z0-9]{30,}/g, (match) => {
    const last4 = match.slice(-4);
    return `ntn_***...${last4}`;
  });

  // Bearer tokens
  input = input.replace(/Bearer\s+[^\s"',}]{8,}/g, 'Bearer [REDACTED]');

  // JSON key "botToken": "..."
  input = input.replace(/"botToken"\s*:\s*"[^"]*"/g, '"botToken": "[REDACTED]"');

  // JSON key "apiKey": "..."
  input = input.replace(/"apiKey"\s*:\s*"[^"]*"/g, '"apiKey": "[REDACTED]"');

  return input;
}

export function redactObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;

  if (typeof obj === 'string') {
    return redactString(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(redactObject);
  }

  if (typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.test(key)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = redactObject(value);
      }
    }
    return result;
  }

  return obj;
}

export function redactMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Intercept res.json for regular JSON responses
  const originalJson = res.json.bind(res);
  res.json = function (data: unknown) {
    const redacted = redactObject(data);
    return originalJson(redacted);
  };

  // Intercept res.write for SSE streams — redact each chunk
  const originalWrite = res.write.bind(res);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (res as any).write = function (
    chunk: Buffer | string,
    encodingOrCallback?: BufferEncoding | ((error: Error | null | undefined) => void),
    callback?: (error: Error | null | undefined) => void
  ): boolean {
    if (typeof chunk === 'string') {
      const redacted = redactString(chunk);
      if (typeof encodingOrCallback === 'function') {
        return originalWrite(redacted, encodingOrCallback);
      }
      return originalWrite(redacted, encodingOrCallback as BufferEncoding, callback);
    } else if (Buffer.isBuffer(chunk)) {
      const redacted = redactString(chunk.toString('utf-8'));
      if (typeof encodingOrCallback === 'function') {
        return originalWrite(redacted, encodingOrCallback);
      }
      return originalWrite(redacted, encodingOrCallback as BufferEncoding, callback);
    }
    if (typeof encodingOrCallback === 'function') {
      return originalWrite(chunk, encodingOrCallback);
    }
    return originalWrite(chunk, encodingOrCallback as BufferEncoding, callback);
  };

  next();
}
