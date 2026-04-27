/**
 * API-local SQS wrapper bound to this service's queue.
 */
import {
  enqueueJob as sharedEnqueueJob,
  type SqsContext,
  type TranscriptionJobMessage,
} from '@aptlyable/shared';
import { config } from './config';

const ctx: SqsContext = { region: config.region, queueUrl: config.queueUrl };

export const enqueueJob = (msg: TranscriptionJobMessage) => sharedEnqueueJob(ctx, msg);

export type { TranscriptionJobMessage };
