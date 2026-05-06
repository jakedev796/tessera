import type { ChildProcess } from 'child_process';
import type {
  CheckStatusOptions,
  CliProvider,
  CliStatusResult,
  GeneratedTitle,
  ParsedMessage,
  SpawnOptions,
  SpawnResult,
} from '../types';
import type { ContentBlock } from '@/lib/ws/message-types';
import type { ProviderRuntimeControls } from '@/lib/session/session-control-types';
import { isBinaryAvailable } from '../registry';
import { execCli, parseVersion, probeBinaryAvailable } from '../../cli-exec';
import { getAgentEnvironment, normalizeCwdForCliEnvironment, spawnCli } from '../../spawn-cli';
import { resolveProviderCliCommand } from '../../provider-command';
import { updateProviderStateWithRetry } from '../../process-manager-side-effects';
import { getRuntimePlatform } from '@/lib/system/runtime-platform';
import logger from '@/lib/logger';
import { opencodeProtocolParser } from './protocol-parser';
import {
  buildOpenCodePermissionEnv,
  composeOpenCodeModelId,
  normalizeOpenCodeSessionMode,
  splitOpenCodeModelId,
} from './session-config';

const CLI_TIMEOUT_MS = 120_000;
const STATUS_CHECK_TIMEOUT_MS = 5_000;
const TITLE_TIMEOUT_MS = 120_000;
const PROVIDER_ID = 'opencode';
const DEFAULT_COMMAND = 'opencode';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: Record<string, unknown>;
}

interface OpenCodeRuntimeConfig {
  sessionId: string;
  cwd: string;
  opencodeSessionId: string | null;
  model?: string;
  reasoningEffort?: string | null;
  sessionMode?: ProviderRuntimeControls['sessionMode'];
  accessMode?: ProviderRuntimeControls['accessMode'];
}

type OpenCodePromptPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: string };

export class OpenCodeAdapter implements CliProvider {
  private _nextRequestId = 3;
  private _processRuntimeConfig = new WeakMap<ChildProcess, OpenCodeRuntimeConfig>();
  private _initialConfigSent = new WeakSet<ChildProcess>();

  getProviderId(): string {
    return PROVIDER_ID;
  }

  getDisplayName(): string {
    return 'OpenCode';
  }

  async isAvailable(environment?: 'native' | 'wsl'): Promise<boolean> {
    if (environment) {
      return probeBinaryAvailable('opencode', environment);
    }
    return isBinaryAvailable('opencode');
  }

  async checkStatus(options: CheckStatusOptions): Promise<CliStatusResult> {
    const command = await resolveProviderCliCommand(
      PROVIDER_ID,
      DEFAULT_COMMAND,
      options.environment,
      options.userId,
    );
    const [versionResult, modelsResult] = await Promise.all([
      execCli(command, ['--version'], options.environment, STATUS_CHECK_TIMEOUT_MS),
      execCli(command, ['models'], options.environment, STATUS_CHECK_TIMEOUT_MS),
    ]);

    if (!versionResult.ok) {
      return { status: 'not_installed' };
    }

    const version = parseVersion(versionResult.stdout);
    return {
      status: modelsResult.ok ? 'connected' : 'needs_login',
      ...(version ? { version } : {}),
    };
  }

  getCliArgs(_options: SpawnOptions): string[] {
    return ['acp'];
  }

