import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';
import {
  DATADOG_API_KEY,
  datadogAgentContainer,
  fargateLogRouterSidecarContainer,
} from '@resources/datadog';
import { stack } from '@shared';
import { COPARSE_API_VPC } from '@vpc';
import { cloudStorageClusterArn } from './cluster';
import type { ServiceLoadBalancer } from './load_balancer';

function envVars(env: Record<string, pulumi.Input<string>>) {
  const keys = Object.keys(env);
  keys.sort();
  return keys.map((key) => ({
    name: key,
    value: env[key],
  }));
}

export class Service extends pulumi.ComponentResource {
  public readonly service: awsx.ecs.FargateService;
  public readonly serviceName: pulumi.Output<string>;
  public readonly role: aws.iam.Role;

  constructor(
    serviceName: string,
    args: {
      loadBalancer: ServiceLoadBalancer;
      iamPolicies: aws.iam.Policy[];
      imageRef: pulumi.Input<string>;
      environment?: Record<string, pulumi.Input<string>>;

      /** if true, the service will not have a datadog agent or log router sidecar */
      noDatadog?: boolean;
      vpc?: {
        vpcId: string;
        publicSubnetIds: string[];
        privateSubnetIds: string[];
      };
      ecsClusterArn?: string;
      sidecarContainers?: Record<
        string,
        awsx.types.input.ecs.TaskDefinitionContainerDefinitionArgs
      >;
      tags: Record<string, string>;
    },
    opts?: pulumi.ComponentResourceOptions
  ) {
    super(
      `macro:cloud_storage:Service`,
      `${serviceName}-service-${stack}`,
      args,
      opts
    );
    const { loadBalancer, iamPolicies } = args;
    const vpc = args.vpc ?? COPARSE_API_VPC;

    this.role = new aws.iam.Role(
      `${serviceName}-role-${stack}`,
      {
        assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
          Service: 'ecs-tasks.amazonaws.com',
        }),
        managedPolicyArns: iamPolicies.map((policy) => policy.arn),
        tags: args.tags,
      },
      { parent: this }
    );

    this.service = new awsx.ecs.FargateService(
      serviceName,
      {
        cluster: args.ecsClusterArn ?? cloudStorageClusterArn,
        networkConfiguration: {
          subnets: vpc.privateSubnetIds,
          securityGroups: [loadBalancer.serviceSgId],
        },
        deploymentCircuitBreaker: {
          enable: true,
          rollback: true,
        },
        taskDefinitionArgs: {
          taskRole: {
            roleArn: this.role.arn,
          },
          containers: {
            ...args.sidecarContainers,
            ...(args.noDatadog
              ? {}
              : {
                  datadog_agent: datadogAgentContainer,
                  log_router: fargateLogRouterSidecarContainer,
                }),
            service: {
              name: serviceName,
              image: args.imageRef,
              cpu: 1024,
              memory: 512,
              environment: args.environment
                ? envVars(args.environment)
                : undefined,
              logConfiguration: args.noDatadog
                ? undefined
                : {
                    logDriver: 'awsfirelens',
                    options: {
                      Name: 'datadog',
                      Host: 'http-intake.logs.us5.datadoghq.com',
                      apikey: DATADOG_API_KEY,
                      dd_service: `${serviceName}-${stack}`,
                      dd_source: 'fargate',
                      dd_tags: `project:${serviceName}`,
                      provider: 'ecs',
                    },
                  },
              portMappings: [loadBalancer.portMapping()],
            },
          },
        },
      },
      {
        parent: this,
        dependsOn: [
          loadBalancer,
          loadBalancer.targetGroup,
          ...args.iamPolicies,
        ],
      }
    );

    this.serviceName = this.service.service.name;
    this.registerOutputs({
      name: this.service.service.name,
    });
  }
}
