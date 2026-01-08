import * as aws from '@pulumi/aws';
import type * as pulumi from '@pulumi/pulumi';
import type { Output } from '@pulumi/pulumi';
import { MACRO_SUBDOMAIN_CERT, stack } from './shared';

export function serviceLoadBalancer(
  parent: pulumi.ComponentResource,
  {
    serviceName,
    serviceContainerPort,
    healthCheckPath,
    vpc,
    albSecurityGroupId,
    isPrivate,
    tags,
    idleTimeout,
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
  }
) {
  const targetGroup = new aws.alb.TargetGroup(
    `${serviceName}-tg-${stack}`,
    {
      name: `${serviceName}-tg-${stack}`,
      deregistrationDelay: 120,
      port: serviceContainerPort,
      protocol: 'HTTP',
      targetType: 'ip',
      vpcId: vpc.vpcId,
      healthCheck: {
        path: healthCheckPath,
        protocol: 'HTTP',
        interval: 60,
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
      enableDeletionProtection: stack === 'prod',
      // default is 60 seconds, can be up to 4000 seconds
      idleTimeout,
      accessLogs: {
        bucket: 'macro-alb-logging',
        enabled: stack === 'prod',
        prefix: `${serviceName}-${stack}`,
      },
      tags,
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
