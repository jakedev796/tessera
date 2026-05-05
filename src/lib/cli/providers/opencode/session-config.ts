import type { ProviderSessionAccessMode, ProviderSessionMode } from '@/lib/session/session-control-types';

export type OpenCodePermissionPreset = Extract<
  ProviderSessionAccessMode,
  'opencodeDefault' | 'opencodeAskChanges' | 'opencodeReadOnly' | 'opencodeAllowAll'
>;

type OpenCodePermissionAction = 'ask' | 'allow' | 'deny';
type OpenCodePermissionConfig = Record<string, OpenCodePermissionAction | Record<string, OpenCodePermissionAction>>;

export const OPENCODE_DEFAULT_ACCESS_MODE: OpenCodePermissionPreset = 'opencodeDefault';
export const OPENCODE_DEFAULT_REASONING_EFFORT = 'default';

export function normalizeOpenCodeAccessMode(value: unknown): OpenCodePermissionPreset | undefined {
  switch (value) {
    case 'opencodeDefault':
    case 'opencodeAskChanges':
    case 'opencodeReadOnly':
    case 'opencodeAllowAll':
      return value;
    default:
      return undefined;
  }
}

export function normalizeOpenCodeSessionMode(sessionMode?: ProviderSessionMode): 'build' | 'plan' {
  return sessionMode === 'plan' ? 'plan' : 'build';
}

export function splitOpenCodeModelId(modelId: string | null | undefined): {
  baseModelId?: string;
  reasoningEffort?: string | null;
} {
  const normalized = typeof modelId === 'string' ? modelId.trim() : '';
  if (!normalized) {
    return {};
  }

  const parts = normalized.split('/').filter(Boolean);
  if (parts.length < 3) {
    return { baseModelId: normalized, reasoningEffort: null };
  }

  return {
    baseModelId: parts.slice(0, 2).join('/'),
    reasoningEffort: parts.slice(2).join('/') || null,
  };
}

export function composeOpenCodeModelId(
  modelId: string | null | undefined,
  reasoningEffort?: string | null,
): string | undefined {
  const { baseModelId, reasoningEffort: embeddedReasoningEffort } = splitOpenCodeModelId(modelId);
  if (!baseModelId) {
    return undefined;
  }

  const selectedReasoningEffort = reasoningEffort === undefined
    ? embeddedReasoningEffort
    : reasoningEffort;
  if (
    !selectedReasoningEffort
    || selectedReasoningEffort === OPENCODE_DEFAULT_REASONING_EFFORT
  ) {
    return baseModelId;
  }

  return `${baseModelId}/${selectedReasoningEffort}`;
}

export function buildOpenCodePermissionEnv(
  accessMode: ProviderSessionAccessMode | undefined,
): string | undefined {
  const preset = normalizeOpenCodeAccessMode(accessMode) ?? OPENCODE_DEFAULT_ACCESS_MODE;
  const config = buildOpenCodePermissionConfig(preset);
  return config ? JSON.stringify(config) : undefined;
}

function buildOpenCodePermissionConfig(
  preset: OpenCodePermissionPreset,
): OpenCodePermissionConfig | undefined {
  switch (preset) {
    case 'opencodeDefault':
      return undefined;
    case 'opencodeAskChanges':
      return {
        edit: 'ask',
        bash: 'ask',
        todowrite: 'ask',
        external_directory: 'ask',
        doom_loop: 'ask',
      };
    case 'opencodeReadOnly':
      return {
        '*': 'deny',
        read: 'allow',
        glob: 'allow',
        grep: 'allow',
        list: 'allow',
        todoread: 'allow',
        question: 'allow',
        webfetch: 'allow',
        websearch: 'allow',
        codesearch: 'allow',
        lsp: 'allow',
        skill: 'allow',
      };
    case 'opencodeAllowAll':
      return { '*': 'allow' };
  }
}
