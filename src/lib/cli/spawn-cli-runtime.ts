import { spawn, spawnSync, type ChildProcess, type SpawnOptions } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { delimiter } from 'path';
import { getRuntimePlatform } from '../system/runtime-platform';
import type { AgentEnvironment } from '../settings/types';
import type { SpawnCliCache } from './spawn-cli-cache';

const PATH_MARKER_START = '__TESSERA_PATH_START__';
const PATH_MARKER_END = '__TESSERA_PATH_END__';

export function resolveDefaultAgentEnvironment(): AgentEnvironment {
  return 'native';
}

export function invalidateSpawnCliRuntimeCache(cache: SpawnCliCache): void {
  cache.loginShellPath = null;
  cache.didResolveLoginShellPath = false;
  cache.wslBinaryPaths.clear();
  cache.windowsNativeBinaryPaths.clear();
}

export function buildSpawnEnvironment(
  baseEnv: NodeJS.ProcessEnv,
  cache: SpawnCliCache,
): NodeJS.ProcessEnv {
  const env = { ...baseEnv };

  if (getRuntimePlatform() === 'win32') {
    const windowsPath = resolveWindowsCliPath(env);
    if (windowsPath) {
      mergeIntoEnvironmentPath(env, windowsPath);
    }
    return env;
  }

  const loginShellPath = resolveLoginShellPath(cache);

  if (!loginShellPath) {
    return env;
  }

  mergeIntoEnvironmentPath(env, loginShellPath);
  return env;
}

export function spawnCliProcess(
  command: string,
  args: string[],
  options: SpawnOptions,
  agentEnv: AgentEnvironment,
  cache: SpawnCliCache,
): ChildProcess {
  const env = buildSpawnEnvironment((options.env as NodeJS.ProcessEnv) ?? process.env, cache);
  const spawnOptions = buildPlatformSpawnOptions(options, env);

  if (agentEnv === 'wsl' && getRuntimePlatform() === 'win32') {
    return spawnWslCli(command, args, spawnOptions, cache, env);
  }

  if (agentEnv === 'native' && getRuntimePlatform() === 'win32') {
    return spawnWindowsNativeCli(command, args, spawnOptions, cache, env);
  }

  if (agentEnv === 'native' && isRunningInWsl()) {
    return spawnWindowsNativeCli(command, args, spawnOptions, cache, env);
  }

  return spawn(command, args, spawnOptions);
}

export function normalizeCwdForCliEnvironment(
  cwd: string,
  agentEnv: AgentEnvironment,
): string {
  if (agentEnv === 'wsl' && getRuntimePlatform() === 'win32') {
    return toWslPath(cwd) ?? cwd;
  }

  if (agentEnv === 'native' && isRunningInWsl()) {
    return toWindowsPath(cwd) ?? cwd;
  }

  return cwd;
}

function isRunningInWsl(): boolean {
  if (getRuntimePlatform() !== 'linux') {
    return false;
  }

  try {
    if (!existsSync('/proc/version')) {
      return false;
    }

    const content = readFileSync('/proc/version', 'utf8').toLowerCase();
    return content.includes('microsoft') || content.includes('wsl');
  } catch {
    return false;
  }
}

function getLoginShell(): string | null {
  const configuredShell = process.env.SHELL;
  if (configuredShell) {
    return configuredShell;
  }

  const platform = getRuntimePlatform();
  if (platform === 'darwin') {
    return '/bin/zsh';
  }

  if (platform === 'linux') {
    return '/bin/bash';
  }

  return null;
}

function mergePathValues(primaryPath: string, secondaryPath?: string): string {
  const merged = [primaryPath, secondaryPath]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .flatMap((value) => value.split(getEnvironmentPathDelimiter()))
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  return [...new Set(merged)].join(getEnvironmentPathDelimiter());
}

function getEnvironmentPathDelimiter(): string {
  return getRuntimePlatform() === 'win32' ? ';' : delimiter;
}

function getPathEnvironmentKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
}

function mergeIntoEnvironmentPath(env: NodeJS.ProcessEnv, primaryPath: string): void {
  const pathKey = getPathEnvironmentKey(env);
  env[pathKey] = mergePathValues(primaryPath, env[pathKey]);
}

function resolveWindowsCliPath(env: NodeJS.ProcessEnv): string | null {
  const appData = env.APPDATA?.trim();
  const userProfile = env.USERPROFILE?.trim();
  const candidates = [
    appData ? `${appData}\\npm` : null,
    userProfile ? `${userProfile}\\AppData\\Roaming\\npm` : null,
  ].filter((value): value is string => Boolean(value));

  return candidates.length > 0 ? [...new Set(candidates)].join(getEnvironmentPathDelimiter()) : null;
}

function parseMarkedPath(stdout: string): string | null {
  const startIndex = stdout.indexOf(PATH_MARKER_START);
  const endIndex = stdout.indexOf(PATH_MARKER_END, startIndex + PATH_MARKER_START.length);

  if (startIndex === -1 || endIndex === -1) {
    return null;
  }

  const resolvedPath = stdout
    .slice(startIndex + PATH_MARKER_START.length, endIndex)
    .trim();

  return resolvedPath || null;
}

function resolveLoginShellPath(cache: SpawnCliCache): string | null {
  if (cache.didResolveLoginShellPath) {
    return cache.loginShellPath;
  }

  cache.didResolveLoginShellPath = true;

  if (getRuntimePlatform() === 'win32') {
    return null;
  }

  const shell = getLoginShell();
  if (!shell) {
    return null;
  }

  try {
    const probe = spawnSync(
      shell,
      ['-ilc', `printf '${PATH_MARKER_START}%s${PATH_MARKER_END}' "$PATH"`],
      {
        encoding: 'utf8',
        env: process.env,
        timeout: 5000,
        windowsHide: true,
      },
    );

    if (probe.status !== 0 || typeof probe.stdout !== 'string') {
      return null;
    }

    cache.loginShellPath = parseMarkedPath(probe.stdout);
    return cache.loginShellPath;
  } catch {
    return null;
  }
}

function buildPlatformSpawnOptions(
  options: SpawnOptions,
  env: NodeJS.ProcessEnv,
): SpawnOptions {
  if (getRuntimePlatform() === 'win32') {
    return { ...options, env, windowsHide: true };
  }

  // Spawn each CLI as a new session/process-group leader so we can later
  // target the whole subtree via `process.kill(-pid, signal)`. Without this,
  // CLI-spawned grandchildren (dev servers, test runners, etc.) get
  // re-parented to init when the CLI exits and linger as orphans.
  return { ...options, env, detached: true };
}

function spawnWslCli(
  command: string,
  args: string[],
  options: SpawnOptions,
  cache: SpawnCliCache,
  env: NodeJS.ProcessEnv,
): ChildProcess {
  const { cwd, ...spawnOptions } = options;
  const resolvedCommand = resolveWslBinaryPath(cache, command, env) || command;
  const wslCwd = typeof cwd === 'string' && cwd.length > 0
    ? normalizeCwdForCliEnvironment(cwd, 'wsl')
    : null;
  const script = buildBashLoginExecScript(resolvedCommand, args, wslCwd);

  return spawn('wsl', ['bash', '-lic', script], spawnOptions);
}

function spawnWindowsNativeCli(
  command: string,
  args: string[],
  options: SpawnOptions,
  cache: SpawnCliCache,
  env: NodeJS.ProcessEnv,
): ChildProcess {
  const resolvedCommand = resolveWindowsNativeBinaryPath(cache, command, env);

  if (resolvedCommand) {
    return spawnResolvedWindowsNativeCli(resolvedCommand, args, options);
  }

  return spawnWindowsNativeCliViaPowerShell(command, args, options);
}

