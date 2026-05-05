import logger from '@/lib/logger';
import { getCliStatusSnapshot } from './connection-checker';

export function prewarmCliStatusSnapshot(source: string): void {
  void (async () => {
    try {
      const startedAt = Date.now();
      const results = await getCliStatusSnapshot({ force: true });

      logger.info({
        source,
        resultCount: results.length,
        durationMs: Date.now() - startedAt,
      }, 'CLI status snapshot prewarmed');
    } catch (error) {
      logger.warn({ source, error }, 'CLI status snapshot prewarm failed');
    }
  })();
}
