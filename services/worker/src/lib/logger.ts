/**
 * Re-export the shared logger so existing worker imports keep working.
 * Source of truth: packages/shared/src/logger.ts.
 */
export { log, type Logger } from '@aptlyable/shared';
