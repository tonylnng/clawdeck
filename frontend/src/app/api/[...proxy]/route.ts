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

    // Handle SSE streaming
    if (resContentType.includes('text/event-stream')) {
      return new NextResponse(res.body, {
        status: res.status,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      });
    }

    const data = await res.text();
    return new NextResponse(data, {
      status: res.status,
      headers: { 'Content-Type': resContentType || 'application/json' },
    });
  } catch (err) {
    return NextResponse.json({ error: 'Proxy error', detail: String(err) }, { status: 502 });
  }
}
