/**
 * CliProviderRegistry — Singleton registry for CLI provider implementations.
 *
 * Providers are registered by ID (e.g. "claude-code", "codex", "gemini").
 * Unknown provider IDs are treated as caller errors. Session creation paths
 * must choose a provider explicitly.
 *
 * Usage:
 *   import { cliProviderRegistry } from '@/lib/cli/providers/registry';
 *   const provider = cliProviderRegistry.getProvider('claude-code');
 */

import { spawnSync } from 'child_process';
import type { CliProvider, ProviderMeta } from './types';

export class CliProviderRegistry {
  private readonly providers = new Map<string, CliProvider>();

  /**
   * Register a provider under the given ID.
   * Re-registering an existing ID replaces the previous implementation.
   */
  register(id: string, provider: CliProvider): void {
    this.providers.set(id, provider);
  }

  /**
   * Returns true when a provider has already been registered for the ID.
   */
  hasProvider(id: string): boolean {
    return this.providers.has(id);
  }

  /**
   * Returns the ids of all registered providers in registration order.
   * Does not perform any availability checks.
   */
  getProviderIds(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Register a provider only when the slot is still empty.
   * Returns the existing provider when one was already registered.
   */
  registerIfAbsent(id: string, createProvider: () => CliProvider): CliProvider {
    const existing = this.providers.get(id);
    if (existing) {
      return existing;
    }

    const provider = createProvider();
    this.providers.set(id, provider);
    return provider;
  }

  /**
   * Returns the provider for the given ID.
   * Throws when the ID is unknown so callers do not silently switch providers.
   */
  getProvider(id: string): CliProvider {
    const provider = this.providers.get(id);
    if (provider) {
      return provider;
    }

    throw new Error(`CliProviderRegistry: unknown provider id="${id}".`);
  }

  /**
   * Returns metadata for all registered providers, including availability.
   * Availability checks are delegated to each provider implementation.
   * When environment is provided, each provider probes that environment
   * (native vs. wsl) instead of the server's own host.
   */
  async listAvailable(environment?: 'native' | 'wsl'): Promise<ProviderMeta[]> {
    const results: ProviderMeta[] = [];

    for (const [id, provider] of this.providers) {
      const available = await provider.isAvailable(environment);
      results.push({
        id,
        displayName: provider.getDisplayName(),
        available,
      });
    }

    return results;
  }

  /**
   * Returns IDs of providers whose CLI binary is installed in the requested
   * environment. Delegates to listAvailable() for the iteration logic.
   */
  async detectInstalled(environment?: 'native' | 'wsl'): Promise<string[]> {
    return (await this.listAvailable(environment)).filter(p => p.available).map(p => p.id);
  }
}

/**
 * Check whether a binary is available via `which`.
 * Uses spawnSync so it can be called from synchronous contexts.
 *
 * @param binaryName - The CLI binary name (e.g. "claude", "codex").
 * @returns true if `which <binaryName>` exits with status 0.
 */
export function isBinaryAvailable(binaryName: string): boolean {
  const result = spawnSync('which', [binaryName], { encoding: 'utf8' });
  return result.status === 0;
}

/**
 * Singleton registry instance — uses globalThis to survive Next.js hot reload
 * and webpack/tsx module boundary (API routes get a separate module scope).
 */
const REGISTRY_KEY = Symbol.for('tessera.cliProviderRegistry');
const _g = globalThis as unknown as Record<symbol, CliProviderRegistry>;

export const cliProviderRegistry: CliProviderRegistry =
  _g[REGISTRY_KEY] || (_g[REGISTRY_KEY] = new CliProviderRegistry());
