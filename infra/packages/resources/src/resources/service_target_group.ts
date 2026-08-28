import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import {
  DEFAULT_DEREGISTRATION_DELAY_SECONDS,
  DEFAULT_TARGET_GROUP_HEALTH_CHECK,
} from './ecs_deployment_defaults';

type ServiceTargetGroupArgs = {
  // AWS resource tags
  tags: { [key: string]: string };
  // Listener arn
  listenerArn: pulumi.Output<string>;
  // Vpc id
  vpcId: pulumi.Output<string> | string;
  // Container port
  containerPort: number;
  // Health check
  healthCheckPath: string;
  // Path patterns. Exactly one of pathPatterns and hostHeaders must be set.
  pathPatterns?: string[];
  // Host headers to match instead of paths, for a target group that owns a
  // whole hostname on a shared listener.
  hostHeaders?: string[];
  // Priority **MUST BE UNIQUE**
  priority: number;
  // Health check
  healthCheck?: Partial<aws.types.input.lb.TargetGroupHealthCheck>;
  // Deregistration delay
  deregistrationDelay?: number;
  // Service security group id
  serviceSecurityGroupId: pulumi.Output<string>;
  // Application load balancer security group id
  albSecurityGroupId: pulumi.Output<string>;
};

/**
 * @description creates a service target group.
 */
export class ServiceTargetGroup extends pulumi.ComponentResource {
  tags: { [key: string]: string };
  public readonly target_group: aws.lb.TargetGroup;
  public readonly listener_rule: aws.lb.ListenerRule;
  constructor(
    name: string,
    args: ServiceTargetGroupArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:ServiceTargetGroup', name, {}, opts);

    this.tags = args.tags;

    if (!args.pathPatterns === !args.hostHeaders) {
      throw new Error(
        `${name}: exactly one of pathPatterns and hostHeaders must be set`
      );
    }

    this.target_group = new aws.lb.TargetGroup(
      `${name}-target-group`,
      {
        name: `${name}-tg`,
        port: args.containerPort,
        protocol: 'HTTP',
        targetType: 'ip',
        vpcId: args.vpcId,

        deregistrationDelay:
          args.deregistrationDelay ?? DEFAULT_DEREGISTRATION_DELAY_SECONDS,

        healthCheck: {
          path: args.healthCheckPath,
          protocol: 'HTTP',
          ...DEFAULT_TARGET_GROUP_HEALTH_CHECK,
          ...args.healthCheck,
        },

        tags: args.tags,
      },
      {
        parent: this,
      }
    );

    this.listener_rule = new aws.lb.ListenerRule(
      `${name}-listener-rule`,
      {
        listenerArn: args.listenerArn,
        priority: args.priority,

        conditions: [
          args.pathPatterns
            ? { pathPattern: { values: args.pathPatterns } }
            : { hostHeader: { values: args.hostHeaders ?? [] } },
        ],

        actions: [
          {
            type: 'forward',
            targetGroupArn: this.target_group.arn,
          },
        ],

        tags: args.tags,
      },
      {
        parent: this,
      }
    );

    // Update service and alb security groups to support traffic
    new aws.vpc.SecurityGroupIngressRule(
      `${name}-security-group-ingress-service-to-alb`,
      {
        securityGroupId: args.serviceSecurityGroupId,
        description: 'Allow inbound traffic from ALB',
        referencedSecurityGroupId: args.albSecurityGroupId,
        fromPort: args.containerPort,
        toPort: args.containerPort,
        ipProtocol: 'tcp',
        tags: this.tags,
      },
      { parent: this }
    );

    new aws.vpc.SecurityGroupEgressRule(
      `${name}-security-group-egress-alb-to-service`,
      {
        description: `Allow traffic to ${name}`,
        securityGroupId: args.albSecurityGroupId,
        referencedSecurityGroupId: args.serviceSecurityGroupId,
        fromPort: args.containerPort,
        ipProtocol: 'tcp',
        toPort: args.containerPort,
        tags: this.tags,
      },
      { parent: this }
    );

    this.registerOutputs({
      targetGroupArn: this.target_group.arn,
      listenerRuleArn: this.listener_rule.arn,
    });
  }
}
