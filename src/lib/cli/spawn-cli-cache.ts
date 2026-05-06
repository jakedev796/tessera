import type { AgentEnvironment } from '../settings/types';

const SPAWN_CACHE_KEY = Symbol.for('tessera.spawnCliCache');

export interface SpawnCliCache {
  agentEnvironmentByUserId: Map<string, AgentEnvironment>;
  defaultAgentEnvironment: AgentEnvironment | null;
  loginShell: string | null;
  didResolveLoginShell: boolean;
  loginShellEnvironment: Record<string, string> | null;
  didResolveLoginShellEnvironment: boolean;
  loginShellPath: string | null;
  didResolveLoginShellPath: boolean;
  wslLoginShell: string | null;
  didResolveWslLoginShell: boolean;
}

export function getSpawnCliCache(): SpawnCliCache {
  return (
    globalThis as typeof globalThis & { [SPAWN_CACHE_KEY]?: SpawnCliCache }
  )[SPAWN_CACHE_KEY] ??= {
    agentEnvironmentByUserId: new Map(),
    defaultAgentEnvironment: null,
    loginShell: null,
    didResolveLoginShell: false,
    loginShellEnvironment: null,
    didResolveLoginShellEnvironment: false,
    loginShellPath: null,
    didResolveLoginShellPath: false,
    wslLoginShell: null,
    didResolveWslLoginShell: false,
  };
}
