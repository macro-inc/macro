import * as aws from '@pulumi/aws';
import type * as pulumi from '@pulumi/pulumi';
import { MACRO_SUBDOMAIN_CERT, stack } from './shared';

export function createApplicationLoadBalancer(
  parent: pulumi.ComponentResource,
  {
    name,
    vpc,
    albSecurityGroupId,
    healthCheckPath,
    serviceContainerPort,
    isPrivate,
    tags,
  }: {
    name: string;
    vpc: {
      vpcId: pulumi.Output<any> | string;
      publicSubnetIds: pulumi.Output<any> | string[];
      privateSubnetIds: pulumi.Output<any> | string[];
    };
    albSecurityGroupId: pulumi.Output<string> | string;
    healthCheckPath: string;
    serviceContainerPort: number;
    isPrivate: boolean;
    tags: { [key: string]: string };
  }
) {
  const targetGroup = new aws.alb.TargetGroup(
    `${name}-tg-${stack}`,
    {
      name: `${name}-tg-${stack}`,
      deregistrationDelay: 60,
      port: serviceContainerPort,
      protocol: 'HTTP',
      targetType: 'ip',
      vpcId: vpc.vpcId,
      healthCheck: {
        path: healthCheckPath,
        protocol: 'HTTP',
      },
      tags,
    },
    { parent }
  );

  const lb = new aws.lb.LoadBalancer(
    `${name}-alb-${stack}`,
    {
      name: `${name}-alb-${stack}`,
      internal: isPrivate ? true : false,
      loadBalancerType: 'application',
      securityGroups: [albSecurityGroupId],
      subnets: isPrivate ? vpc.privateSubnetIds : vpc.publicSubnetIds,
      enableDeletionProtection: false,
      accessLogs: {
        bucket: 'macro-alb-logging',
        enabled: stack === 'prod',
        prefix: `${name}-${stack}`,
      },
      tags,
    },
    { parent }
  );

  const listener = new aws.lb.Listener(
    `${name}-lsn-${stack}`,
    {
      loadBalancerArn: lb.arn,
      port: 443,
      protocol: 'HTTPS',
      sslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06',
      certificateArn: MACRO_SUBDOMAIN_CERT,
      defaultActions: [
        {
          type: 'forward',
          targetGroupArn: targetGroup.arn,
        },
      ],
      tags,
    },
    { parent }
  );

  new aws.lb.Listener(
    `${name}-httplsn-${stack}`,
    {
      loadBalancerArn: lb.arn,
      port: 80,
      protocol: 'HTTP',
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
      tags,
    },
    { parent }
  );

  return { targetGroup, lb, listener };
}
