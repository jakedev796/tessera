export interface ServerHostInfo {
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  appVersion: string;
  channel: string;
  telemetryDisabledByEnv: boolean;
  isWindowsEcosystem: boolean;
}