  async spawn(workDir: string, options: SpawnOptions): Promise<SpawnResult> {
    const agentEnv = await getAgentEnvironment(options.userId);
    const command = await resolveProviderCliCommand(PROVIDER_ID, DEFAULT_COMMAND, agentEnv, options.userId);
    const cliWorkDir = normalizeCwdForCliEnvironment(workDir, agentEnv);
    const args = this.getCliArgs(options);
    const spawnEnv: Record<string, string | undefined> = { ...process.env };
    const permissionEnv = buildOpenCodePermissionEnv(options.accessMode);
    if (permissionEnv) {
      spawnEnv.OPENCODE_PERMISSION = permissionEnv;
    } else {
      delete spawnEnv.OPENCODE_PERMISSION;
    }

    const cliProcess = spawnCli(command, args, {
      cwd: cliWorkDir,
      shell: false,
      env: spawnEnv as NodeJS.ProcessEnv,
      detached: getRuntimePlatform() !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    }, agentEnv);

    const spawnResult = await new Promise<{ ok: boolean; error?: Error }>((resolve) => {
      const onError = (err: Error) => {
        cliProcess.removeListener('spawn', onSpawn);
        resolve({ ok: false, error: err });
      };
      const onSpawn = () => {
        cliProcess.removeListener('error', onError);
        resolve({ ok: true });
      };
      cliProcess.once('error', onError);
      cliProcess.once('spawn', onSpawn);
    });

    if (!spawnResult.ok) {
      return { process: cliProcess, ok: false, error: spawnResult.error };
    }

    const tesseraSessionId = options.sessionId ?? '__provider__';
    const modelSelection = splitOpenCodeModelId(options.model);
    const baseModel = modelSelection.baseModelId;
    const reasoningEffort = options.reasoningEffort ?? modelSelection.reasoningEffort ?? null;
    this._processRuntimeConfig.set(cliProcess, {
      sessionId: tesseraSessionId,
      cwd: cliWorkDir,
      opencodeSessionId: null,
      model: baseModel,
      reasoningEffort,
      sessionMode: options.sessionMode,
      accessMode: options.accessMode,
    });
    opencodeProtocolParser.setSessionModel(
      tesseraSessionId,
      composeOpenCodeModelId(baseModel, reasoningEffort),
    );

    try {
      const opencodeSessionId = await this._performHandshake(cliProcess, cliWorkDir, options);
      const current = this._processRuntimeConfig.get(cliProcess);
      if (current) {
        this._processRuntimeConfig.set(cliProcess, {
          ...current,
          opencodeSessionId,
        });
      }
      if (tesseraSessionId !== '__provider__') {
        updateProviderStateWithRetry(tesseraSessionId, { opencodeSessionId });
      }
    } catch (err) {
      logger.error('OpenCodeAdapter: handshake failed', {
        error: (err as Error).message,
        sessionId: tesseraSessionId,
      });
      cliProcess.kill('SIGTERM');
      return {
        process: cliProcess,
        ok: false,
        error: err instanceof Error ? err : new Error(String(err)),
      };
    }

    return { process: cliProcess, ok: true };
  }

  onSessionReady(proc: ChildProcess, sessionId: string): boolean {
    const runtimeConfig = this._processRuntimeConfig.get(proc);
    if (!runtimeConfig || this._initialConfigSent.has(proc)) {
      return false;
    }

    this._initialConfigSent.add(proc);
    let wrote = false;

    const modelId = composeOpenCodeModelId(runtimeConfig.model, runtimeConfig.reasoningEffort);
    if (modelId) {
      wrote = this._sendSetModel(proc, sessionId, modelId) || wrote;
    }

    if (runtimeConfig.sessionMode) {
      wrote = this._sendSetMode(proc, sessionId, runtimeConfig.sessionMode) || wrote;
    }

    return wrote;
  }

  sendMessage(proc: ChildProcess, content: string | ContentBlock[]): boolean {
    const runtimeConfig = this._processRuntimeConfig.get(proc);
    const opencodeSessionId = runtimeConfig?.opencodeSessionId;
    if (!runtimeConfig || !opencodeSessionId) {
      logger.error('OpenCodeAdapter: cannot send session/prompt without OpenCode session id');
      return false;
    }

    const requestId = this._nextRequestId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'session/prompt',
      params: {
        sessionId: opencodeSessionId,
        prompt: buildPromptParts(content),
      },
    };

