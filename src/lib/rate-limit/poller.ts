import { getRateLimitData, type RateLimitData } from './fetcher';
import type { ServerTransportMessage } from '../ws/message-types';
import type { CliEnvironment } from '../cli/cli-exec';
import logger from '../logger';
import { buildClaudeRateLimitSnapshot } from '../status-display/rate-limit-snapshots';

const POLL_INTERVAL_MS = 300_000; // 5 minutes

type BroadcastFn = (message: ServerTransportMessage) => void;
type EnvironmentResolver = () => CliEnvironment | Promise<CliEnvironment>;

class RateLimitPoller {
  private interval: NodeJS.Timeout | null = null;
  private broadcastFn: BroadcastFn | null = null;
  private environmentResolver: EnvironmentResolver | null = null;

  setBroadcast(fn: BroadcastFn): void {
    this.broadcastFn = fn;
  }

  setEnvironmentResolver(fn: EnvironmentResolver | null): void {
    this.environmentResolver = fn;
  }

  async start(): Promise<void> {
    if (this.interval) return;

    this.interval = setInterval(() => {
      void this.poll();
    }, POLL_INTERVAL_MS);

    logger.info({ intervalMs: POLL_INTERVAL_MS }, 'Rate limit poller started');

    // Fetch immediately on start.
    await this.poll();
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      logger.info('Rate limit poller stopped');
    }
  }

  private async resolveEnvironment(): Promise<CliEnvironment> {
    if (!this.environmentResolver) return 'native';

    try {
      return await this.environmentResolver();
    } catch (err) {
      logger.warn({ error: err }, 'Rate limit environment resolver failed');
      return 'native';
    }
  }

  private async poll(): Promise<void> {
    try {
      const environment = await this.resolveEnvironment();
      const data = await getRateLimitData({ environment });
      if (data && this.broadcastFn) {
        this.broadcastFn({
          type: 'rate_limit_update',
          ...buildClaudeRateLimitSnapshot(data),
        });
      }
    } catch (err) {
      logger.error({ error: err }, 'Rate limit poll error');
    }
  }
}

export const rateLimitPoller = new RateLimitPoller();
