import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { CLOUD_TRAIL_SNS_TOPIC_ARN, stack } from '@shared';
import { cloudStorageClusterName } from './cluster';
import type { ServiceLoadBalancer } from './load_balancer';
import type { Service } from './service';

export class ServiceAlarms extends pulumi.ComponentResource {
  constructor(
    serviceName: string,
    args: {
      service: Service;
      loadBalancer: ServiceLoadBalancer;
      tags: Record<string, string>;
    },
    opts?: pulumi.ComponentResourceOptions
  ) {
    super(
      `macro:cloud_storage:ServiceAlarms`,
      `${serviceName}-service-alarms-${stack}`,
      args,
      opts
    );
    const { service, loadBalancer, tags } = args;
    new aws.cloudwatch.MetricAlarm(
      `${serviceName}-high-cpu-alarm`,
      {
        name: `${serviceName}-high-cpu-alarm-${stack}`,
        metricName: 'CPUUtilization',
        namespace: 'AWS/ECS',
        statistic: 'Maximum',
        period: 180,
        evaluationPeriods: 1,
        threshold: 60,
        comparisonOperator: 'GreaterThanThreshold',
        dimensions: {
          ClusterName: cloudStorageClusterName,
          ServiceName: service.serviceName,
        },
        alarmDescription: `High CPU usage alarm for ${serviceName} service.`,
        actionsEnabled: true,
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags: tags,
      },
      { parent: this, dependsOn: [service.service, loadBalancer] }
    );

    new aws.cloudwatch.MetricAlarm(
      `${serviceName}-high-mem-alarm`,
      {
        name: `${serviceName}-high-mem-alarm-${stack}`,
        metricName: 'MemoryUtilization',
        namespace: 'AWS/ECS',
        statistic: 'Maximum',
        period: 180,
        evaluationPeriods: 1,
        threshold: 80,
        comparisonOperator: 'GreaterThanThreshold',
        dimensions: {
          ClusterName: cloudStorageClusterName,
          ServiceName: service.serviceName,
        },
        alarmDescription: `High Memory usage alarm for ${serviceName} service.`,
        actionsEnabled: true,
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags: tags,
      },
      { parent: this, dependsOn: [service.service, loadBalancer] }
    );

    new aws.cloudwatch.MetricAlarm(
      `${serviceName}-http-5xx-alarm`,
      {
        name: `${serviceName}-http-5xx-${stack}`,
        metricName: 'HTTPCode_ELB_5XX_Count',
        namespace: 'AWS/ApplicationELB',
        statistic: 'Sum',
        period: 180,
        evaluationPeriods: 1,
        threshold: 25,
        comparisonOperator: 'GreaterThanOrEqualToThreshold',
        dimensions: {
          LoadBalancer: loadBalancer.loadBalancerArn,
        },
        alarmDescription: `High HTTP 5XX count alarm for ${serviceName} Load Balancer.`,
        actionsEnabled: true,
        alarmActions: [CLOUD_TRAIL_SNS_TOPIC_ARN],
        tags: tags,
      },
      { parent: this, dependsOn: [service.service, loadBalancer] }
    );
  }
}
