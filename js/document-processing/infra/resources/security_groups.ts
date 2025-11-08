import * as aws from '@pulumi/aws';
import type { ComponentResource } from '@pulumi/pulumi';
import type * as pulumi from '@pulumi/pulumi';
import { stack } from './shared';

export function createServiceSecurityGroups(
  parent: ComponentResource,
  {
    name,
    vpcId,
    serviceContainerPort,
    tags,
  }: {
    name: string;
    vpcId: pulumi.Output<any> | string;
    serviceContainerPort: number;
    tags: { [key: string]: string };
  }
) {
  // Application Load Balancer SG
  const serviceAlbSg = new aws.ec2.SecurityGroup(
    `${name}-alb-sg-${stack}`,
    {
      name: `${name}-alb-sg-${stack}`,
      description: `${name} application load balancer security group`,
      vpcId,
      tags,
    },
    { parent }
  );

  const serviceSg = new aws.ec2.SecurityGroup(
    `${name}-sg-${stack}`,
    {
      name: `${name}-sg-${stack}`,
      vpcId,
      description: `${name} security group that is attached directly to the service`,
      tags,
    },
    { parent }
  );

  // Service SG rules
  new aws.vpc.SecurityGroupIngressRule(
    `${name}-alb-in-${stack}`,
    {
      securityGroupId: serviceSg.id,
      description: 'Allow inbound traffic from the services ALB',
      referencedSecurityGroupId: serviceAlbSg.id,
      fromPort: serviceContainerPort,
      toPort: serviceContainerPort,
      ipProtocol: 'tcp',
      tags,
    },
    { parent }
  );
  new aws.vpc.SecurityGroupEgressRule(
    `${name}-all-out-${stack}`,
    {
      securityGroupId: serviceSg.id,
      description: 'Allow all outbound',
      cidrIpv4: '0.0.0.0/0',
      ipProtocol: '-1',
      tags,
    },
    { parent }
  );

  // ALB SG rules
  new aws.vpc.SecurityGroupIngressRule(
    `${name}-http-${stack}`,
    {
      securityGroupId: serviceAlbSg.id,
      description: 'Allow inbound HTTP traffic',
      cidrIpv4: '0.0.0.0/0',
      fromPort: 80,
      ipProtocol: 'tcp',
      toPort: 80,
      tags,
    },
    { parent }
  );

  new aws.vpc.SecurityGroupIngressRule(
    `${name}-https-${stack}`,
    {
      securityGroupId: serviceAlbSg.id,
      description: 'Allow inbound HTTPS traffic',
      cidrIpv4: '0.0.0.0/0',
      fromPort: 443,
      ipProtocol: 'tcp',
      toPort: 443,
      tags,
    },
    { parent }
  );

  new aws.vpc.SecurityGroupEgressRule(
    `${name}-out-service-${stack}`,
    {
      description: 'Allow traffic to the service security group',
      securityGroupId: serviceAlbSg.id,
      referencedSecurityGroupId: serviceSg.id,
      fromPort: serviceContainerPort,
      ipProtocol: 'tcp',
      toPort: serviceContainerPort,
      tags,
    },
    { parent }
  );

  return { serviceAlbSg, serviceSg };
}
