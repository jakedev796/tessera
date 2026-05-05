export type UpdateSource = 'npm' | 'github-release' | 'unsupported';
export type UpdateCheckStatus = 'available' | 'current' | 'unsupported' | 'error';

export interface UpdateCheckResponse {
  status: UpdateCheckStatus;
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  source: UpdateSource;
  channel: string;
  releaseUrl: string | null;
  installCommand: string | null;
  checkedAt: string;
  error: string | null;
}
