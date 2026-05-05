import {
  OPENCODE_ACCESS_OPTIONS,
  OPENCODE_MODE_OPTIONS,
} from './provider-session-option-definitions';
import { execCli } from './cli-exec';
import type { AgentEnvironment } from '../settings/types';
import type {
  ProviderModelOption,
  ProviderReasoningEffortOption,
  ProviderSessionOptions,
} from './provider-session-option-types';
import { OPENCODE_DEFAULT_REASONING_EFFORT } from './providers/opencode/session-config';

const OPENCODE_MODEL_PROBE_TIMEOUT_MS = 10_000;

interface OpenCodeVerboseModel {
  id?: string;
  providerID?: string;
  name?: string;
  variants?: Record<string, unknown>;
}

export async function loadOpenCodeSessionOptions(
  agentEnvironment: AgentEnvironment,
): Promise<ProviderSessionOptions> {
  const modelResult = await execCli(
    'opencode',
    ['models', '--verbose'],
    agentEnvironment,
    OPENCODE_MODEL_PROBE_TIMEOUT_MS,
  );

  const modelOptions = modelResult.ok
    ? parseOpenCodeVerboseModels(modelResult.stdout)
    : [];

  return buildOpenCodeSessionOptions(modelOptions);
}

export function buildOpenCodeSessionOptions(
  modelOptions: ProviderModelOption[],
): ProviderSessionOptions {
  return {
    providerId: 'opencode',
    displayName: 'OpenCode',
    supportsReasoningEffort: true,
    runtimeEffortChange: true,
    runtimeAccessChange: false,
    modelOptions,
    permissionMappings: [],
    modeOptions: [...OPENCODE_MODE_OPTIONS],
    accessOptions: [...OPENCODE_ACCESS_OPTIONS],
    planLocksAccess: false,
  };
}

export function parseOpenCodeVerboseModels(stdout: string): ProviderModelOption[] {
  const modelOptions: ProviderModelOption[] = [];
  const lines = stdout.split(/\r?\n/);
  let currentModelId: string | null = null;
  let jsonLines: string[] = [];
  let braceDepth = 0;

  const flush = () => {
    if (!currentModelId || jsonLines.length === 0) {
      currentModelId = null;
      jsonLines = [];
      braceDepth = 0;
      return;
    }

    const raw = jsonLines.join('\n');
    try {
      const model = JSON.parse(raw) as OpenCodeVerboseModel;
      modelOptions.push(buildModelOptionFromVerboseEntry(currentModelId, model, modelOptions.length === 0));
    } catch {
      modelOptions.push(buildFallbackModelOption(currentModelId, modelOptions.length === 0));
    }

    currentModelId = null;
    jsonLines = [];
    braceDepth = 0;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    if (currentModelId === null) {
      if (line.startsWith('{')) {
        continue;
      }
      currentModelId = line;
      continue;
    }

    jsonLines.push(rawLine);
    braceDepth += countChar(rawLine, '{') - countChar(rawLine, '}');
    if (braceDepth <= 0 && jsonLines.length > 0) {
      flush();
    }
  }

  flush();

  return modelOptions;
}

function buildModelOptionFromVerboseEntry(
  listedModelId: string,
  model: OpenCodeVerboseModel,
  isDefault: boolean,
): ProviderModelOption {
  const providerId = String(model.providerID ?? listedModelId.split('/')[0] ?? '').trim();
  const modelId = String(model.id ?? listedModelId.split('/').slice(1).join('/') ?? '').trim();
  const value = providerId && modelId ? `${providerId}/${modelId}` : listedModelId;
  const labelName = String(model.name ?? (modelId || value)).trim();
  const label = providerId && labelName ? `${providerId}/${labelName}` : value;
  const reasoningEfforts = buildReasoningEffortOptions(model.variants ?? {});

  return {
    value,
    label,
    isDefault,
    defaultReasoningEffort: reasoningEfforts.length > 0 ? OPENCODE_DEFAULT_REASONING_EFFORT : null,
    supportedReasoningEfforts: reasoningEfforts,
  };
}

function buildFallbackModelOption(value: string, isDefault: boolean): ProviderModelOption {
  return {
    value,
    label: value,
    isDefault,
    defaultReasoningEffort: null,
    supportedReasoningEfforts: [],
  };
}

function buildReasoningEffortOptions(
  variants: Record<string, unknown>,
): ProviderReasoningEffortOption[] {
  const variantNames = Object.keys(variants).filter((variant) => variant && variant !== 'default');
  if (variantNames.length === 0) {
    return [];
  }

  return [
    {
      value: OPENCODE_DEFAULT_REASONING_EFFORT,
      label: 'Default',
      description: 'Use the OpenCode model default',
    },
    ...variantNames.map((variant) => ({
      value: variant,
      label: formatVariantLabel(variant),
      description: buildVariantDescription(variant, variants[variant]),
    })),
  ];
}

function formatVariantLabel(variant: string): string {
  if (variant === 'xhigh') return 'XHigh';
  return variant.charAt(0).toUpperCase() + variant.slice(1);
}

function buildVariantDescription(variant: string, rawConfig: unknown): string {
  if (isRecord(rawConfig)) {
    const reasoningEffort = typeof rawConfig.reasoningEffort === 'string'
      ? rawConfig.reasoningEffort
      : undefined;
    if (reasoningEffort) {
      return `Use OpenCode ${reasoningEffort} reasoning`;
    }

    const thinking = isRecord(rawConfig.thinking) ? rawConfig.thinking : undefined;
    const budgetTokens = typeof thinking?.budgetTokens === 'number'
      ? thinking.budgetTokens
      : undefined;
    if (budgetTokens !== undefined) {
      return `Use OpenCode ${variant} thinking (${budgetTokens.toLocaleString()} tokens)`;
    }
  }

  return `Use OpenCode ${variant} thinking`;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function countChar(value: string, char: string): number {
  let count = 0;
  for (const next of value) {
    if (next === char) count += 1;
  }
  return count;
}
