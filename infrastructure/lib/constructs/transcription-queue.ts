import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';

/**
 * Main transcription queue + DLQ.
 *
 * Visibility timeout (30 min) is sized for 3–10 min MP3s with headroom
 * so retries handle slow Deepgram / AssemblyAI responses.
 */
export class TranscriptionQueue extends Construct {
  readonly queue: sqs.Queue;
  readonly dlq: sqs.Queue;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.dlq = new sqs.Queue(this, 'DLQ', {
      queueName: 'aptlyable-transcription-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    this.queue = new sqs.Queue(this, 'Queue', {
      queueName: 'aptlyable-transcription-queue',
      visibilityTimeout: cdk.Duration.minutes(30),
      retentionPeriod: cdk.Duration.days(7),
      deadLetterQueue: { queue: this.dlq, maxReceiveCount: 3 },
    });
  }
}