function spawnResolvedWindowsNativeCli(
  windowsPath: string,
  args: string[],
  options: SpawnOptions,
): ChildProcess {
  const extension = getWindowsPathExtension(windowsPath);
  const platform = getRuntimePlatform();

  if (platform === 'win32') {
    if (extension === '.cmd' || extension === '.bat') {
      return spawn('cmd.exe', ['/d', '/c', windowsPath, ...args], options);
    }

    if (extension === '.ps1') {
      return spawn(
        'powershell.exe',
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', windowsPath, ...args],
        options,
      );
    }

    return spawn(windowsPath, args, options);
  }

  if (extension === '.cmd' || extension === '.bat' || extension === '.ps1') {
    return spawnWindowsNativeCliViaPowerShell(windowsPath, args, options);
  }

  const wslPath = windowsExecutablePathToWslPath(windowsPath);
  if (wslPath) {
    return spawn(wslPath, args, options);
  }

  return spawnWindowsNativeCliViaPowerShell(windowsPath, args, options);
}

function spawnWindowsNativeCliViaPowerShell(
  command: string,
  args: string[],
  options: SpawnOptions,
): ChildProcess {
  const { cwd, ...spawnOptions } = options;
  const scriptParts = ['$ErrorActionPreference = "Stop"'];

  if (typeof cwd === 'string' && cwd.length > 0) {
    const windowsCwd = toWindowsPath(cwd);
    if (windowsCwd) {
      scriptParts.push(`Set-Location -LiteralPath ${quotePowerShellString(windowsCwd)}`);
    }
  }

  const commandExpression = [
    '&',
    quotePowerShellString(command),
    ...args.map(quotePowerShellString),
  ].join(' ');
  scriptParts.push(commandExpression);
  scriptParts.push('exit $LASTEXITCODE');

  return spawn(
    'powershell.exe',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', scriptParts.join('; ')],
    spawnOptions,
  );
}

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function toWindowsPath(cwd: string): string | null {
  if (/^[a-zA-Z]:[\\/]/.test(cwd)) {
    return cwd.replace(/\//g, '\\');
  }

  const mountedDriveMatch = cwd.match(/^\/mnt\/([a-zA-Z])(?:\/(.*))?$/);
  if (mountedDriveMatch) {
    const drive = mountedDriveMatch[1].toUpperCase();
    const rest = mountedDriveMatch[2]?.replace(/\//g, '\\') ?? '';
    return rest ? `${drive}:\\${rest}` : `${drive}:\\`;
  }

  if (cwd.startsWith('\\\\')) {
    return cwd;
  }

  if (cwd.startsWith('//')) {
    return cwd.replace(/\//g, '\\');
  }

  const distro = process.env.WSL_DISTRO_NAME;
  if (!distro || !cwd.startsWith('/')) {
    return null;
  }

  return `\\\\wsl.localhost\\${distro}${cwd.replace(/\//g, '\\')}`;
}

function toWslPath(cwd: string): string | null {
  const driveMatch = cwd.match(/^([a-zA-Z]):[\\/](.*)$/);
  if (driveMatch) {
    const drive = driveMatch[1].toLowerCase();
    const rest = driveMatch[2].replace(/[\\/]+/g, '/');
    return `/mnt/${drive}/${rest}`;
  }

  const uncMatch = cwd.match(/^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)\\?(.*)$/i);
  if (uncMatch) {
    const rest = uncMatch[2].replace(/\\/g, '/').replace(/^\/+/, '');
    return rest ? `/${rest}` : '/';
  }

  const slashUncMatch = cwd.match(/^\/\/(?:wsl\.localhost|wsl\$)\/([^/]+)\/?(.*)$/i);
  if (slashUncMatch) {
    const rest = slashUncMatch[2].replace(/^\/+/, '');
    return rest ? `/${rest}` : '/';
  }

  return null;
}

function resolveWindowsNativeBinaryPath(
  cache: SpawnCliCache,
  command: string,
  env: NodeJS.ProcessEnv,
): string | null {
  const cachedBinaryPath = cache.windowsNativeBinaryPaths.get(command);
  if (cachedBinaryPath) {
    return cachedBinaryPath;
  }

  const windowsPath = resolveWindowsNativeBinaryPathFromWhere(command, env);
  if (!windowsPath) {
    return null;
  }

  cache.windowsNativeBinaryPaths.set(command, windowsPath);
  return windowsPath;
}

function resolveWindowsNativeBinaryPathFromWhere(
  command: string,
  env: NodeJS.ProcessEnv,
): string | null {
  try {
    const probe = spawnSync('cmd.exe', ['/d', '/s', '/c', `where ${quoteCmdArg(command)}`], {
      encoding: 'utf8',
      env,
      timeout: 5000,
      windowsHide: true,
    });

    if (probe.status !== 0 || typeof probe.stdout !== 'string') {
      return null;
    }

    const candidates = probe.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(isSupportedWindowsNativeBinaryPath);

    return pickPreferredWindowsNativeBinaryPath(candidates);
  } catch {
    return null;
  }
}

function isSupportedWindowsNativeBinaryPath(value: string): boolean {
  return ['.exe', '.com', '.cmd', '.bat', '.ps1'].includes(getWindowsPathExtension(value));
}

function pickPreferredWindowsNativeBinaryPath(candidates: string[]): string | null {
  if (candidates.length === 0) {
    return null;
  }

  const priority = new Map([
    ['.exe', 0],
    ['.com', 1],
    ['.cmd', 2],
    ['.bat', 3],
    ['.ps1', 4],
  ]);

  return candidates
    .slice()
    .sort((a, b) => (
      (priority.get(getWindowsPathExtension(a)) ?? Number.MAX_SAFE_INTEGER)
      - (priority.get(getWindowsPathExtension(b)) ?? Number.MAX_SAFE_INTEGER)
    ))[0] ?? null;
}

function getWindowsPathExtension(value: string): string {
  const match = value.match(/\.([^.\\/]+)$/);
  return match ? `.${match[1].toLowerCase()}` : '';
}

function quoteCmdArg(value: string): string {
  if (/^[A-Za-z0-9_.:/\\-]+$/.test(value)) {
    return value;
  }

  return `"${value.replace(/"/g, '""')}"`;
}

function quoteBashArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildBashLoginExecScript(
  command: string,
  args: string[],
  cwd: string | null,
): string {
  const commandExpression = [
    'exec',
    quoteBashArg(command),
    ...args.map(quoteBashArg),
  ].join(' ');

  if (!cwd) {
    return commandExpression;
  }

  return `cd -- ${quoteBashArg(cwd)} && ${commandExpression}`;
}

function windowsExecutablePathToWslPath(windowsPath: string): string | null {
  const driveMatch = windowsPath.match(/^([a-zA-Z]):\\(.*)$/);
  if (!driveMatch) {
    return null;
  }

  const drive = driveMatch[1].toLowerCase();
  const rest = driveMatch[2].replace(/\\/g, '/');
  return `/mnt/${drive}/${rest}`;
}

function resolveWslBinaryPath(
  cache: SpawnCliCache,
  command: string,
  env: NodeJS.ProcessEnv,
): string | null {
  const cachedBinaryPath = cache.wslBinaryPaths.get(command);
  if (cachedBinaryPath) {
    return cachedBinaryPath;
  }

  try {
    const probe = spawnSync(
      'wsl',
      ['bash', '-lic', `command -v ${quoteBashArg(command)}`],
      {
        encoding: 'utf8',
        env,
        timeout: 5000,
        windowsHide: true,
      },
    );

    if (probe.status !== 0 || typeof probe.stdout !== 'string') {
      return null;
    }

    const resolvedPath = probe.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .at(-1);

    if (!resolvedPath) {
      return null;
    }

    cache.wslBinaryPaths.set(command, resolvedPath);
    return resolvedPath;
  } catch {
    return null;
  }
}
