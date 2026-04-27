import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { config } from './config';
import type { TranscriptionProviderName } from '../providers/types';

const sm = new SecretsManagerClient({ region: config.region });

const cache: Partial<Record<TranscriptionProviderName, string>> = {};

const SECRET_NAMES: Record<TranscriptionProviderName, string> = {
  deepgram: config.deepgramSecretName,
  openai: config.openaiSecretName,
  assemblyai: config.assemblyaiSecretName,
};

/**
 * Fetch a provider's API key from Secrets Manager. Cached for the
 * lifetime of the process; restart the worker to pick up rotations.
 *
 * Each key is independent — a deployment can leave OpenAI/AssemblyAI
 * unset (placeholder value) and still process Deepgram jobs. The error
 * only fires when a job actually requests an unset provider.
 */
export async function getProviderApiKey(
  provider: TranscriptionProviderName,
): Promise<string> {
  const cached = cache[provider];
  if (cached) return cached;

  const secretId = SECRET_NAMES[provider];
  const out = await sm.send(new GetSecretValueCommand({ SecretId: secretId }));
  const value = out.SecretString ?? '';
  if (!value || value === 'REPLACE_ME_AFTER_DEPLOY') {
    throw new Error(
      `Secret "${secretId}" for provider "${provider}" is unset or still placeholder. ` +
        `Run scripts/create-secret.sh ${provider} <key>.`,
    );
  }
  cache[provider] = value;
  return value;
}
