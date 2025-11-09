import * as aws from '@pulumi/aws';
import type { Output } from '@pulumi/pulumi';
import { stack } from './shared';

type SecurityGroupArgs = {
  serviceName: string;
  vpcId: Output<string> | string;
  serviceContainerPort: number;
};

export function securityGroups({
  serviceName,
  vpcId,
  serviceContainerPort,
}: SecurityGroupArgs) {
  // Application Load Balancer SG
  const serviceAlbSg = new aws.ec2.SecurityGroup(
    `${serviceName}-alb-sg-${stack}`,
    {
      name: `${serviceName}-alb-sg-${stack}`,
      description: `${serviceName} application load balancer security group`,
      vpcId,
    }
  );
  const serviceSg = new aws.ec2.SecurityGroup(`${serviceName}-sg-${stack}`, {
    name: `${serviceName}-sg-${stack}`,
    vpcId,
    description: `${serviceName} security group that is attached directly to the service`,
  });
  // Service SG rules
  new aws.vpc.SecurityGroupIngressRule(`${serviceName}-alb-in-${stack}`, {
    securityGroupId: serviceSg.id,
    description: 'Allow inbound traffic from the services ALB',
    referencedSecurityGroupId: serviceAlbSg.id,
    fromPort: serviceContainerPort,
    toPort: serviceContainerPort,
    ipProtocol: 'tcp',
  });
  new aws.vpc.SecurityGroupEgressRule(`${serviceName}-all-out-${stack}`, {
    securityGroupId: serviceSg.id,
    description: 'Allow all outbound',
    cidrIpv4: '0.0.0.0/0',
    ipProtocol: '-1',
  });
  // ALB SG rules
  new aws.vpc.SecurityGroupIngressRule(`${serviceName}-http-${stack}`, {
    securityGroupId: serviceAlbSg.id,
    description: 'Allow inbound HTTP traffic',
    cidrIpv4: '0.0.0.0/0',
    fromPort: 80,
    ipProtocol: 'tcp',
    toPort: 80,
  });
  new aws.vpc.SecurityGroupIngressRule(`${serviceName}-https-${stack}`, {
    securityGroupId: serviceAlbSg.id,
    description: 'Allow inbound HTTPS traffic',
    cidrIpv4: '0.0.0.0/0',
    fromPort: 443,
    ipProtocol: 'tcp',
    toPort: 443,
  });
  new aws.vpc.SecurityGroupEgressRule(`${serviceName}-out-service-${stack}`, {
    description: 'Allow traffic to the service security group',
    securityGroupId: serviceAlbSg.id,
    referencedSecurityGroupId: serviceSg.id,
    fromPort: serviceContainerPort,
    ipProtocol: 'tcp',
    toPort: serviceContainerPort,
  });

  return { serviceAlbSg, serviceSg };
}
