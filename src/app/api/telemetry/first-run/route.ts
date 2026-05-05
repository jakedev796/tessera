import { NextRequest, NextResponse } from 'next/server';
import { getServerHostInfo } from '@/lib/system/server-host';
import { markTelemetryFirstRun } from '@/lib/telemetry/server-state';
import logger from '@/lib/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { status?: unknown };
    const requestedStatus = body.status === 'captured' ? 'captured' : 'skipped';
    const status = getServerHostInfo().telemetryDisabledByEnv ? 'skipped' : requestedStatus;
    const state = await markTelemetryFirstRun(status);
    return NextResponse.json({ success: true, state });
  } catch (error) {
    logger.error({ error }, 'POST /api/telemetry/first-run error');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
    );
  }
}
