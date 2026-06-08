import * as aws from '@pulumi/aws';
import type * as pulumi from '@pulumi/pulumi';
import type { Output } from '@pulumi/pulumi';
import { MACRO_SUBDOMAIN_CERT, stack } from '../../../shared';
import {
  DEFAULT_DEREGISTRATION_DELAY_SECONDS,
  DEFAULT_TARGET_GROUP_HEALTH_CHECK,
} from './ecs_deployment_defaults';

export function serviceLoadBalancer(
  parent: pulumi.ComponentResource | undefined,
  {
    serviceName,
    serviceContainerPort,
    healthCheckPath,
    vpc,
    albSecurityGroupId,
    isPrivate,
    tags,
    idleTimeout,
    healthCheck,
    deregistrationDelay,
  }: {
    serviceName: string;
    serviceContainerPort: number;
    healthCheckPath: string;
    vpc: {
      vpcId: Output<any> | string;
      publicSubnetIds: Output<any> | string[];
      privateSubnetIds: Output<any> | string[];
    };
    albSecurityGroupId: Output<string> | string;
    isPrivate?: boolean;
    tags: { [key: string]: string };
    idleTimeout?: number;
    healthCheck?: Partial<aws.types.input.lb.TargetGroupHealthCheck>;
    deregistrationDelay?: number;
  }
) {
  const targetGroup = new aws.alb.TargetGroup(
    `${serviceName}-tg-${stack}`,
    {
      name: `${serviceName}-tg-${stack}`,
      deregistrationDelay:
        deregistrationDelay ?? DEFAULT_DEREGISTRATION_DELAY_SECONDS,
      port: serviceContainerPort,
      protocol: 'HTTP',
      targetType: 'ip',
      vpcId: vpc.vpcId,
      healthCheck: {
        path: healthCheckPath,
        protocol: 'HTTP',
        ...DEFAULT_TARGET_GROUP_HEALTH_CHECK,
        ...healthCheck,
      },
      tags,
    },
    { parent }
  );

  const lb = new aws.lb.LoadBalancer(
    `${serviceName}-alb-${stack}`,
    {
      name: `${serviceName}-alb-${stack}`,
      internal: isPrivate ? true : false,
      loadBalancerType: 'application',
      securityGroups: [albSecurityGroupId],
      subnets: isPrivate ? vpc.privateSubnetIds : vpc.publicSubnetIds,
      enableDeletionProtection: false,
      // default is 60 seconds, can be up to 4000 seconds
      idleTimeout,
      tags,
      accessLogs: {
        bucket: 'macro-alb-logging',
        enabled: stack === 'prod',
        prefix: `${serviceName}-${stack}`,
      },
    },
    { parent }
  );

  const listener = new aws.lb.Listener(
    `${serviceName}-lsn-${stack}`,
    {
      loadBalancerArn: lb.arn,
      port: 443,
      protocol: 'HTTPS',
      sslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06',
      certificateArn: MACRO_SUBDOMAIN_CERT,
      tags,
      defaultActions: [
        {
          type: 'forward',
          targetGroupArn: targetGroup.arn,
        },
      ],
    },
    { parent }
  );

  new aws.lb.Listener(
    `${serviceName}-httplsn-${stack}`,
    {
      loadBalancerArn: lb.arn,
      port: 80,
      protocol: 'HTTP',
      tags,
      defaultActions: [
        {
          redirect: {
            port: '443',
            statusCode: 'HTTP_301',
            protocol: 'HTTPS',
          },
          type: 'redirect',
        },
      ],
    },
    { parent }
  );

  return { targetGroup, lb, listener };
}
