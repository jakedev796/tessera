import { NextResponse } from 'next/server';
import { getTelemetryBootstrapInfo } from '@/lib/telemetry/server-state';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const bootstrap = await getTelemetryBootstrapInfo();
    return NextResponse.json(bootstrap);
  } catch (error) {
    logger.error({ error }, 'GET /api/telemetry/bootstrap error');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
