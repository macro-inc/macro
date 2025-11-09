import * as aws from '@pulumi/aws';
import type { CertificateValidation } from '@pulumi/aws/acm';
import * as awsx from '@pulumi/awsx';
import type { Output } from '@pulumi/pulumi';
import * as pulumi from '@pulumi/pulumi';

type ServiceLoadBalancerArgs = {
  stack: string;
  serviceName: string;
  servicePort: number;
  vpc: {
    vpcId: Output<string> | string;
    publicSubnetIds: Output<string[]> | string[];
    privateSubnetIds: Output<string[]> | string[];
  };
  securityGroups: {
    serviceAlbSg: aws.ec2.SecurityGroup;
    serviceSg: aws.ec2.SecurityGroup;
  };
  healthCheckPath: string;
  idleTimeout: number;
  certificateValidation: CertificateValidation;
};

type ServiceAutoScalingArgs = {
  stack: string;
  serviceName: string;
  clusterName: Output<string>;
  fargateServiceName: Output<string>;
  minCapacity: number;
  maxCapacity: number;
};

export function serviceLoadBalancer({
  stack,
  serviceName,
  servicePort,
  vpc,
  securityGroups,
  healthCheckPath,
  idleTimeout,
  certificateValidation,
}: ServiceLoadBalancerArgs) {
  const serviceTargetGroup = new aws.alb.TargetGroup(
    `${serviceName}-tg-${stack}`,
    {
      name: `${serviceName}-tg-${stack}`,
      port: servicePort,
      protocol: 'HTTP',
      targetType: 'ip',
      vpcId: vpc.vpcId,
      healthCheck: {
        path: healthCheckPath,
        protocol: 'HTTP',
      },
    }
  );

  const serviceLB = new awsx.lb.ApplicationLoadBalancer(
    `${serviceName}-alb-${stack}`,
    {
      accessLogs: {
        bucket: 'macro-alb-logging',
        enabled: stack === 'prod',
        prefix: `${serviceName}-${stack}`,
      },
      internal: true,
      subnetIds: vpc.privateSubnetIds,
      securityGroups: [securityGroups.serviceAlbSg.id],
      idleTimeout,
      listener: {
        port: 443,
        protocol: 'HTTPS',
        certificateArn: certificateValidation.certificateArn,
        defaultActions: [
          {
            type: 'forward',
            targetGroupArn: serviceTargetGroup.arn,
          },
        ],
        sslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06',
      },
    }
  );
  return { serviceLB, serviceTargetGroup };
}

export function serviceAutoScaling({
  stack,
  serviceName,
  clusterName,
  fargateServiceName,
  minCapacity,
  maxCapacity,
}: ServiceAutoScalingArgs) {
  // Create a scalable target for the Fargate service to attach the scaling policies.
  const serviceScalableTarget = new aws.appautoscaling.Target(
    `macro-${serviceName}-service-scalable-target-${stack}`,
    {
      maxCapacity,
      minCapacity,
      resourceId: pulumi.interpolate`service/${clusterName}/${fargateServiceName}`,
      scalableDimension: 'ecs:service:DesiredCount',
      serviceNamespace: 'ecs',
    }
  );

  // Create an Auto Scaling policy for CPU utilization.
  new aws.appautoscaling.Policy(
    `macro-${serviceName}-scaling-policy-cpu-${stack}`,
    {
      policyType: 'TargetTrackingScaling',
      resourceId: serviceScalableTarget.resourceId,
      scalableDimension: serviceScalableTarget.scalableDimension,
      serviceNamespace: serviceScalableTarget.serviceNamespace,
      targetTrackingScalingPolicyConfiguration: {
        targetValue: 70.0,
        predefinedMetricSpecification: {
          predefinedMetricType: 'ECSServiceAverageCPUUtilization',
        },
        scaleInCooldown: 100,
        scaleOutCooldown: 300,
      },
    }
  );

  new aws.appautoscaling.Policy(
    `macro-${serviceName}-scaling-policy-memory-${stack}`,
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
    }
  );
}
