import type { NextRequest } from 'next/server';

type AuthCookieRequest = Pick<NextRequest, 'headers' | 'nextUrl'>;

export function shouldUseSecureAuthCookie(request: AuthCookieRequest): boolean {
  if (process.env.NODE_ENV !== 'production') {
    return false;
  }

  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    ?.toLowerCase();

  if (forwardedProto) {
    return forwardedProto === 'https';
  }

  return request.nextUrl.protocol === 'https:';
}

export function getAuthCookieOptions(request: AuthCookieRequest, maxAge: number) {
  return {
    httpOnly: true,
    secure: shouldUseSecureAuthCookie(request),
    sameSite: 'strict' as const,
    maxAge,
    path: '/',
  };
}
