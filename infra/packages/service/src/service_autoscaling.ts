import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { stack } from '@shared';
import { cloudStorageClusterName } from './cluster';
import type { ServiceLoadBalancer } from './load_balancer';
import type { Service } from './service';

export class ServiceAutoscaling extends pulumi.ComponentResource {
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
      `macro:cloud_storage:ServiceAutoscaling`,
      `${serviceName}-service-autoscaling-${stack}`,
      args,
      opts
    );
    const { service, loadBalancer, tags } = args;

    const serviceScalableTarget = new aws.appautoscaling.Target(
      `${serviceName}-service-scalable-target-${stack}`,
      {
        maxCapacity: stack === 'prod' ? 15 : 3,
        minCapacity: stack === 'prod' ? 6 : 1,
        resourceId: pulumi.interpolate`service/${cloudStorageClusterName}/${service.serviceName}`,
        scalableDimension: 'ecs:service:DesiredCount',
        serviceNamespace: 'ecs',
        tags,
      },
      { parent: this, dependsOn: [service.service] }
    );

    const lbPortion: pulumi.Output<string> = loadBalancer.loadBalancerArn.apply(
      (arn) => {
        const parts = arn.split(':loadbalancer/');
        return parts[1];
      }
    );

    const tgPortion: pulumi.Output<string> = loadBalancer.targetGroup.arn.apply(
      (arn) => {
        const parts = arn.split(':');
        return parts[parts.length - 1];
      }
    );

    const resourceLabel = pulumi.interpolate`${lbPortion}/${tgPortion}`;

    // Create an Auto Scaling policy for request count.
    new aws.appautoscaling.Policy(
      `${serviceName}-scaling-policy-request-count-${stack}`,
      {
        policyType: 'TargetTrackingScaling',
        resourceId: serviceScalableTarget.resourceId,
        scalableDimension: serviceScalableTarget.scalableDimension,
        serviceNamespace: serviceScalableTarget.serviceNamespace,
        targetTrackingScalingPolicyConfiguration: {
          targetValue: 1000, // TODO: play with this
          predefinedMetricSpecification: {
            predefinedMetricType: 'ALBRequestCountPerTarget',
            resourceLabel,
          },
          scaleInCooldown: 100,
          scaleOutCooldown: 120,
        },
      },
      { parent: this, dependsOn: [service.service, loadBalancer.targetGroup] }
    );

    // Create an Auto Scaling policy for CPU utilization.
    new aws.appautoscaling.Policy(
      `${serviceName}-scaling-policy-cpu-${stack}`,
      {
        policyType: 'TargetTrackingScaling',
        resourceId: serviceScalableTarget.resourceId,
        scalableDimension: serviceScalableTarget.scalableDimension,
        serviceNamespace: serviceScalableTarget.serviceNamespace,
        targetTrackingScalingPolicyConfiguration: {
          targetValue: 50.0,
          customizedMetricSpecification: {
            metricName: 'CPUUtilization',
            namespace: 'AWS/ECS',
            dimensions: [
              {
                name: 'ClusterName',
                value: pulumi.interpolate`${cloudStorageClusterName}`,
              },
              {
                name: 'ServiceName',
                value: pulumi.interpolate`${service.serviceName}`,
              },
            ],
            statistic: 'Maximum',
            unit: 'Percent',
          },
          scaleInCooldown: 100,
          scaleOutCooldown: 120,
        },
      },
      { parent: this, dependsOn: [service.service, loadBalancer.targetGroup] }
    );

    new aws.appautoscaling.Policy(
      `${serviceName}-scaling-policy-memory-${stack}`,
      {
        policyType: 'TargetTrackingScaling',
        resourceId: serviceScalableTarget.resourceId,
        scalableDimension: serviceScalableTarget.scalableDimension,
        serviceNamespace: serviceScalableTarget.serviceNamespace,
        targetTrackingScalingPolicyConfiguration: {
          targetValue: 70.0,
          predefinedMetricSpecification: {
            predefinedMetricType: 'ECSServiceAverageMemoryUtilization',
          },
          scaleInCooldown: 100,
          scaleOutCooldown: 300,
        },
      },
      { parent: this, dependsOn: [service.service, loadBalancer.targetGroup] }
    );
  }
}
