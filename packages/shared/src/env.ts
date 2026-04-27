/**
 * Tiny env-reading helpers used by every server-side workspace.
 * Throw fast on misconfiguration; never silently fall back when a
 * required value is missing.
 */

export function required(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

export function optional(
  name: string,
  fallback: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const value = env[name];
  return value && value.trim() !== '' ? value : fallback;
}

export function optionalUndef(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const value = env[name];
  return value && value.trim() !== '' ? value : undefined;
}

export function intEnv(
  name: string,
  fallback: number,
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
