import * as path from 'path';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as appscaling from 'aws-cdk-lib/aws-applicationautoscaling';
import type { ProviderSecrets } from './provider-secrets';

export interface WorkerTuning {
  /** Number of concurrent transcriptions per task. Default 3. */
  concurrencyPerTask?: number;
  /** SQS long-poll wait. Default 20 (the max). */
  sqsWaitTimeSeconds?: number;
  /** SQS messages received per ReceiveMessage call. Default 5. */
  sqsMaxMessages?: number;
  /** Visibility timeout for in-flight messages. Default 1800 (30 min). */
  sqsVisibilityTimeoutSeconds?: number;
  /** Per-provider model overrides. */
  models?: {
    deepgram?: string;
    deepgramLanguage?: string;
    openai?: string;
    openaiLanguage?: string;
    assemblyai?: string;
    assemblyaiLanguage?: string;
  };
  /** Allow `aws ecs execute-command` into running tasks. Default false. */
  enableExecuteCommand?: boolean;
  /** Fargate Spot weight. Default 4 (paired with on-demand weight 1). */
  spotWeight?: number;
  /** Fargate on-demand weight (fallback for Spot reclamation). Default 1. */
  onDemandWeight?: number;
}

export interface WorkerProps {
  bucket: s3.Bucket;
  jobsTable: dynamodb.Table;
  queue: sqs.Queue;
  providerSecrets: ProviderSecrets;
  /** Default provider name written into the task env. */
  defaultProvider: string;
  /** Hard ceiling on concurrent transcription tasks. Default 5. */
  maxTaskCount?: number;
  /** Optional runtime tuning. Defaults are reasonable for an MVP. */
  tuning?: WorkerTuning;
}

/**
 * Fargate Spot transcription worker, scale-to-zero on idle.
 *
 * Topology:
 *   - VPC with public subnets only (no NAT cost; tasks get public IPs)
 *   - ECS cluster, FARGATE_SPOT capacity provider (~70% off Fargate)
 *   - Task definition built from services/worker/Dockerfile
 *   - Service starts at desiredCount=0
 *   - Step scaling on (visible + in-flight) SQS messages:
 *       backlog >= 1 for 1 min  → +1 task (max maxTaskCount)
 *       backlog == 0 for 5 min  → -1 task (min 0)
 *
 * Why scale on visible + in-flight: a long transcription leaves the
 * message "in flight" while the worker processes it. If we scaled on
 * `visible` alone, ECS would kill the task mid-job once the queue
 * looked empty.
 */
export class Worker extends Construct {
  readonly cluster: ecs.Cluster;
  readonly service: ecs.FargateService;
  readonly logGroup: logs.LogGroup;
  readonly taskRole: iam.Role;

