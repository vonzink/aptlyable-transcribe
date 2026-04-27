import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ecs from 'aws-cdk-lib/aws-ecs';

export interface AlarmsProps {
  /** SNS subscriber email. If undefined, no subscription is created. */
  alertEmail?: string;
  dlq: sqs.Queue;
  apiFunctions: lambda.IFunction[];
  workerService: ecs.FargateService;
  workerCluster: ecs.Cluster;
}

/**
 * Minimum-viable production alarms:
 *   1. DLQ depth >= 1                      (any message hit the DLQ)
 *   2. API Lambda Errors > 5 in 5 min      (sustained error rate)
 *   3. Worker task failures (RUNNING ↘ but in-flight messages stuck)
 *
 * All route to a single SNS topic. Subscribe more endpoints (Slack,
 * PagerDuty) later by attaching subscriptions to `this.topic`.
 */
export class Alarms extends Construct {
  readonly topic: sns.Topic;

  constructor(scope: Construct, id: string, props: AlarmsProps) {
    super(scope, id);

    this.topic = new sns.Topic(this, 'Topic', {
      topicName: 'aptlyable-alarms',
      displayName: 'AptlyAble alarms',
    });

    if (props.alertEmail) {
      this.topic.addSubscription(new snsSubs.EmailSubscription(props.alertEmail));
    }

    const action = new cwActions.SnsAction(this.topic);

    // --- 1. DLQ depth ---------------------------------------------
    const dlqAlarm = new cloudwatch.Alarm(this, 'DlqHasMessages', {
      alarmName: 'aptlyable-dlq-has-messages',
      alarmDescription: 'A transcription job hit the dead-letter queue.',
      metric: props.dlq.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(5),
        statistic: cloudwatch.Stats.MAXIMUM,
      }),
      threshold: 1,
      evaluationPeriods: 1,
      datapointsToAlarm: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    dlqAlarm.addAlarmAction(action);

    // --- 2. API Lambda errors -------------------------------------
    // One alarm per function so the alert tells you exactly which API
    // surface is failing without having to disambiguate.
    for (const fn of props.apiFunctions) {
      const fnAlarm = new cloudwatch.Alarm(this, `LambdaErrors-${fn.node.id}`, {
        alarmName: `aptlyable-lambda-errors-${fn.node.id}`,
        alarmDescription: `Sustained error rate on ${fn.node.id}.`,
        metric: fn.metricErrors({
          period: cdk.Duration.minutes(5),
          statistic: cloudwatch.Stats.SUM,
        }),
        threshold: 5,
        evaluationPeriods: 1,
        datapointsToAlarm: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      fnAlarm.addAlarmAction(action);
    }

    // --- 3. Worker pending tasks stuck ----------------------------
    // CPU on the worker service when there are tasks running. If
    // RunningTaskCount > 0 but CPUUtilization stays at 0 for 15 min,
    // the worker is alive but not doing work — likely a startup hang
    // or provider outage. We approximate with a CPU-based alarm.
    const cpuAlarm = new cloudwatch.Alarm(this, 'WorkerStuck', {
      alarmName: 'aptlyable-worker-stuck',
      alarmDescription:
        'Worker has running tasks but CPU is flat — likely a hung provider call or startup loop.',
      metric: new cloudwatch.Metric({
        namespace: 'AWS/ECS',
        metricName: 'CPUUtilization',
        dimensionsMap: {
          ClusterName: props.workerCluster.clusterName,
          ServiceName: props.workerService.serviceName,
        },
        period: cdk.Duration.minutes(5),
        statistic: cloudwatch.Stats.AVERAGE,
      }),
      threshold: 1,
      // 3 datapoints of 5 min each = 15 min sustained near-zero CPU
      evaluationPeriods: 3,
      datapointsToAlarm: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      // Missing data while desiredCount=0 is fine — that's the normal
      // idle state, not a stuck worker.
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    cpuAlarm.addAlarmAction(action);
  }
}
