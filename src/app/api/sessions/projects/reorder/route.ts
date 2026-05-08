import { NextRequest, NextResponse } from 'next/server';
import { reorderProjects } from '@/lib/db/projects';
import { requireAuthenticatedUserId } from '@/lib/auth/api-auth';
import { broadcastSessionMutation, getOriginClientIdFromRequest } from '@/lib/ws/mutation-broadcast';
import logger from '@/lib/logger';

/**
 * PATCH /api/sessions/projects/reorder
 * Body: { orderedIds: string[] }
 *
 * Updates sort_order for all projects in the given order.
 */
export async function PATCH(request: NextRequest) {
  const auth = await requireAuthenticatedUserId(request);
  if ('response' in auth) return auth.response;

  try {
    const body = await request.json();
    const { orderedIds } = body;

    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return NextResponse.json({ error: 'orderedIds must be a non-empty array' }, { status: 400 });
    }

    reorderProjects(orderedIds);
    logger.info({ count: orderedIds.length }, 'Projects reordered');

    broadcastSessionMutation(auth.userId, {
      kind: 'project_reordered',
      originClientId: getOriginClientIdFromRequest(request),
    });

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    logger.error({ error }, 'Failed to reorder projects');
    return NextResponse.json({ error: 'Failed to reorder projects' }, { status: 500 });
  }
}
