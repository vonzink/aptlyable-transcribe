import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SQSClient } from '@aws-sdk/client-sqs';

/**
 * Lazily-constructed singleton clients keyed by region. Each consumer
 * (api Lambda, worker) typically uses one region — this just keeps
 * the client construction code in one place.
 */

const ddbDocClients = new Map<string, DynamoDBDocumentClient>();
const s3Clients = new Map<string, S3Client>();
const sqsClients = new Map<string, SQSClient>();

export function getDdbDocClient(region: string): DynamoDBDocumentClient {
  let cached = ddbDocClients.get(region);
  if (!cached) {
    cached = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
      marshallOptions: { removeUndefinedValues: true },
    });
    ddbDocClients.set(region, cached);
  }
  return cached;
}

export function getS3Client(region: string): S3Client {
  let cached = s3Clients.get(region);
  if (!cached) {
    cached = new S3Client({ region });
    s3Clients.set(region, cached);
  }
  return cached;
}

export function getSqsClient(region: string): SQSClient {
  let cached = sqsClients.get(region);
  if (!cached) {
    cached = new SQSClient({ region });
    sqsClients.set(region, cached);
  }
  return cached;
}
