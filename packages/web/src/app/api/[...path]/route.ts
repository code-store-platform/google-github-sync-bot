import { authorizeDashboard } from '../../../lib/server-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function forward(request: Request): Promise<Response> {
  // Check here as well: proxy middleware is not the API authorization boundary.
  const rejection = authorizeDashboard(request);
  if (rejection) return rejection;
  const token = process.env.API_AUTH_TOKEN;
  if (!token || token.length < 32) {
    return new Response('API authentication is not configured', { status: 503 });
  }
  const incoming = new URL(request.url);
  const target = new URL(process.env.BFF_URL || 'http://localhost:4000');
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  const headers = new Headers({ authorization: `Bearer ${token}` });
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);
  try {
    const response = await fetch(target, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
      cache: 'no-store',
      redirect: 'manual',
      signal: request.signal,
    });
    const responseHeaders = new Headers({ 'cache-control': 'no-store' });
    const responseType = response.headers.get('content-type');
    if (responseType) responseHeaders.set('content-type', responseType);
    return new Response(response.body, { status: response.status, headers: responseHeaders });
  } catch {
    return new Response('API unavailable', { status: 502 });
  }
}

export { forward as GET, forward as POST, forward as PATCH, forward as PUT, forward as DELETE };
