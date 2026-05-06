import logger from '@/lib/logger';
import { cliProviderRegistry as defaultRegistry } from './providers/registry';
import type { CliProviderRegistry } from './providers/registry';
import type { CliStatusResult } from './providers/provider-contract';
import { getServerHostInfo } from '@/lib/system/server-host';

export interface CliStatusEntry extends CliStatusResult {
  providerId: string;
  environment: 'native' | 'wsl';
}

export interface CheckAllOptions {
  /** Override registry for testability. Defaults to the singleton. */
  registry?: CliProviderRegistry;
  /** User settings owner; enables per-user CLI command overrides. */
  userId?: string;
}

const CLI_STATUS_CACHE_TTL_MS = 30_000;
let cachedStatusesByKey = new Map<string, { results: CliStatusEntry[]; checkedAt: number }>();
let statusCheckInFlightByKey = new Map<string, Promise<CliStatusEntry[]>>();

/**
 * Returns the list of environments to probe on the current host.
 *
 * The Windows ecosystem is `win32 OR WSL`: a WSL-hosted server still
 * belongs to a Windows user who may have CLIs installed in both WSL
 * and the Windows host. On non-Windows hosts: native only.
 */
function environmentsForPlatform(): Array<'native' | 'wsl'> {
  return getServerHostInfo().isWindowsEcosystem ? ['native', 'wsl'] : ['native'];
}

/**
 * Runs checkStatus() for every registered provider across every applicable
 * environment, in parallel. Provider failures are caught and reported as
 * `not_installed` so one bad provider cannot crash the whole response.
 *
 * Results are ordered deterministically: by provider registration order,
 * then `native` before `wsl` for each provider.
 */
export async function checkAllCliStatuses(
  options: CheckAllOptions = {},
): Promise<CliStatusEntry[]> {
  const registry = options.registry ?? defaultRegistry;
  const environments = environmentsForPlatform();

  const tasks: Array<Promise<CliStatusEntry>> = [];

  for (const providerId of registry.getProviderIds()) {
    const provider = registry.getProvider(providerId);
    for (const environment of environments) {
      tasks.push(
        provider.checkStatus({ environment, userId: options.userId })
          .then<CliStatusEntry>((result) => ({
            providerId,
            environment,
            ...result,
          }))
          .catch((err: Error): CliStatusEntry => {
            logger.warn('connection-checker: provider checkStatus threw', {
              providerId,
              environment,
              error: err.message,
            });
            return {
              providerId,
              environment,
              status: 'not_installed',
            };
          }),
      );
    }
  }

  return Promise.all(tasks);
}

export async function getCliStatusSnapshot(
  options: CheckAllOptions & { force?: boolean } = {},
): Promise<CliStatusEntry[]> {
  const usesDefaultRegistry = !options.registry || options.registry === defaultRegistry;
  if (!usesDefaultRegistry) {
    return checkAllCliStatuses(options);
  }

  const cacheKey = options.userId ?? '__default__';
  const cachedStatuses = cachedStatusesByKey.get(cacheKey);
  if (!options.force && cachedStatuses && Date.now() - cachedStatuses.checkedAt < CLI_STATUS_CACHE_TTL_MS) {
    return cachedStatuses.results;
  }

  const statusCheckInFlight = statusCheckInFlightByKey.get(cacheKey);
  if (statusCheckInFlight) {
    return statusCheckInFlight;
  }

  const nextStatusCheck = checkAllCliStatuses({ registry: defaultRegistry, userId: options.userId })
    .then((results) => {
      cachedStatusesByKey.set(cacheKey, { results, checkedAt: Date.now() });
      return results;
    })
    .finally(() => {
      statusCheckInFlightByKey.delete(cacheKey);
    });

  statusCheckInFlightByKey.set(cacheKey, nextStatusCheck);
  return nextStatusCheck;
}

export function invalidateCliStatusSnapshot(): void {
  cachedStatusesByKey = new Map();
  statusCheckInFlightByKey = new Map();
}
