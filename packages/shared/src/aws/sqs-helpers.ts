import {
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
} from '@aws-sdk/client-sqs';
import { getSqsClient } from './clients';
import type { TranscriptionJobMessage } from '../types/messages';

export interface SqsContext {
  region: string;
  queueUrl: string;
}

export interface ReceivedMessage {
  receiptHandle: string;
  messageId: string;
  body: string;
}

// ---- Producer (API) ----

export async function enqueueJob(
  ctx: SqsContext,
  msg: TranscriptionJobMessage,
): Promise<void> {
  await getSqsClient(ctx.region).send(
    new SendMessageCommand({
      QueueUrl: ctx.queueUrl,
      MessageBody: JSON.stringify(msg),
    }),
  );
}

// ---- Consumer (worker) ----

export async function receiveMessages(
  ctx: SqsContext,
  params: {
    maxMessages: number;
    waitTimeSeconds: number;
    visibilityTimeoutSeconds: number;
  },
): Promise<ReceivedMessage[]> {
  const out = await getSqsClient(ctx.region).send(
    new ReceiveMessageCommand({
      QueueUrl: ctx.queueUrl,
      MaxNumberOfMessages: params.maxMessages,
      WaitTimeSeconds: params.waitTimeSeconds,
      VisibilityTimeout: params.visibilityTimeoutSeconds,
    }),
  );

  return (out.Messages ?? [])
    .filter((m) => m.ReceiptHandle && m.Body)
    .map((m) => ({
      receiptHandle: m.ReceiptHandle as string,
      messageId: m.MessageId ?? 'unknown',
      body: m.Body as string,
    }));
}

export async function deleteMessage(
  ctx: SqsContext,
  receiptHandle: string,
): Promise<void> {
  await getSqsClient(ctx.region).send(
    new DeleteMessageCommand({ QueueUrl: ctx.queueUrl, ReceiptHandle: receiptHandle }),
  );
}

/** Hand the message back to the queue early so SQS retries / DLQs sooner. */
export async function returnToQueue(
  ctx: SqsContext,
  receiptHandle: string,
): Promise<void> {
  await getSqsClient(ctx.region).send(
    new ChangeMessageVisibilityCommand({
      QueueUrl: ctx.queueUrl,
      ReceiptHandle: receiptHandle,
      VisibilityTimeout: 0,
    }),
  );
}
