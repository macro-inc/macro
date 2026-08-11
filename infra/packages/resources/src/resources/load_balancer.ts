import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import type { Output } from '@pulumi/pulumi';
import {
  BASE_DOMAIN,
  CLOUD_TRAIL_SNS_TOPIC_ARN,
  MACRO_SUBDOMAIN_CERT,
  stack,
} from '../../../shared';
import {
  DEFAULT_DEREGISTRATION_DELAY_SECONDS,
  DEFAULT_TARGET_GROUP_HEALTH_CHECK,
} from './ecs_deployment_defaults';

type MacroApplicationLoadBalancerArgs = {
  // The sub domain for the application load balancer
  // This will be `${subDomain}.${BASE_DOMAIN}`
  subDomain: string;
  // AWS resource tags
  tags: { [key: string]: string };
  // If the load balancer is internal only or not
  isInternal: boolean;
  /// Vpc
  vpc: {
    vpcId: pulumi.Output<string> | string;
    publicSubnetIds: pulumi.Output<string[]> | string[];
    privateSubnetIds: pulumi.Output<string[]> | string[];
  };
  // idle timeout for connections
  idleTimeout?: number;
  // Tuning for the CloudWatch alarms. The alarms themselves are always
  // created; these only override their defaults.
  alarmOverrides?: {
    // SNS topics to notify (defaults to the CloudTrail SNS topic)
    alarmActions?: aws.cloudwatch.MetricAlarmArgs['alarmActions'];
    // Threshold for ALB-generated 5xx responses per period (default 25)
    elb5xxThreshold?: number;
    // Period in seconds for the ALB-generated 5xx alarm (default 180)
    elb5xxPeriod?: number;
  };
};

/**
 * @description creates an application load balancer component.
 */
