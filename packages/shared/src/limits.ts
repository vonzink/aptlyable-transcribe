/**
 * Provider and platform constants shared across services + UI.
 * Centralized so a constraint change updates exactly one file.
 */

/** Default global cap on a single MP3 upload. */
export const DEFAULT_MAX_FILE_SIZE_MB = 250;

/** OpenAI's hard 25 MB cap on /v1/audio/transcriptions input. */
export const OPENAI_MAX_AUDIO_BYTES = 25 * 1024 * 1024;

/** Default visibility timeout sized for 3–10 minute MP3s with headroom. */
export const DEFAULT_SQS_VISIBILITY_TIMEOUT_SECONDS = 1800;
