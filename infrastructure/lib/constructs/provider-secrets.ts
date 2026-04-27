import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as sm from 'aws-cdk-lib/aws-secretsmanager';

/**
 * One Secrets Manager entry per transcription provider.
 *
 * Each is independent so unused providers can stay at the placeholder
 * value. Replace with:
 *   aws secretsmanager put-secret-value --secret-id <name> --secret-string <KEY>
 * (or use ./scripts/create-secret.sh).
 */
export class ProviderSecrets extends Construct {
  readonly deepgram: sm.Secret;
  readonly openai: sm.Secret;
  readonly assemblyai: sm.Secret;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.deepgram = new sm.Secret(this, 'Deepgram', {
      secretName: 'aptlyable/deepgram/api-key',
      description: 'Deepgram API key used by the AptlyAble worker.',
      secretStringValue: cdk.SecretValue.unsafePlainText('REPLACE_ME_AFTER_DEPLOY'),
    });

    this.openai = new sm.Secret(this, 'OpenAI', {
      secretName: 'aptlyable/openai/api-key',
      description: 'OpenAI API key used by the AptlyAble worker (gpt-4o-transcribe).',
      secretStringValue: cdk.SecretValue.unsafePlainText('REPLACE_ME_AFTER_DEPLOY'),
    });

    this.assemblyai = new sm.Secret(this, 'AssemblyAI', {
      secretName: 'aptlyable/assemblyai/api-key',
      description: 'AssemblyAI API key used by the AptlyAble worker (Universal-2).',
      secretStringValue: cdk.SecretValue.unsafePlainText('REPLACE_ME_AFTER_DEPLOY'),
    });
  }
}
