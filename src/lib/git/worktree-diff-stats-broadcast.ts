import * as dbSessions from '@/lib/db/sessions';
import * as dbTasks from '@/lib/db/tasks';
import logger from '@/lib/logger';
import { protocolAdapter } from '@/lib/cli/protocol-adapter';
import { filterDiffAutoPromoteTaskIds } from './worktree-diff-auto-promote';
import { subscribeDiffStats } from './worktree-diff-stats-cache';

let unsubscribe: (() => void) | null = null;

/**
 * Install a listener on the diff-stats cache that broadcasts updates over
 * WebSocket to the users who triggered each recompute. Idempotent.
 */
export function installDiffStatsBroadcast(): void {
  if (unsubscribe) return;
  unsubscribe = subscribeDiffStats((workDir, stats, userIds, previousStats) => {
    // Only propagate stats to sessions/tasks that are actually bound to a
    // worktree branch. Plain chats that happen to share a workDir should
    // never show a diff badge.
    const rows = dbSessions
      .getSessionsByWorkDir(workDir)
      .filter((r) => typeof r.worktree_branch === 'string' && r.worktree_branch.length > 0);
    if (rows.length === 0) return;
    const sessionIds = rows.map((r) => r.id);
    const taskIds = Array.from(
      new Set(rows.map((r) => r.task_id).filter((v): v is string => typeof v === 'string')),
    );
    const diffAppeared =
      previousStats?.changedFiles === 0 &&
      stats !== null &&
      stats.changedFiles > 0;
    const autoPromotedTaskIds =
      diffAppeared
        ? dbTasks.promoteTodoTasksToInProgress(filterDiffAutoPromoteTaskIds(taskIds))
        : [];

    if (userIds.length === 0) return;

    const send = protocolAdapter.getSendToUser();
    if (!send) return;

    for (const userId of userIds) {
      try {
        send(userId, {
          type: 'worktree_diff_stats',
          workDir,
          sessionIds,
          taskIds,
          stats,
          ...(autoPromotedTaskIds.length > 0 ? { autoPromotedTaskIds } : {}),
        });
      } catch (err) {
        logger.warn({ err, userId, workDir }, 'Failed to broadcast diff stats');
      }
    }
  });
}

export function uninstallDiffStatsBroadcast(): void {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}
