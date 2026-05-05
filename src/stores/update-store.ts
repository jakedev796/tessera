import { create } from 'zustand';
import type { UpdateCheckResponse } from '@/lib/update/types';

const DISMISSED_VERSION_KEY = 'tessera:update:dismissed-version';

type UpdateStatus = 'idle' | 'checking' | UpdateCheckResponse['status'];

interface UpdateState {
  status: UpdateStatus;
  info: UpdateCheckResponse | null;
  error: string | null;
  dismissedVersion: string | null;
  toastShownVersion: string | null;
  isChecking: boolean;
  checkForUpdates: () => Promise<void>;
  markToastShown: (version: string) => void;
  dismissVersion: (version: string) => void;
  clearDismissedVersion: () => void;
}

function readDismissedVersion(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(DISMISSED_VERSION_KEY);
}

function writeDismissedVersion(version: string | null): void {
  if (typeof window === 'undefined') return;
  if (version) {
    window.localStorage.setItem(DISMISSED_VERSION_KEY, version);
  } else {
    window.localStorage.removeItem(DISMISSED_VERSION_KEY);
  }
}

export function isUpdateVisible(state: Pick<UpdateState, 'info' | 'dismissedVersion'>): boolean {
  const latestVersion = state.info?.latestVersion;
  return Boolean(
    state.info?.updateAvailable
    && latestVersion
    && state.dismissedVersion !== latestVersion
  );
}

export const useUpdateStore = create<UpdateState>((set, get) => ({
  status: 'idle',
  info: null,
  error: null,
  dismissedVersion: null,
  toastShownVersion: null,
  isChecking: false,

  checkForUpdates: async () => {
    if (get().isChecking) return;

    set({
      status: 'checking',
      isChecking: true,
      error: null,
      dismissedVersion: readDismissedVersion(),
    });

    try {
      const response = await fetch('/api/update/check', {
        cache: 'no-store',
      });

      if (!response.ok) {
        throw new Error(`Update check failed with status ${response.status}`);
      }

      const info = await response.json() as UpdateCheckResponse;
      set({
        status: info.status,
        info,
        error: info.error,
        isChecking: false,
        dismissedVersion: readDismissedVersion(),
      });
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'Update check failed',
        isChecking: false,
        dismissedVersion: readDismissedVersion(),
      });
    }
  },

  markToastShown: (version) => set({ toastShownVersion: version }),

  dismissVersion: (version) => {
    writeDismissedVersion(version);
    set({ dismissedVersion: version });
  },

  clearDismissedVersion: () => {
    writeDismissedVersion(null);
    set({ dismissedVersion: null });
  },
}));
