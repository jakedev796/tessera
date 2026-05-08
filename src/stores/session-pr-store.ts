import { create } from 'zustand';
import type { TaskPrStatus } from '@/types/task-pr-status';

export interface SessionPrCacheEntry {
  prStatus?: TaskPrStatus;
  prUnsupported: boolean;
  remoteBranchExists?: boolean;
}

interface SessionPrState {
  prBySessionId: Record<string, SessionPrCacheEntry>;
  applyPrStatusUpdate: (
    sessionId: string,
    prStatus: TaskPrStatus | undefined,
    prUnsupported: boolean,
    remoteBranchExists: boolean | undefined,
  ) => void;
  clearSession: (sessionId: string) => void;
}

export const useSessionPrStore = create<SessionPrState>((set) => ({
  prBySessionId: {},
  applyPrStatusUpdate: (sessionId, prStatus, prUnsupported, remoteBranchExists) => {
    set((state) => ({
      prBySessionId: {
        ...state.prBySessionId,
        [sessionId]: { prStatus, prUnsupported, remoteBranchExists },
      },
    }));
  },
  clearSession: (sessionId) => {
    set((state) => {
      if (!(sessionId in state.prBySessionId)) return state;
      const { [sessionId]: _removed, ...rest } = state.prBySessionId;
      return { prBySessionId: rest };
    });
  },
}));
