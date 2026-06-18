import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { CLOUD_TRAIL_SNS_TOPIC_ARN, stack } from '../../../shared';

export type EcsDeploymentFailureAlarmArgs = {
  serviceName: string;
  serviceArn: pulumi.Input<string>;
  tags: Record<string, string>;
  alarmActions?: aws.cloudwatch.MetricAlarmArgs['alarmActions'];
  period?: pulumi.Input<number>;
  evaluationPeriods?: pulumi.Input<number>;
  threshold?: pulumi.Input<number>;
};

export class EcsDeploymentFailureAlarm extends pulumi.ComponentResource {
  eventRule: aws.cloudwatch.EventRule;
  alarm: aws.cloudwatch.MetricAlarm;

  constructor(
    name: string,
    args: EcsDeploymentFailureAlarmArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super(
      'my:components:EcsDeploymentFailureAlarm',
      name,
      { tags: args.tags },
      opts
    );

    const alarmActions = args.alarmActions ?? [CLOUD_TRAIL_SNS_TOPIC_ARN];
    const period = args.period ?? 60;
    const evaluationPeriods = args.evaluationPeriods ?? 1;
    const threshold = args.threshold ?? 0;

    const eventPattern = pulumi.output(args.serviceArn).apply((serviceArn) =>
      JSON.stringify({
        source: ['aws.ecs'],
        'detail-type': ['ECS Deployment State Change'],
        detail: {
          eventName: ['SERVICE_DEPLOYMENT_FAILED'],
        },
        resources: [serviceArn],
      })
    );

    this.eventRule = new aws.cloudwatch.EventRule(
      `${name}-event-rule`,
      {
        name: `${args.serviceName}-deployment-failure-${stack}`,
        description: `Matches failed ECS deployments for ${args.serviceName}.`,
        eventPattern,
        tags: args.tags,
      },
      { parent: this }
    );

    this.alarm = new aws.cloudwatch.MetricAlarm(
      `${name}-alarm`,
      {
        name: `${args.serviceName}-deployment-failure-alarm-${stack}`,
        alarmDescription: `[${stack.toUpperCase()}]: ECS deployment failed for ${args.serviceName}.`,
        comparisonOperator: 'GreaterThanThreshold',
        evaluationPeriods,
        metricName: 'TriggeredRules',
        namespace: 'AWS/Events',
        period,
        statistic: 'Sum',
        threshold,
        treatMissingData: 'notBreaching',
        dimensions: {
          RuleName: this.eventRule.name,
        },
        alarmActions,
        tags: args.tags,
      },
      { parent: this }
    );

    this.registerOutputs({
      eventRule: this.eventRule,
      alarm: this.alarm,
    });
  }
}
