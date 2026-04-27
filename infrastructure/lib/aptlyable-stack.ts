import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import { DEFAULT_MAX_FILE_SIZE_MB } from '@aptlyable/shared';
import { Storage } from './constructs/storage';
import { JobsTable } from './constructs/jobs-table';
import { TranscriptionQueue } from './constructs/transcription-queue';
import { ProviderSecrets } from './constructs/provider-secrets';
import { TwilioSecret } from './constructs/twilio-secret';
import { ApiSurface } from './constructs/api';
import { Worker } from './constructs/worker';
import { Alarms } from './constructs/alarms';
import type { WorkerTuning } from './constructs/worker';

export interface AptlyableStackProps extends cdk.StackProps {
  /** Comma-separated list of frontend origins allowed by S3 + API CORS. */
  allowedOrigins: string;
  /** Environment label, used as a tag (mvp/dev/staging/prod). */
  environment: string;
  /**
   * Default transcription provider when the client doesn't specify one.
   * Override at deploy with `-c defaultProvider=openai|assemblyai`.
   */
  defaultProvider?: 'deepgram' | 'openai' | 'assemblyai';
  /** Global upload size cap in MB. */
  maxFileSizeMB?: number;
  /** Optional email subscriber for CloudWatch alarms. */
  alertEmail?: string;
  /** Optional worker tuning overrides. */
  workerTuning?: WorkerTuning;
  /** Optional ceiling on concurrent Fargate tasks. Default 5. */
  maxWorkerTasks?: number;
}

/**
 * AptlyAble end-to-end stack:
 *   Frontend → API Gateway/Lambda → S3/DynamoDB/SQS → EC2 worker → Provider → S3/DDB
 *
 * Composition only — each AWS surface lives in its own L3 construct
 * under ./constructs/. This file is intentionally thin so a reader can
 * see the dependency graph at a glance.
 */
export class AptlyableStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AptlyableStackProps) {
    super(scope, id, props);

    const allowedOrigins = props.allowedOrigins
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    const defaultProvider = props.defaultProvider ?? 'deepgram';
    const maxFileSizeMB = props.maxFileSizeMB ?? DEFAULT_MAX_FILE_SIZE_MB;

    const storage = new Storage(this, 'Storage', { allowedOrigins });
    const jobs = new JobsTable(this, 'Jobs');
    const queue = new TranscriptionQueue(this, 'Queue');
    const providerSecrets = new ProviderSecrets(this, 'ProviderSecrets');
    const twilio = new TwilioSecret(this, 'TwilioSecret');

    const api = new ApiSurface(this, 'Api', {
      allowedOrigins,
      bucket: storage.bucket,
      jobsTable: jobs.table,
      jobsTableStatusIndexName: jobs.statusIndexName,
      jobsTableTwilioIndexName: jobs.twilioRecordingSidIndexName,
      queue: queue.queue,
      twilioSecret: twilio.secret,
      defaultProvider,
      maxFileSizeMB,
    });

    const worker = new Worker(this, 'Worker', {
      bucket: storage.bucket,
      jobsTable: jobs.table,
      queue: queue.queue,
      providerSecrets,
      defaultProvider,
      maxTaskCount: props.maxWorkerTasks,
      tuning: props.workerTuning,
    });

    new Alarms(this, 'Alarms', {
      alertEmail: props.alertEmail,
      dlq: queue.dlq,
      apiFunctions: api.functions,
      workerCluster: worker.cluster,
      workerService: worker.service,
    });

    // ---- Outputs ---------------------------------------------------
    new cdk.CfnOutput(this, 'ApiUrl', { value: api.url });
    new cdk.CfnOutput(this, 'BucketName', { value: storage.bucket.bucketName });
    new cdk.CfnOutput(this, 'JobsTableName', { value: jobs.table.tableName });
    new cdk.CfnOutput(this, 'QueueUrl', { value: queue.queue.queueUrl });
    new cdk.CfnOutput(this, 'DeepgramSecretName', { value: providerSecrets.deepgram.secretName });
    new cdk.CfnOutput(this, 'OpenAiSecretName', { value: providerSecrets.openai.secretName });
    new cdk.CfnOutput(this, 'AssemblyAiSecretName', { value: providerSecrets.assemblyai.secretName });
    new cdk.CfnOutput(this, 'TwilioSecretName', { value: twilio.secret.secretName });
    new cdk.CfnOutput(this, 'TwilioWebhookUrl', {
      value: `${api.url}/api/twilio/recording-callback`,
      description: 'Set this as the recordingStatusCallback URL in your Twilio app.',
    });
    new cdk.CfnOutput(this, 'WorkerClusterName', { value: worker.cluster.clusterName });
    new cdk.CfnOutput(this, 'WorkerServiceName', { value: worker.service.serviceName });
    new cdk.CfnOutput(this, 'WorkerLogGroupName', { value: worker.logGroup.logGroupName });
  }
}
