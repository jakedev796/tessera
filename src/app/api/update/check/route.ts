import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedUserId } from '@/lib/auth/api-auth';
import { checkForUpdates } from '@/lib/update/update-checker';
import logger from '@/lib/logger';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuthenticatedUserId(request);
    if ('response' in auth) {
      return auth.response;
    }

    return NextResponse.json(await checkForUpdates());
  } catch (error) {
    logger.error({ error }, 'GET /api/update/check error');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
