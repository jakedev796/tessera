import os from 'os';
import path from 'path';

export const TESSERA_DATA_DIR_ENV = 'TESSERA_DATA_DIR';

export function expandHomePath(value: string, homeDir: string = os.homedir()): string {
  if (value === '~') return homeDir;
  if (value.startsWith('~/') || value.startsWith('~\\')) {
    return path.join(homeDir, value.slice(2));
  }
  return value;
}

export function resolveConfiguredPath(
  value: string,
  options: { cwd?: string; homeDir?: string } = {}
): string {
  const expanded = expandHomePath(value, options.homeDir);
  return path.isAbsolute(expanded)
    ? path.normalize(expanded)
    : path.resolve(options.cwd ?? process.cwd(), expanded);
}

export function getTesseraDataDir(
  options: { env?: NodeJS.ProcessEnv; cwd?: string; homeDir?: string } = {}
): string {
  const env = options.env ?? process.env;
  const configured = env[TESSERA_DATA_DIR_ENV]?.trim();

  if (configured) {
    return resolveConfiguredPath(configured, {
      cwd: options.cwd,
      homeDir: options.homeDir,
    });
  }

  return path.join(options.homeDir ?? os.homedir(), '.tessera');
}

export function getTesseraDataPath(...segments: string[]): string {
  return path.join(getTesseraDataDir(), ...segments);
}
