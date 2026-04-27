/**
 * Structured single-line JSON logger.
 *
 * Stays dependency-free on purpose — Lambdas (esbuild-bundled) and the
 * EC2 worker (tsc-built, journald → CloudWatch) both want each line to
 * be a self-contained JSON object that downstream tools (Athena,
 * CloudWatch Logs Insights) can parse without configuration.
 *
 * Use `withFields({ requestId })` to bind correlation context once per
 * invocation — every subsequent log call carries the bound fields.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  withFields(extra: Record<string, unknown>): Logger;
}

function emit(level: Level, msg: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function make(bound: Record<string, unknown>): Logger {
  return {
    debug: (msg, fields) => emit('debug', msg, { ...bound, ...fields }),
    info: (msg, fields) => emit('info', msg, { ...bound, ...fields }),
    warn: (msg, fields) => emit('warn', msg, { ...bound, ...fields }),
    error: (msg, fields) => emit('error', msg, { ...bound, ...fields }),
    withFields: (extra) => make({ ...bound, ...extra }),
  };
}

/** Default logger with no bound fields. */
export const log: Logger = make({});