export class MacroApplicationLoadBalancer extends pulumi.ComponentResource {
  tags: { [key: string]: string };
  loadbalancer_security_group: aws.ec2.SecurityGroup;
  load_balancer: aws.lb.LoadBalancer;
  https_listener: aws.lb.Listener;
  dns_record: aws.route53.Record;
  elb_5xx_alarm: aws.cloudwatch.MetricAlarm;
  rejected_connections_alarm: aws.cloudwatch.MetricAlarm;
  constructor(
    name: string,
    args: MacroApplicationLoadBalancerArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:MacroApplicationLoadBalancer', name, {}, opts);
    const { tags, isInternal, vpc, idleTimeout, subDomain } = args;

    this.tags = tags;

    // Create load balancer security group
    this.loadbalancer_security_group = new aws.ec2.SecurityGroup(
      'security-group',
      {
        name: `${name}-alb-sg`,
        description: `${name} application load balancer security group`,
        vpcId: vpc.vpcId,
        tags: this.tags,
      },
      { parent: this }
    );

    // Ingress rules
    new aws.vpc.SecurityGroupIngressRule(
      'security-group-ingress-http',
      {
        securityGroupId: this.loadbalancer_security_group.id,
        description: 'Allow inbound HTTP traffic',
        cidrIpv4: '0.0.0.0/0',
        fromPort: 80,
        ipProtocol: 'tcp',
        toPort: 80,
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupIngressRule(
      'security-group-ingress-https',
      {
        securityGroupId: this.loadbalancer_security_group.id,
        description: 'Allow inbound HTTPS traffic',
        cidrIpv4: '0.0.0.0/0',
        fromPort: 443,
        ipProtocol: 'tcp',
        toPort: 443,
        tags: this.tags,
      },
      { parent: this }
    );

    this.load_balancer = new aws.lb.LoadBalancer(
      'application-load-balancer',
      {
        name: `${name}-alb`,
        internal: isInternal,
        loadBalancerType: 'application', // TODO: eventually we'll want to allow this to be configurable
        securityGroups: [this.loadbalancer_security_group.id],
        subnets: isInternal ? vpc.privateSubnetIds : vpc.publicSubnetIds,
        enableDeletionProtection: false,
        // default is 60 seconds, can be up to 4000 seconds
        idleTimeout,
        tags,
        // Automatic access logs enabled for the prod (SOC2 compliance)
        accessLogs: {
          bucket: 'macro-alb-logging',
          enabled: stack === 'prod',
          prefix: `${name}-alb`,
        },
      },
      { parent: this }
    );

    this.https_listener = new aws.lb.Listener(
      'https-listener',
      {
        loadBalancerArn: this.load_balancer.arn,
        port: 443,
        protocol: 'HTTPS',
        sslPolicy: 'ELBSecurityPolicy-TLS13-1-2-2021-06',
        certificateArn: MACRO_SUBDOMAIN_CERT,
        tags,
        defaultActions: [
          {
            type: 'fixed-response',
            fixedResponse: {
              contentType: 'text/plain',
              messageBody: 'not found',
              statusCode: '404',
            },
          },
        ],
      },
      { parent: this }
    );

    new aws.lb.Listener(
      'http-listener',
      {
        loadBalancerArn: this.load_balancer.arn,
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
      { parent: this }
    );

    // domain record
    const zone = aws.route53.getZoneOutput({ name: BASE_DOMAIN });

    this.dns_record = new aws.route53.Record(
      'domain-record',
      {
        name: `${subDomain}.${BASE_DOMAIN}`,
        type: 'A',
        zoneId: zone.zoneId,
        aliases: [
          {
            evaluateTargetHealth: false,
            name: this.load_balancer.dnsName,
            zoneId: this.load_balancer.zoneId,
          },
        ],
      },
      { parent: this }
    );

    // Alarms for failures generated by the load balancer itself. These never
    // appear in any target group's metrics: a service with no healthy targets
    // produces ELB 503s, not target 5xxs. Per-service failures (target 5xx,
    // unhealthy hosts, latency) are alarmed per target group in the service
    // stacks instead.
    const alarmActions = args.alarmOverrides?.alarmActions ?? [
      CLOUD_TRAIL_SNS_TOPIC_ARN,
    ];

    // 502/503/504s generated by the ALB: no healthy targets in a matched
    // target group, targets crashing mid-request, or target response timeouts
    this.elb_5xx_alarm = new aws.cloudwatch.MetricAlarm(
      'alarm-elb-5xx',
      {
        name: `${name}-elb-5xx-alarm`,
        alarmDescription: `[${stack.toUpperCase()}]: ${name} ALB is generating 5xx responses (no healthy targets, target crashes, or target timeouts).`,
        namespace: 'AWS/ApplicationELB',
        metricName: 'HTTPCode_ELB_5XX_Count',
        statistic: 'Sum',
        period: args.alarmOverrides?.elb5xxPeriod ?? 180,
        evaluationPeriods: 1,
        threshold: args.alarmOverrides?.elb5xxThreshold ?? 25,
        comparisonOperator: 'GreaterThanOrEqualToThreshold',
        // the ALB only emits this metric when at least one 5xx occurred, so
        // missing data means healthy
        treatMissingData: 'notBreaching',
        dimensions: {
          // CloudWatch expects the arn suffix (`app/...`), not the full arn
          LoadBalancer: this.load_balancer.arnSuffix,
        },
        alarmActions,
        tags: this.tags,
      },
      { parent: this }
    );

    // Connections rejected because the ALB reached its connection limit;
    // should always be zero
    this.rejected_connections_alarm = new aws.cloudwatch.MetricAlarm(
      'alarm-rejected-connections',
      {
        name: `${name}-rejected-connections-alarm`,
        alarmDescription: `[${stack.toUpperCase()}]: ${name} ALB is rejecting connections (connection limit reached).`,
        namespace: 'AWS/ApplicationELB',
        metricName: 'RejectedConnectionCount',
        statistic: 'Sum',
        period: 300,
        evaluationPeriods: 1,
        threshold: 0,
        comparisonOperator: 'GreaterThanThreshold',
        treatMissingData: 'notBreaching',
        dimensions: {
          LoadBalancer: this.load_balancer.arnSuffix,
        },
        alarmActions,
        tags: this.tags,
      },
      { parent: this }
    );
  }
}

/**
 * Legacy service load balancer creation
 */
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
