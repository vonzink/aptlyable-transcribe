import { runWorker } from './transcriptionWorker';
import { log } from './lib/logger';

async function main(): Promise<void> {
  const controller = new AbortController();
  let shuttingDown = false;

  const onSignal = (sig: NodeJS.Signals) => {
    if (shuttingDown) {
      log.warn('second signal received — exiting hard', { sig });
      process.exit(1);
    }
    shuttingDown = true;
    log.info('signal received — graceful shutdown', { sig });
    controller.abort();
  };

  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    await runWorker({ signal: controller.signal });
    process.exit(0);
  } catch (err) {
    log.error('fatal worker error', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }
}

main().catch((err) => {
  // Belt-and-suspenders.
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
