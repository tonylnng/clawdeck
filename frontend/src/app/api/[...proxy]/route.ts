import { NextRequest, NextResponse } from 'next/server';

// Read at request time (not module load) so runtime env overrides work in Docker
function getBackendUrl() {
  return process.env.BACKEND_INTERNAL_URL || 'http://localhost:3001';
}

export async function GET(req: NextRequest, { params }: { params: { proxy: string[] } }) {
  return proxyRequest(req, params.proxy, 'GET');
}

export async function POST(req: NextRequest, { params }: { params: { proxy: string[] } }) {
  return proxyRequest(req, params.proxy, 'POST');
}

export async function PUT(req: NextRequest, { params }: { params: { proxy: string[] } }) {
  return proxyRequest(req, params.proxy, 'PUT');
}

export async function DELETE(req: NextRequest, { params }: { params: { proxy: string[] } }) {
  return proxyRequest(req, params.proxy, 'DELETE');
}

async function proxyRequest(req: NextRequest, pathSegments: string[], method: string) {
  // Forward cookie directly from incoming request header
  const incomingCookie = req.headers.get('cookie') || '';

  const targetPath = pathSegments.join('/');
  const search = req.nextUrl.search || '';
  const url = `${getBackendUrl()}/api/${targetPath}${search}`;

  const headers: Record<string, string> = {
    'Content-Type': req.headers.get('content-type') || 'application/json',
  };

  if (incomingCookie) {
    headers['Cookie'] = incomingCookie;
  }

  let body: BodyInit | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const contentType = req.headers.get('content-type') || '';
    if (contentType.includes('multipart/form-data')) {
      body = await req.formData() as unknown as BodyInit;
      delete headers['Content-Type']; // Let fetch set it with boundary
    } else {
      body = await req.text();
    }
  }

  try {
    const res = await fetch(url, { method, headers, body });

    const resContentType = res.headers.get('content-type') || '';

    // Handle SSE streaming — pipe body directly so chunks flush immediately
    if (resContentType.includes('text/event-stream')) {
      if (!res.body) {
        return new NextResponse('No stream body', { status: 502 });
      }

      // Use TransformStream to pass through chunks without buffering
      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const reader = res.body.getReader();

      // Pump chunks in the background
      (async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              await writer.close();
              break;
            }
            await writer.write(value);
          }
        } catch {
          try { await writer.abort(); } catch { /* ignore */ }
        }
      })();

      return new NextResponse(readable, {
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    const data = await res.text();

    // Build response headers — must forward Set-Cookie for auth to work
    const responseHeaders = new Headers();
    responseHeaders.set('Content-Type', resContentType || 'application/json');

    // Forward all Set-Cookie headers from backend (critical for login)
    res.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        responseHeaders.append('Set-Cookie', value);
      }
    });

    return new NextResponse(data, {
      status: res.status,
      headers: responseHeaders,
    });
  } catch (err) {
    return NextResponse.json({ error: 'Proxy error', detail: String(err) }, { status: 502 });
  }
}
