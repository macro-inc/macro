import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';
import {
  DATADOG_API_KEY,
  DEFAULT_CONTINUE_BEFORE_STEADY_STATE,
  EcsDeploymentFailureAlarm,
  withTelemetry,
} from '../../packages/resources';
import { EcrImage } from '../../packages/service';
import {
  DopplerEcsEnvironment,
  grafanaTelemetryEnabled,
  stack,
} from '../../packages/shared';

const BASE_NAME = pulumi.getProject();
const REPO_ROOT = '../../..';

// Prod stays off until its probe user is ready: then set this, and
// PROBE_RUNS_IN_PROD in infra/stacks/monitoring/monitors/search-freshness.ts.
const RUNS_IN_PROD = false;

// Shutdown waits for a write in progress (a crowded-prefix round deletes,
// creates and makes private, each up to 10 s, and may purge), then deletes
// what the probe created (a project takes two requests), so 60 s can be short.
const STOP_TIMEOUT_SECONDS = 90;

type SearchFreshnessProbeArgs = {
  vpc: {
    vpcId: pulumi.Input<string>;
    privateSubnetIds: pulumi.Input<string[]>;
  };
  ecsClusterArn: pulumi.Input<string>;
  tags: { [key: string]: string };
};

/**
 * Acts as the probe user through the public gateway every minute and records
 * how long search takes to show each change. Nothing calls it, so it has no
 * load balancer, target group, or inbound rule, and its task role holds no
 * AWS permissions: everything it does goes through Macro's API.
 */
export class SearchFreshnessProbe extends pulumi.ComponentResource {
  readonly role: aws.iam.Role;
  readonly serviceSg: aws.ec2.SecurityGroup;
  readonly service: awsx.ecs.FargateService;
  readonly logGroupName: pulumi.Output<string>;

