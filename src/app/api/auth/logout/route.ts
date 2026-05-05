import { NextRequest, NextResponse } from 'next/server';
import { getAuthCookieOptions } from '@/lib/auth/cookies';
import logger from '@/lib/logger';
import type { LogoutResponse } from '@/types/auth';

export async function POST(request: NextRequest) {
  const response: LogoutResponse = {
    success: true,
    message: 'Logged out.',
  };

  logger.debug('User logged out');

  const nextResponse = NextResponse.json(response);

  // Clear JWT cookie
  nextResponse.cookies.set('jwt', '', getAuthCookieOptions(request, 0));

  return nextResponse;
}
