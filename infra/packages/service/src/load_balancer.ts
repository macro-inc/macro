// NOTE: this is an amalgamation of the load balancer and security groups that are effectively always created together

import * as aws from '@pulumi/aws';
import type * as awsx from '@pulumi/awsx';
import type { Input, Output } from '@pulumi/pulumi';
import * as pulumi from '@pulumi/pulumi';
import { serviceLoadBalancer as createServiceLoadBalancer } from '@resources/load_balancer';
import { stack } from '@shared';
import { COPARSE_API_VPC } from '@vpc';

export class ServiceLoadBalancer extends pulumi.ComponentResource {
  public readonly serviceSg: aws.ec2.SecurityGroup;
  public readonly loadBalancer: aws.lb.LoadBalancer;
  public readonly targetGroup: aws.alb.TargetGroup;
  public readonly listener: aws.lb.Listener;

  public readonly serviceSgId: Output<string>;
  public readonly loadBalancerArn: Output<string>;
  public readonly serviceName: string;
  public readonly port: number;

  constructor(
    serviceName: string,
    args: {
      containerPort: number;
      /**
       * The path to use for the health check, defaults to `/health`
       */
      healthCheckPath?: string;
      /**
       * The VPC to create the load balancer in
       * If not provided, the load balancer will be created in the Coparse API VPC
       */
      vpc?: {
        vpcId: string;
        publicSubnetIds: Input<string[]>;
        privateSubnetIds: Input<string[]>;
      };
      isPrivate?: boolean;
      tags?: Record<string, string>;
      idleTimeout?: number;
    },
    opts?: pulumi.ComponentResourceOptions
  ) {
    super(
      'macro:cloud_storage:ServiceWithLoadBalancer',
      `${serviceName}-service-load-balancer-${stack}`,
      args,
      opts
    );

    const { containerPort: port, isPrivate, tags, idleTimeout } = args;
    this.serviceName = serviceName;
    const healthCheckPath = args.healthCheckPath ?? '/health';

    const vpc = args.vpc ?? COPARSE_API_VPC;
    const vpcId = vpc.vpcId;

    const serviceAlbSg = new aws.ec2.SecurityGroup(
      `${serviceName}-alb-sg-${stack}`,
      {
        name: `${serviceName}-alb-sg-${stack}`,
        description: `${serviceName} application load balancer security group`,
        vpcId,
        tags,
      },
      { parent: this }
    );

    const serviceSg = new aws.ec2.SecurityGroup(
      `${serviceName}-sg-${stack}`,
      {
        name: `${serviceName}-sg-${stack}`,
        vpcId,
        description: `${serviceName} security group that is attached directly to the service`,
        tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupIngressRule(
      `${serviceName}-alb-in`,
      {
        securityGroupId: serviceSg.id,
        description: 'Allow inbound traffic from the services ALB',
        referencedSecurityGroupId: serviceAlbSg.id,
        fromPort: port,
        toPort: port,
        ipProtocol: 'tcp',
        tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupEgressRule(
      `${serviceName}-all-out`,
      {
        securityGroupId: serviceSg.id,
        description: 'Allow all outbound',
        cidrIpv4: '0.0.0.0/0',
        ipProtocol: '-1',
        tags,
      },
      { parent: this }
    );

    // ALB SG rules
    new aws.vpc.SecurityGroupIngressRule(
      `${serviceName}-http`,
      {
        securityGroupId: serviceAlbSg.id,
        description: 'Allow inbound HTTP traffic',
        cidrIpv4: '0.0.0.0/0',
        fromPort: 80,
        ipProtocol: 'tcp',
        toPort: 80,
        tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupIngressRule(
      `${serviceName}-https`,
      {
        securityGroupId: serviceAlbSg.id,
        description: 'Allow inbound HTTPS traffic',
        cidrIpv4: '0.0.0.0/0',
        fromPort: 443,
        ipProtocol: 'tcp',
        toPort: 443,
        tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupEgressRule(
      `${serviceName}-out-service`,
      {
        description: 'Allow traffic to the service security group',
        securityGroupId: serviceAlbSg.id,
        referencedSecurityGroupId: serviceSg.id,
        fromPort: port,
        ipProtocol: 'tcp',
        toPort: port,
        tags,
      },
      { parent: this }
    );

    const { lb, targetGroup, listener } = createServiceLoadBalancer(this, {
      serviceName,
      serviceContainerPort: port,
      healthCheckPath,
      vpc: pulumi.output(vpc),
      albSecurityGroupId: serviceAlbSg.id,
      isPrivate,
      tags: tags || {},
      idleTimeout,
    });

    this.serviceSg = serviceSg;
    this.loadBalancer = lb;
    this.targetGroup = targetGroup;
    this.listener = listener;

    this.serviceSgId = serviceSg.id;
    this.loadBalancerArn = lb.arn;
    this.port = port;
    this.registerOutputs({
      serviceSgId: serviceSg.id,
      loadBalancerArn: lb.arn,
    });
  }

  public portMapping(): awsx.types.input.ecs.TaskDefinitionPortMappingArgs {
    return {
      appProtocol: 'http',
      name: `${this.serviceName}-http-${stack}`,
      containerPort: this.port,
      hostPort: this.port,
      targetGroup: this.targetGroup,
    };
  }
}
