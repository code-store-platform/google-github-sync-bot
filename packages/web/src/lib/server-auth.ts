import { secretMatches } from '@google-github-sync/shared/server-auth';

export function authorizeDashboard(request: Request): Response | undefined {
  const username = process.env.DASHBOARD_USERNAME;
  const password = process.env.DASHBOARD_PASSWORD;
  if (!username || username.includes(':') || !password || password.length < 16) {
    return new Response('Dashboard authentication is not configured', {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    });
  }
  const expected = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  if (!secretMatches(request.headers.get('authorization') ?? '', expected)) {
    return new Response('Authentication required', {
      status: 401,
      headers: {
        'www-authenticate': 'Basic realm="Sync dashboard", charset="UTF-8"',
        'cache-control': 'no-store',
      },
    });
  }
  // Basic credentials are ambient browser credentials; protect writes from CSRF.
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('origin');
    const allowedOrigin = process.env.CORS_ORIGIN || 'http://localhost:3001';
    if (
      request.headers.get('sec-fetch-site') === 'cross-site' ||
      (origin !== null && origin !== allowedOrigin)
    ) {
      return new Response('Forbidden origin', { status: 403 });
    }
  }
}
