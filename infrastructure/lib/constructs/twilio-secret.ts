import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as sm from 'aws-cdk-lib/aws-secretsmanager';

/**
 * Twilio auth token. Used by the recording-callback Lambda to:
 *   (a) verify webhook X-Twilio-Signature
 *   (b) HTTP-Basic-auth the recording download REST API
 *
 * Account SID is sent on every webhook, so we don't store it.
 */
export class TwilioSecret extends Construct {
  readonly secret: sm.Secret;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.secret = new sm.Secret(this, 'AuthToken', {
      secretName: 'aptlyable/twilio/auth-token',
      description: 'Twilio auth token (verifies recording-callback signatures + downloads recordings).',
      secretStringValue: cdk.SecretValue.unsafePlainText('REPLACE_ME_AFTER_DEPLOY'),
    });
  }
}
