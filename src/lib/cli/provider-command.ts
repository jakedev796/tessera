import { SettingsManager } from '@/lib/settings/manager';
import type { AgentEnvironment, UserSettings } from '@/lib/settings/types';

export function getProviderCliCommandFromSettings(
  settings: Pick<UserSettings, 'cliCommandOverrides'>,
  providerId: string,
  environment: AgentEnvironment,
  fallbackCommand: string,
): string {
  return settings.cliCommandOverrides?.[providerId]?.[environment] || fallbackCommand;
}

export async function resolveProviderCliCommand(
  providerId: string,
  fallbackCommand: string,
  environment: AgentEnvironment,
  userId?: string,
): Promise<string> {
  if (!userId) {
    return fallbackCommand;
  }

  const settings = await SettingsManager.load(userId, { silent: true });
  return getProviderCliCommandFromSettings(settings, providerId, environment, fallbackCommand);
}
