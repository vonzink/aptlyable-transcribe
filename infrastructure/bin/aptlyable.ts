#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AptlyableStack } from '../lib/aptlyable-stack';

const app = new cdk.App();

const account = process.env.CDK_DEFAULT_ACCOUNT;
const region = process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? 'us-east-1';

// Override at deploy with: `npx cdk deploy -c environment=prod`
const environment =
  (app.node.tryGetContext('environment') as string | undefined) ??
  process.env.ENVIRONMENT ??
  'mvp';

const defaultProviderRaw =
  (app.node.tryGetContext('defaultProvider') as string | undefined) ??
  process.env.DEFAULT_PROVIDER;

const defaultProvider: 'deepgram' | 'openai' | 'assemblyai' | undefined =
  defaultProviderRaw === 'deepgram' || defaultProviderRaw === 'openai' || defaultProviderRaw === 'assemblyai'
    ? defaultProviderRaw
    : undefined;

const maxFileSizeMBRaw =
  (app.node.tryGetContext('maxFileSizeMB') as string | undefined) ??
  process.env.MAX_FILE_SIZE_MB;
const maxFileSizeMB = maxFileSizeMBRaw ? parseInt(maxFileSizeMBRaw, 10) : undefined;

const alertEmail =
  (app.node.tryGetContext('alertEmail') as string | undefined) ??
  process.env.ALERT_EMAIL ??
  undefined;

const stack = new AptlyableStack(app, 'AptlyableStack', {
  env: { account, region },
  description: 'AptlyAble — bulk MP3 transcription via Deepgram / OpenAI / AssemblyAI.',
  allowedOrigins:
    (app.node.tryGetContext('allowedOrigins') as string | undefined) ??
    process.env.ALLOWED_ORIGINS ??
    'http://localhost:3000',
  environment,
  defaultProvider,
  maxFileSizeMB,
  alertEmail,
});

// Stack-level tags — propagate to every taggable resource (S3, DDB,
// SQS, Lambda, EC2, IAM, log groups). Cost Explorer + IAM conditions
// can then filter the AptlyAble surface area inside a shared account.
cdk.Tags.of(stack).add('Project', 'AptlyAble');
cdk.Tags.of(stack).add('Environment', environment);
cdk.Tags.of(stack).add('ManagedBy', 'CDK');
