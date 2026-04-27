/**
 * Worker-local SQS wrappers bound to this service's config + queue.
 */
import {
  receiveMessages as sharedReceiveMessages,
  deleteMessage as sharedDeleteMessage,
  returnToQueue as sharedReturnToQueue,
  type SqsContext,
  type ReceivedMessage,
} from '@aptlyable/shared';
import { config } from './config';

const ctx: SqsContext = { region: config.region, queueUrl: config.queueUrl };

export const receiveMessages = () =>
  sharedReceiveMessages(ctx, {
    maxMessages: config.sqsMaxMessages,
    waitTimeSeconds: config.sqsWaitTimeSeconds,
    visibilityTimeoutSeconds: config.sqsVisibilityTimeoutSeconds,
  });

export const deleteMessage = (receiptHandle: string) =>
  sharedDeleteMessage(ctx, receiptHandle);

export const returnToQueue = (receiptHandle: string) =>
  sharedReturnToQueue(ctx, receiptHandle);

export type { ReceivedMessage };