  constructor(
    name: string,
    args: SearchFreshnessProbeArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:SearchFreshnessProbe', name, {}, opts);
    const { tags } = args;
    const child = { parent: this };

    this.role = new aws.iam.Role(
      `${BASE_NAME}-role`,
      {
        name: `${BASE_NAME}-role-${stack}`,
        assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
          Service: 'ecs-tasks.amazonaws.com',
        }),
        tags,
      },
      child
    );

    this.serviceSg = new aws.ec2.SecurityGroup(
      `${BASE_NAME}-sg-${stack}`,
      {
        name: `${BASE_NAME}-sg-${stack}`,
        vpcId: args.vpc.vpcId,
        description: 'Search freshness probe: egress only',
        tags,
      },
      child
    );
    // The gateway, Secrets Manager, ECR and the Datadog intake are all HTTPS.
    // DNS and the Fargate metadata endpoints are not filtered by security
    // groups.
    const httpsEgress = new aws.vpc.SecurityGroupEgressRule(
      `${BASE_NAME}-https-out`,
      {
        securityGroupId: this.serviceSg.id,
        description: 'HTTPS to the gateway, AWS APIs, and Datadog',
        cidrIpv4: '0.0.0.0/0',
        ipProtocol: 'tcp',
        fromPort: 443,
        toPort: 443,
        tags,
      },
      child
    );

    // The FireLens router's own diagnostics; application logs ship to Datadog.
    const logGroup = new aws.cloudwatch.LogGroup(
      `${BASE_NAME}-log-group`,
      {
        name: `/ecs/${BASE_NAME}-${stack}`,
        retentionInDays: 30,
        tags,
      },
      child
    );
    this.logGroupName = logGroup.name;

    const image = new EcrImage(
      `${BASE_NAME}-ecr-image-${stack}`,
      {
        repositoryId: `${BASE_NAME}-ecr-${stack}`,
        repositoryName: `${BASE_NAME}-${stack}`,
        imageId: `${BASE_NAME}-image-${stack}`,
        imagePath: REPO_ROOT,
        dockerfile: 'docker/Dockerfile',
        platform: { family: 'linux', architecture: 'amd64' },
        buildArgs: { SERVICE_NAME: 'search_freshness_probe' },
        tags,
      },
      child
    );

    const dopplerEcsEnvironment = new DopplerEcsEnvironment(
      BASE_NAME,
      { tags },
      child
    );

    this.service = new awsx.ecs.FargateService(
      BASE_NAME,
      {
        cluster: args.ecsClusterArn,
        desiredCount: stack === 'prod' && !RUNS_IN_PROD ? 0 : 1,
        // Stop the old task before starting the new one: two probes renaming
        // the same fixture would each see the other's title and count a miss.
        deploymentMinimumHealthyPercent: 0,
        deploymentMaximumPercent: 100,
        continueBeforeSteadyState: DEFAULT_CONTINUE_BEFORE_STEADY_STATE,
        deploymentCircuitBreaker: { enable: true, rollback: true },
        networkConfiguration: {
          subnets: args.vpc.privateSubnetIds,
          securityGroups: [this.serviceSg.id],
          assignPublicIp: false,
        },
        taskDefinitionArgs: {
          cpu: '256',
          // Dev adds the Alloy sidecar, whose limit alone is 512 MB.
          memory: grafanaTelemetryEnabled ? '1024' : '512',
          taskRole: { roleArn: this.role.arn },
          executionRole: { roleArn: dopplerEcsEnvironment.executionRole.arn },
          runtimePlatform: {
            operatingSystemFamily: 'LINUX',
            cpuArchitecture: 'X86_64',
          },
          containers: withTelemetry(
            BASE_NAME,
            {
              service: {
                name: 'service',
                image: image.image.imageUri,
                essential: true,
                stopTimeout: STOP_TIMEOUT_SECONDS,
                // Stopping runs in reverse dependency order, so the sidecars
                // outlive the clean-up and its logs and spans still ship.
                dependsOn: [
                  { containerName: 'log_router', condition: 'START' },
                  { containerName: 'datadog_agent', condition: 'START' },
                ],
                secrets: [...dopplerEcsEnvironment.containerSecrets],
                environment: [
                  { name: 'ENVIRONMENT', value: stack },
                  { name: 'DD_SERVICE', value: BASE_NAME },
                  { name: 'DD_ENV', value: stack },
                  { name: 'RUST_BACKTRACE', value: '1' },
                ],
                // `GET /health` on 8080 is for a local check; the image has
                // no HTTP client for an ECS container health check.
                portMappings: [{ containerPort: 8080, hostPort: 8080 }],
                logConfiguration: {
                  logDriver: 'awsfirelens',
                  options: {
                    Name: 'datadog',
                    Host: 'http-intake.logs.us5.datadoghq.com',
                    // Egress allows only 443; Fluent Bit defaults to plain 80.
                    TLS: 'on',
                    Port: '443',
                    apikey: DATADOG_API_KEY,
                    dd_service: BASE_NAME,
                    dd_source: 'fargate',
                    dd_tags: `env:${stack}`,
                    provider: 'ecs',
                  },
                },
              },
            },
            {
              logRouter: {
                stopTimeout: STOP_TIMEOUT_SECONDS,
                logConfiguration: {
                  logDriver: 'awslogs',
                  options: {
                    'awslogs-group': logGroup.name,
                    'awslogs-region': 'us-east-1',
                    'awslogs-stream-prefix': 'log_router',
                  },
                },
              },
              datadogAgent: { stopTimeout: STOP_TIMEOUT_SECONDS },
            }
          ),
        },
        tags,
      },
      { parent: this, dependsOn: [httpsEgress] }
    );

    new EcsDeploymentFailureAlarm(
      `${BASE_NAME}-deployment-failure-alarm`,
      {
        serviceName: BASE_NAME,
        serviceArn: this.service.service.arn,
        tags,
      },
      child
    );
  }
}
