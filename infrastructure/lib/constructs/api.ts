import * as path from 'path';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sm from 'aws-cdk-lib/aws-secretsmanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigwIntegrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as logs from 'aws-cdk-lib/aws-logs';

export interface ApiSurfaceProps {
  allowedOrigins: string[];
  bucket: s3.Bucket;
  jobsTable: dynamodb.Table;
  jobsTableStatusIndexName: string;
  jobsTableTwilioIndexName: string;
  queue: sqs.Queue;
  twilioSecret: sm.Secret;
  /** Default transcription provider when the client doesn't specify one. */
  defaultProvider: string;
  /** Global upload size cap in MB. */
  maxFileSizeMB: number;
}

interface FunctionConfig {
  id: string;
  handlerEntry: string;
  memorySize?: number;
  timeoutSeconds?: number;
}

/**
 * API Gateway HTTP API + the eight Lambdas that fulfill it.
 *
 * Each Lambda gets its own explicit CloudWatch LogGroup (so we don't
 * use the deprecated `logRetention` shortcut, which spawned a hidden
 * resource per function). Permissions are scoped per role.
 */
export class ApiSurface extends Construct {
  readonly httpApi: apigwv2.HttpApi;
  readonly url: string;
  readonly functions: lambda.IFunction[];

  constructor(scope: Construct, id: string, props: ApiSurfaceProps) {
    super(scope, id);

    const apiSrcDir = path.resolve(__dirname, '..', '..', '..', 'services', 'api', 'src');

    const apiEnv: Record<string, string> = {
      AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
      S3_BUCKET_NAME: props.bucket.bucketName,
      JOBS_TABLE_NAME: props.jobsTable.tableName,
      JOBS_TABLE_STATUS_INDEX: props.jobsTableStatusIndexName,
      JOBS_TABLE_TWILIO_INDEX: props.jobsTableTwilioIndexName,
      TRANSCRIPTION_QUEUE_URL: props.queue.queueUrl,
      ALLOWED_ORIGINS: props.allowedOrigins.join(','),
      MAX_FILE_SIZE_MB: String(props.maxFileSizeMB),
      PRESIGNED_UPLOAD_EXPIRES_SECONDS: '900',
      PRESIGNED_DOWNLOAD_EXPIRES_SECONDS: '900',
      DEFAULT_PROVIDER: props.defaultProvider,
      TWILIO_SECRET_NAME: props.twilioSecret.secretName,
    };

    const makeFn = (cfg: FunctionConfig): nodejs.NodejsFunction => {
      // One log group per function with a deterministic name so CloudWatch
      // Logs Insights queries (and ops runbooks) can address it.
      const logGroup = new logs.LogGroup(this, `${cfg.id}LogGroup`, {
        logGroupName: `/aws/lambda/aptlyable-${cfg.id}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      return new nodejs.NodejsFunction(this, cfg.id, {
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(apiSrcDir, cfg.handlerEntry),
        handler: 'handler',
        memorySize: cfg.memorySize ?? 512,
        timeout: cdk.Duration.seconds(cfg.timeoutSeconds ?? 15),
        architecture: lambda.Architecture.ARM_64,
        environment: apiEnv,
        bundling: {
          minify: true,
          sourceMap: true,
          target: 'node20',
          externalModules: [],
        },
        logGroup,
      });
    };

    const fnCreateUploads = makeFn({ id: 'FnCreateUploads', handlerEntry: 'handlers/createUploads.ts' });
    const fnCompleteUploads = makeFn({ id: 'FnCompleteUploads', handlerEntry: 'handlers/completeUploads.ts' });
    const fnListJobs = makeFn({ id: 'FnListJobs', handlerEntry: 'handlers/listJobs.ts' });
    const fnGetJob = makeFn({ id: 'FnGetJob', handlerEntry: 'handlers/getJob.ts' });
    const fnGetTranscript = makeFn({ id: 'FnGetTranscript', handlerEntry: 'handlers/getTranscript.ts' });
    const fnGetRawJson = makeFn({ id: 'FnGetRawJson', handlerEntry: 'handlers/getRawJson.ts' });
    const fnRetryJob = makeFn({ id: 'FnRetryJob', handlerEntry: 'handlers/retryJob.ts' });

    // Twilio webhook needs more memory + longer timeout — it downloads
    // the recording inline before responding 200.
    const fnTwilioCallback = makeFn({
      id: 'FnTwilioCallback',
      handlerEntry: 'handlers/twilioRecordingCallback.ts',
      memorySize: 1024,
      timeoutSeconds: 60,
    });

    // -- Permissions -------------------------------------------------
    const presignFns = [
      fnCreateUploads,
      fnCompleteUploads,
      fnListJobs,
      fnGetJob,
      fnGetTranscript,
      fnGetRawJson,
      fnRetryJob,
    ];

    for (const fn of presignFns) {
      props.bucket.grantPut(fn, 'uploads/*');
      props.bucket.grantRead(fn, 'uploads/*');
      props.bucket.grantRead(fn, 'transcripts/*');
      props.jobsTable.grantReadWriteData(fn);
    }

    props.queue.grantSendMessages(fnCompleteUploads);
    props.queue.grantSendMessages(fnRetryJob);

    // Twilio: ingest path needs S3 PUT + DDB + SQS + the auth token.
    props.bucket.grantPut(fnTwilioCallback, 'uploads/*');
    props.jobsTable.grantReadWriteData(fnTwilioCallback);
    props.queue.grantSendMessages(fnTwilioCallback);
    props.twilioSecret.grantRead(fnTwilioCallback);

    // -- API Gateway -------------------------------------------------
    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'aptlyable-api',
      corsPreflight: {
        allowOrigins: props.allowedOrigins,
        allowMethods: [
          apigwv2.CorsHttpMethod.GET,
          apigwv2.CorsHttpMethod.POST,
          apigwv2.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['Content-Type', 'Authorization'],
        maxAge: cdk.Duration.hours(1),
      },
    });

    const route = (
      pathPart: string,
      method: apigwv2.HttpMethod,
      fn: lambda.IFunction,
      integrationId: string,
    ): void => {
      this.httpApi.addRoutes({
        path: pathPart,
        methods: [method],
        integration: new apigwIntegrations.HttpLambdaIntegration(integrationId, fn),
      });
    };

    route('/api/uploads/create', apigwv2.HttpMethod.POST, fnCreateUploads, 'IntCreateUploads');
    route('/api/uploads/complete', apigwv2.HttpMethod.POST, fnCompleteUploads, 'IntCompleteUploads');
    route('/api/jobs', apigwv2.HttpMethod.GET, fnListJobs, 'IntListJobs');
    route('/api/jobs/{jobId}', apigwv2.HttpMethod.GET, fnGetJob, 'IntGetJob');
    route('/api/jobs/{jobId}/transcript', apigwv2.HttpMethod.GET, fnGetTranscript, 'IntGetTranscript');
    route('/api/jobs/{jobId}/raw', apigwv2.HttpMethod.GET, fnGetRawJson, 'IntGetRawJson');
    route('/api/jobs/{jobId}/retry', apigwv2.HttpMethod.POST, fnRetryJob, 'IntRetryJob');
    route('/api/twilio/recording-callback', apigwv2.HttpMethod.POST, fnTwilioCallback, 'IntTwilioCallback');

    this.url = this.httpApi.apiEndpoint;
    this.functions = [...presignFns, fnTwilioCallback];
  }
}
