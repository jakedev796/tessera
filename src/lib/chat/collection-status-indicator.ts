import type { UnifiedSession } from '@/types/chat';
import type { TaskEntity } from '@/types/task-entity';

export type CollectionIndicatorStatus = 'running' | 'processing' | 'unread' | 'awaiting-user';

export interface CollectionSessionSnapshot {
  id: string;
  isRunning: boolean;
  unreadCount?: number;
}

export interface CollectionStatusFlags {
  hasLiveSession: boolean;
  hasProcessingSession: boolean;
  hasUnreadSession: boolean;
  hasAwaitingUserSession: boolean;
}

export function getCollectionSessionSnapshots(
  tasks: Pick<TaskEntity, 'sessions'>[],
  chats: Pick<UnifiedSession, 'id' | 'isRunning' | 'unreadCount'>[],
): CollectionSessionSnapshot[] {
  const snapshots: CollectionSessionSnapshot[] = [];

  for (const task of tasks) {
    for (const session of task.sessions) {
      snapshots.push({
        id: session.id,
        isRunning: session.isRunning,
      });
    }
  }

  for (const chat of chats) {
    snapshots.push({
      id: chat.id,
      isRunning: chat.isRunning,
      unreadCount: chat.unreadCount,
    });
  }

  return snapshots;
}

export function getPrioritizedCollectionIndicatorStatus({
  hasLiveSession,
  hasProcessingSession,
  hasUnreadSession,
  hasAwaitingUserSession,
}: CollectionStatusFlags): CollectionIndicatorStatus | null {
  if (hasAwaitingUserSession) return 'awaiting-user';
  if (hasUnreadSession) return 'unread';
  if (hasProcessingSession) return 'processing';
  if (hasLiveSession) return 'running';
  return null;
}