    opencodeProtocolParser.trackPendingRequest(runtimeConfig.sessionId, requestId, 'session/prompt');
    const ok = proc.stdin?.write(JSON.stringify(request) + '\n') ?? false;
    logger.debug('OpenCodeAdapter: sent session/prompt', {
      sessionId: runtimeConfig.sessionId,
      opencodeSessionId,
      requestId,
    });
    return ok;
  }

  parseStdout(line: string): ParsedMessage | null {
    const messages = this.parseSessionStdout('__provider__', line);
    return messages.length > 0 ? messages[0] : null;
  }

  parseSessionStdout(sessionId: string, line: string): ParsedMessage[] {
    return opencodeProtocolParser.parseStdout(sessionId, line);
  }

  handleSessionExit(sessionId: string, exitCode: number): ParsedMessage[] {
    return opencodeProtocolParser.handleProcessExit(sessionId, exitCode);
  }

  updateSessionConfig(
    proc: ChildProcess,
    patch: ProviderRuntimeControls & {
      permissionMode?: string;
      model?: string;
      reasoningEffort?: string | null;
    },
  ): boolean {
    const current = this._processRuntimeConfig.get(proc);
    if (!current) {
      return false;
    }

    const modelSelection = splitOpenCodeModelId(patch.model ?? current.model);
    const nextBaseModel = modelSelection.baseModelId;
    const nextReasoningEffort = patch.reasoningEffort !== undefined
      ? patch.reasoningEffort
      : (patch.model ? modelSelection.reasoningEffort : current.reasoningEffort);
    const nextModelId = composeOpenCodeModelId(nextBaseModel, nextReasoningEffort);

    let wrote = false;
    if ((patch.model || patch.reasoningEffort !== undefined) && nextModelId) {
      wrote = this._sendSetModel(proc, current.sessionId, nextModelId) || wrote;
    }
    if (patch.sessionMode) {
      wrote = this._sendSetMode(proc, current.sessionId, patch.sessionMode) || wrote;
    }

    this._processRuntimeConfig.set(proc, {
      ...current,
      ...(nextBaseModel ? { model: nextBaseModel } : {}),
      ...(patch.model || patch.reasoningEffort !== undefined ? { reasoningEffort: nextReasoningEffort ?? null } : {}),
      ...(patch.sessionMode ? { sessionMode: patch.sessionMode } : {}),
      ...(patch.accessMode ? { accessMode: patch.accessMode } : {}),
    });

    return wrote;
  }

  sendApprovalResponse(proc: ChildProcess, requestId: string, decision: 'accept' | 'decline'): void {
    const numericId = Number(requestId);
    const id = Number.isNaN(numericId) ? requestId : numericId;
    const optionId = decision === 'accept' ? 'once' : 'reject';
    const response = {
      jsonrpc: '2.0' as const,
      id,
      result: {
        outcome: {
          outcome: 'selected',
          optionId,
        },
      },
    };

    proc.stdin?.write(JSON.stringify(response) + '\n');
    logger.info('OpenCodeAdapter: sent permission response', { requestId, decision, optionId });
  }

  sendInterrupt(proc: ChildProcess, _sessionId: string): boolean {
    const runtimeConfig = this._processRuntimeConfig.get(proc);
    if (!runtimeConfig?.opencodeSessionId) {
      return false;
    }

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method: 'session/cancel',
      params: { sessionId: runtimeConfig.opencodeSessionId },
    };

    return proc.stdin?.write(JSON.stringify(notification) + '\n') ?? false;
  }

  async generateTitle(prompt: string, userId?: string): Promise<GeneratedTitle | null> {
    try {
      return await this._generateTitleViaRun(prompt, userId);
    } catch (err) {
      logger.warn('OpenCodeAdapter: generateTitle failed', {
        error: (err as Error).message,
      });
      return null;
    }
  }

  private async _performHandshake(
    proc: ChildProcess,
    cwd: string,
    options: SpawnOptions,
  ): Promise<string> {
    let nextId = 1;
    const initId = nextId++;
    const initRequest: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: initId,
      method: 'initialize',
      params: {
        protocolVersion: 1,
        clientCapabilities: {},
        clientInfo: { name: 'tessera', version: '1.0.0' },
      },
    };

    proc.stdin?.write(JSON.stringify(initRequest) + '\n');
    await this._awaitResponse(proc, initId, 'initialize');

    const sessionId = options.resume && options.opencodeSessionId
      ? options.opencodeSessionId
      : undefined;
    const sessionMethod = sessionId ? 'session/resume' : 'session/new';
    const sessionReqId = nextId++;
    const sessionRequest: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: sessionReqId,
      method: sessionMethod,
      params: {
        ...(sessionId ? { sessionId } : {}),
        cwd,
        mcpServers: [],
      },
    };

    proc.stdin?.write(JSON.stringify(sessionRequest) + '\n');
    const sessionResponse = await this._awaitResponse(proc, sessionReqId, sessionMethod);
    const opencodeSessionId = sessionResponse.result?.sessionId ?? sessionId;
    if (typeof opencodeSessionId !== 'string' || !opencodeSessionId) {
      throw new Error(`OpenCodeAdapter: ${sessionMethod} response missing sessionId`);
    }

    return opencodeSessionId;
  }

  private _sendSetModel(proc: ChildProcess, tesseraSessionId: string, model: string): boolean {
    const runtimeConfig = this._processRuntimeConfig.get(proc);
    if (!runtimeConfig?.opencodeSessionId) {
      return false;
    }

    const requestId = this._nextRequestId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'session/set_model',
      params: {
        sessionId: runtimeConfig.opencodeSessionId,
        modelId: model,
      },
    };

    opencodeProtocolParser.setSessionModel(tesseraSessionId, model);
    opencodeProtocolParser.trackPendingRequest(tesseraSessionId, requestId, 'session/set_model');
    return proc.stdin?.write(JSON.stringify(request) + '\n') ?? false;
  }

  private _sendSetMode(
    proc: ChildProcess,
    tesseraSessionId: string,
    sessionMode: NonNullable<ProviderRuntimeControls['sessionMode']>,
  ): boolean {
    const runtimeConfig = this._processRuntimeConfig.get(proc);
    if (!runtimeConfig?.opencodeSessionId) {
      return false;
    }

    const requestId = this._nextRequestId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: requestId,
      method: 'session/set_mode',
      params: {
        sessionId: runtimeConfig.opencodeSessionId,
        modeId: normalizeOpenCodeSessionMode(sessionMode),
      },
    };

    opencodeProtocolParser.trackPendingRequest(tesseraSessionId, requestId, 'session/set_mode');
    return proc.stdin?.write(JSON.stringify(request) + '\n') ?? false;
  }

  private _awaitResponse(
    proc: ChildProcess,
    expectedId: number,
    method: string,
  ): Promise<{ id: number; result?: Record<string, any>; error?: any }> {
    return new Promise((resolve, reject) => {
      let buffer = '';
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`OpenCodeAdapter: timed out waiting for response id=${expectedId} (${method})`));
      }, CLI_TIMEOUT_MS);

      const cleanup = () => {
        clearTimeout(timeout);
        proc.stdout?.removeListener('data', onData);
        proc.removeListener('error', onError);
        proc.removeListener('close', onClose);
      };

      const finish = (callback: () => void) => {
        if (settled) return;
        settled = true;
        cleanup();
        callback();
      };

      const onData = (chunk: Buffer | string) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let parsed: any;
          try {
            parsed = JSON.parse(trimmed);
          } catch {
            continue;
          }

          if (parsed.id !== expectedId) {
            continue;
          }

          finish(() => {
            if (parsed.error) {
              reject(new Error(
                `OpenCodeAdapter: JSON-RPC error for id=${expectedId} (${method}): ` +
                `${parsed.error.message} (code ${parsed.error.code})`,
              ));
            } else {
              resolve(parsed);
            }
          });
          return;
        }
      };

      const onError = (err: Error) => {
        finish(() => reject(new Error(`OpenCodeAdapter: process error during handshake: ${err.message}`)));
      };

      const onClose = (code: number | null) => {
        finish(() => reject(new Error(`OpenCodeAdapter: process closed (code=${code}) before response id=${expectedId}`)));
      };

      proc.stdout?.on('data', onData);
      proc.once('error', onError);
      proc.once('close', onClose);
    });
  }

  private async _generateTitleViaRun(
    prompt: string,
    userId?: string,
  ): Promise<GeneratedTitle | null> {
    const agentEnv = await getAgentEnvironment(userId);
    const command = await resolveProviderCliCommand(PROVIDER_ID, DEFAULT_COMMAND, agentEnv, userId);

    return new Promise((resolve, reject) => {
      const child = spawnCli(command, [
        'run',
        '--format',
        'json',
      ], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: getRuntimePlatform() === 'win32' ? process.env.TEMP || process.cwd() : '/tmp',
        env: process.env as NodeJS.ProcessEnv,
      }, agentEnv);

      let buffer = '';
      let stderr = '';
      let settled = false;
      let titleFound: GeneratedTitle | null = null;
      let lastText = '';

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        resolve(titleFound);
      }, TITLE_TIMEOUT_MS);

      child.stdout?.on('data', (chunk: Buffer | string) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let parsed: any;
          try {
            parsed = JSON.parse(trimmed);
          } catch {
            continue;
          }

          if (parsed.type === 'text' && typeof parsed.part?.text === 'string') {
            lastText = parsed.part.text;
            titleFound = parseGeneratedTitleText(parsed.part.text) ?? titleFound;
          }
        }
      });

      child.stderr?.on('data', (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      child.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`OpenCodeAdapter: failed to spawn opencode run: ${err.message}`));
      });

      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);

        if (!titleFound && code !== 0) {
          reject(new Error(`opencode run exited with code ${code}: ${stderr.slice(0, 200)}`));
          return;
        }

        if (!titleFound && lastText) {
          reject(new Error(`Invalid OpenCode title payload: ${lastText.slice(0, 300)}`));
          return;
        }

        resolve(titleFound);
      });

      child.stdin?.write(prompt);
      child.stdin?.end();
    });
  }
}

function buildPromptParts(content: string | ContentBlock[]): OpenCodePromptPart[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }

  return content.flatMap((block): OpenCodePromptPart[] => {
    if (block.type === 'text') {
      return [{ type: 'text', text: block.text }];
    }
    if (block.type === 'image') {
      return [{
        type: 'image',
        mimeType: block.source.media_type,
        data: block.source.data,
      }];
    }
    if (block.type === 'skill') {
      return [{ type: 'text', text: `/${block.name}` }];
    }
    return [];
  });
}

function parseGeneratedTitleText(text: string): GeneratedTitle | null {
  const trimmed = text.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed?.title === 'string') {
      return { title: parsed.title.slice(0, 100) };
    }
  } catch {
    // Fall through to regex extraction for slightly noisy responses.
  }

  const match = trimmed.match(/"title"\s*:\s*"([^"]+)"/);
  if (!match) return null;
  return { title: match[1].slice(0, 100) };
}

export const opencodeAdapter = new OpenCodeAdapter();
