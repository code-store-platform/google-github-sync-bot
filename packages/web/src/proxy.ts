import { NextResponse, type NextRequest } from 'next/server';
import { authorizeDashboard } from './lib/server-auth';

export function proxy(request: NextRequest) {
  return authorizeDashboard(request) ?? NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