  constructor(scope: Construct, id: string, props: WorkerProps) {
    super(scope, id);

    const tuning = props.tuning ?? {};
    const concurrencyPerTask = tuning.concurrencyPerTask ?? 3;
    const sqsWaitTimeSeconds = tuning.sqsWaitTimeSeconds ?? 20;
    const sqsMaxMessages = tuning.sqsMaxMessages ?? 5;
    const sqsVisibilityTimeoutSeconds = tuning.sqsVisibilityTimeoutSeconds ?? 1800;
    const models = tuning.models ?? {};
    const enableExecuteCommand = tuning.enableExecuteCommand ?? false;
    const spotWeight = tuning.spotWeight ?? 4;
    const onDemandWeight = tuning.onDemandWeight ?? 1;

    // -- VPC: public subnets only (no NAT Gateway, no $33/mo) --------
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
      ],
    });

    this.cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      enableFargateCapacityProviders: true,
      // off for MVP cost; flip to ENHANCED for production observability.
      containerInsightsV2: ecs.ContainerInsights.DISABLED,
    });

    // -- IAM ---------------------------------------------------------
    // Task ROLE = what the worker code uses (S3, DDB, SQS, secrets).
    this.taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'AptlyAble worker - runtime AWS permissions.',
    });

    props.bucket.grantRead(this.taskRole, 'uploads/*');
    props.bucket.grantWrite(this.taskRole, 'transcripts/*');
    props.bucket.grantRead(this.taskRole, 'transcripts/*');
    // Forensic dump for malformed SQS messages (see transcriptionWorker.ts).
    props.bucket.grantWrite(this.taskRole, 'dlq-debug/*');
    props.jobsTable.grantReadWriteData(this.taskRole);
    props.queue.grantConsumeMessages(this.taskRole);
    props.providerSecrets.deepgram.grantRead(this.taskRole);
    props.providerSecrets.openai.grantRead(this.taskRole);
    props.providerSecrets.assemblyai.grantRead(this.taskRole);

    // Task EXECUTION ROLE = what ECS itself uses to pull the image
    // and write logs. Created automatically by FargateTaskDefinition.

    // -- Logs --------------------------------------------------------
    this.logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: '/aptlyable/worker',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // -- Task definition ---------------------------------------------
    const taskDef = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      cpu: 512, // 0.5 vCPU
      memoryLimitMiB: 1024, // 1 GB — fits OpenAI 25 MB downloads + Deepgram/AssemblyAI streaming
      taskRole: this.taskRole,
      runtimePlatform: {
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
      },
    });

    // Build context is the repo root so the Dockerfile can copy
    // packages/shared alongside services/worker.
    const repoRoot = path.resolve(__dirname, '..', '..', '..');
    const image = ecs.ContainerImage.fromAsset(repoRoot, {
      file: 'services/worker/Dockerfile',
      platform: cdk.aws_ecr_assets.Platform.LINUX_ARM64,
    });

    taskDef.addContainer('worker', {
      image,
      logging: ecs.LogDrivers.awsLogs({
        logGroup: this.logGroup,
        streamPrefix: 'task',
      }),
      environment: {
        AWS_REGION: cdk.Stack.of(this).region,
        S3_BUCKET_NAME: props.bucket.bucketName,
        JOBS_TABLE_NAME: props.jobsTable.tableName,
        TRANSCRIPTION_QUEUE_URL: props.queue.queueUrl,
        DEEPGRAM_SECRET_NAME: props.providerSecrets.deepgram.secretName,
        OPENAI_SECRET_NAME: props.providerSecrets.openai.secretName,
        ASSEMBLYAI_SECRET_NAME: props.providerSecrets.assemblyai.secretName,
        DEFAULT_PROVIDER: props.defaultProvider,
        WORKER_CONCURRENCY: String(concurrencyPerTask),
        SQS_WAIT_TIME_SECONDS: String(sqsWaitTimeSeconds),
        SQS_MAX_MESSAGES: String(sqsMaxMessages),
        SQS_VISIBILITY_TIMEOUT_SECONDS: String(sqsVisibilityTimeoutSeconds),
        PRESIGNED_DOWNLOAD_EXPIRES_SECONDS: '900',
        DEEPGRAM_MODEL: models.deepgram ?? 'nova-3',
        DEEPGRAM_LANGUAGE: models.deepgramLanguage ?? 'en',
        OPENAI_MODEL: models.openai ?? 'gpt-4o-transcribe',
        ...(models.openaiLanguage ? { OPENAI_LANGUAGE: models.openaiLanguage } : {}),
        ASSEMBLYAI_MODEL: models.assemblyai ?? 'universal',
        ASSEMBLYAI_LANGUAGE: models.assemblyaiLanguage ?? 'en',
      },
      // 120s is the max ECS allows. Worker drains in-flight jobs on
      // SIGTERM (transcriptionWorker.ts). Anything longer rolls back to
      // SQS via the visibility timeout — idempotent on next pickup.
      stopTimeout: cdk.Duration.seconds(120),
    });

    // -- Service -----------------------------------------------------
    this.service = new ecs.FargateService(this, 'Service', {
      cluster: this.cluster,
      taskDefinition: taskDef,
      desiredCount: 0,
      // Mixed Spot + on-demand. Tradeoff: AWS can reclaim Spot tasks
      // with 2-min notice. SIGTERM-safe shutdown + idempotent SQS
      // re-delivery + the on-demand fallback (default 1:4 ratio) keep
      // throughput up during regional Spot exhaustion.
      capacityProviderStrategies: [
        { capacityProvider: 'FARGATE_SPOT', weight: spotWeight, base: 0 },
        { capacityProvider: 'FARGATE', weight: onDemandWeight, base: 0 },
      ],
      assignPublicIp: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      // Ensure new tasks start before old ones are stopped on deploy.
      minHealthyPercent: 0, // worker is fungible; allow full replacement
      maxHealthyPercent: 100,
      enableExecuteCommand,
    });

    // -- Auto-scaling on SQS depth ----------------------------------
    const maxTasks = props.maxTaskCount ?? 5;
    const scaling = this.service.autoScaleTaskCount({
      minCapacity: 0,
      maxCapacity: maxTasks,
    });

    // Scale UP: any visible message → spin up a task immediately.
    scaling.scaleOnMetric('ScaleUp', {
      metric: props.queue.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(1),
        statistic: cloudwatch.Stats.MAXIMUM,
      }),
      scalingSteps: [
        { upper: 0, change: 0 }, // 0 visible — no change (paired down-policy handles 0)
        { lower: 1, change: +1 },
        { lower: 5, change: +2 }, // burst: jump straight to +2 if backlog is already 5+
      ],
      adjustmentType: appscaling.AdjustmentType.CHANGE_IN_CAPACITY,
      cooldown: cdk.Duration.minutes(1),
    });

    // Scale DOWN: only when BOTH visible AND in-flight are zero, for
    // 5 consecutive minutes. Prevents killing a task mid-transcription.
    const visible = props.queue.metricApproximateNumberOfMessagesVisible({
      period: cdk.Duration.minutes(1),
      statistic: cloudwatch.Stats.MAXIMUM,
    });
    const inFlight = props.queue.metricApproximateNumberOfMessagesNotVisible({
      period: cdk.Duration.minutes(1),
      statistic: cloudwatch.Stats.MAXIMUM,
    });
    const totalBacklog = new cloudwatch.MathExpression({
      expression: 'visible + inFlight',
      usingMetrics: { visible, inFlight },
      label: 'TotalBacklog',
      period: cdk.Duration.minutes(1),
    });

    scaling.scaleOnMetric('ScaleDown', {
      metric: totalBacklog,
      // scaleOnMetric requires at least 2 intervals to define the curve.
      // We want: backlog == 0 → -1, anything else → no change.
      scalingSteps: [
        { upper: 0, change: -1 }, // backlog == 0 → -1 (clamps at minCapacity=0)
        { lower: 1, change: 0 }, // backlog >= 1 → no-op (ScaleUp handles it)
      ],
      adjustmentType: appscaling.AdjustmentType.CHANGE_IN_CAPACITY,
      cooldown: cdk.Duration.minutes(5),
      evaluationPeriods: 5,
      datapointsToAlarm: 5,
    });
  }
}
