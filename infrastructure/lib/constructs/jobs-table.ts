import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

const STATUS_INDEX_NAME = 'status-createdAt-index';
const TWILIO_INDEX_NAME = 'twilio-recording-sid-index';

/**
 * DynamoDB table for transcription jobs.
 * Primary key: jobId.
 *
 * GSIs:
 *   - status-createdAt-index   : list jobs by status, newest first
 *   - twilio-recording-sid-index : O(1) idempotency lookup for Twilio
 *     webhooks (DDB cannot key on nested attrs, so we promote
 *     twilio.recordingSid to top-level twilioRecordingSid)
 */
export class JobsTable extends Construct {
  readonly table: dynamodb.Table;
  readonly statusIndexName: string = STATUS_INDEX_NAME;
  readonly twilioRecordingSidIndexName: string = TWILIO_INDEX_NAME;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.table = new dynamodb.Table(this, 'Table', {
      tableName: 'aptlyable-transcription-jobs',
      partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
    });

    this.table.addGlobalSecondaryIndex({
      indexName: STATUS_INDEX_NAME,
      partitionKey: { name: 'status', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // KEYS_ONLY projection — we only need jobId from the GSI; the
    // handler then does a GetItem against the base table for the row.
    this.table.addGlobalSecondaryIndex({
      indexName: TWILIO_INDEX_NAME,
      partitionKey: { name: 'twilioRecordingSid', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });
  }
}
