import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';
import {
  DATADOG_API_KEY,
  datadogAgentContainer,
  fargateLogRouterSidecarContainer,
} from '../../packages/resources/src/resources/datadog';
import { DEFAULT_CONTINUE_BEFORE_STEADY_STATE } from '../../packages/resources/src/resources/ecs_deployment_defaults';
import { EcsDeploymentFailureAlarm } from '../../packages/resources/src/resources/ecs_deployment_failure_alarm';
import { EcrImage } from '../../packages/service/src/ecr';
import { config, stack } from '../../packages/shared';
import { DopplerEcsEnvironment } from '../../packages/shared/src/doppler_environment';

interface SlackImportWorkerArgs {
  ecsClusterArn: pulumi.Input<string>;
  vpc: {
    vpcId: pulumi.Input<string>;
    privateSubnetIds: pulumi.Input<string[]>;
  };
  workerPolicyArn: pulumi.Input<string>;
  stagingBucketName: pulumi.Input<string>;
  queueName: pulumi.Input<string>;
  dlqName: pulumi.Input<string>;
  gatewayUrl: pulumi.Input<string>;
  searchProcessingUrl: pulumi.Input<string>;
  tags: { [key: string]: string };
}

const SERVICE_NAME = 'slack-import-worker';

/** Opt in only after provisioning the worker's dedicated Doppler sync. */
export function deploySlackImportWorker(
  name: string,
  args: SlackImportWorkerArgs
): SlackImportWorker | undefined {
  if (!(config.getBoolean('deploy_slack_import_worker') ?? false)) {
    return undefined;
  }
  return new SlackImportWorker(name, args);
}

/** Independent, portless ECS consumer; no DSS task role or load balancer. */
export class SlackImportWorker extends pulumi.ComponentResource {
  readonly role: aws.iam.Role;
  readonly serviceSg: aws.ec2.SecurityGroup;
  readonly service: awsx.ecs.FargateService;

  constructor(
    name: string,
    args: SlackImportWorkerArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:SlackImportWorker', name, {}, opts);
    const { tags } = args;
    const child = { parent: this };
    this.role = new aws.iam.Role(
      `${name}-role`,
      {
        assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
          Service: 'ecs-tasks.amazonaws.com',
        }),
        tags,
      },
      child
    );
    const policyAttachment = new aws.iam.RolePolicyAttachment(
      `${name}-policy`,
      { role: this.role.name, policyArn: args.workerPolicyArn },
      child
    );
    this.serviceSg = new aws.ec2.SecurityGroup(
      `${name}-sg`,
      {
        vpcId: args.vpc.vpcId,
        description: 'Slack import worker egress only',
        tags,
      },
      child
    );
    const egress = new aws.vpc.SecurityGroupEgressRule(
      `${name}-egress`,
      {
        securityGroupId: this.serviceSg.id,
        cidrIpv4: '0.0.0.0/0',
        ipProtocol: '-1',
        tags,
      },
      child
    );
    const image = new EcrImage(
      `${name}-image`,
      {
        repositoryId: `${name}-ecr`,
        repositoryName: name,
        imageId: `${name}-image`,
        imagePath: '../../..',
        dockerfile: 'docker/Dockerfile',
        buildArgs: { SERVICE_NAME: 'slack_import_worker' },
        platform: { family: 'linux', architecture: 'amd64' },
        tags,
      },
      child
    );
    const doppler = new DopplerEcsEnvironment(SERVICE_NAME, { tags }, child);
    // Select keys from the shared Doppler sync instead of injecting APP_SECRETS_JSON:
    // MacroConfig gives that JSON precedence over infrastructure-owned env values.
    const secrets = [
      'DATABASE_URL',
      'INTERNAL_API_KEY',
      'SLACK_IMPORT_ENABLED',
      'SLACK_IMPORT_CONCURRENCY',
    ].map((key) => ({
      name: key,
      valueFrom: pulumi.interpolate`${doppler.containerSecrets[0].valueFrom}:${key}::`,
    }));
    this.service = new awsx.ecs.FargateService(
      SERVICE_NAME,
      {
        cluster: args.ecsClusterArn,
        desiredCount: 1,
        continueBeforeSteadyState: DEFAULT_CONTINUE_BEFORE_STEADY_STATE,
        deploymentCircuitBreaker: { enable: true, rollback: true },
        networkConfiguration: {
          subnets: args.vpc.privateSubnetIds,
          securityGroups: [this.serviceSg.id],
          assignPublicIp: false,
        },
        taskDefinitionArgs: {
          cpu: '1024',
          memory: '2048',
          taskRole: { roleArn: this.role.arn },
          executionRole: { roleArn: doppler.executionRole.arn },
          runtimePlatform: {
            operatingSystemFamily: 'LINUX',
            cpuArchitecture: 'X86_64',
          },
          containers: {
            // Hard limits leave 1536 MiB for import work and 512 MiB for telemetry.
            log_router: { ...fargateLogRouterSidecarContainer, memory: 128 },
            datadog_agent: {
              ...datadogAgentContainer,
              memory: 384,
              portMappings: [],
            },
            worker: {
              name: SERVICE_NAME,
              image: image.image.imageUri,
              essential: true,
              memory: 1536,
              stopTimeout: 120,
              secrets,
              environment: [
                { name: 'ENVIRONMENT', value: stack },
                {
                  name: 'UPLOAD_STAGING_BUCKET',
                  value: args.stagingBucketName,
                },
                { name: 'OVERRIDE_SLACK_IMPORT_QUEUE', value: args.queueName },
                { name: 'OVERRIDE_SLACK_IMPORT_DLQ', value: args.dlqName },
                {
                  name: 'OVERRIDE_CONNECTION_GATEWAY_URL',
                  value: args.gatewayUrl,
                },
                {
                  name: 'OVERRIDE_SEARCH_PROCESSING_SERVICE_URL',
                  value: args.searchProcessingUrl,
                },
                {
                  name: 'SLACK_IMPORT_JOIN_EMAIL_ENABLED',
                  value: String(
                    config.getBoolean('slack_import_join_email_enabled') ??
                      false
                  ),
                },
                { name: 'DD_SERVICE', value: SERVICE_NAME },
                { name: 'DD_ENV', value: stack },
              ],
              logConfiguration: {
                logDriver: 'awsfirelens',
                options: {
                  Name: 'datadog',
                  Host: 'http-intake.logs.us5.datadoghq.com',
                  apikey: DATADOG_API_KEY,
                  dd_service: SERVICE_NAME,
                  dd_source: 'fargate',
                  dd_tags: `env:${stack}`,
                  provider: 'ecs',
                },
              },
            },
          },
        },
        tags,
      },
      { parent: this, dependsOn: [policyAttachment, egress] }
    );
    new EcsDeploymentFailureAlarm(
      `${name}-deployment-failure-alarm`,
      { serviceName: SERVICE_NAME, serviceArn: this.service.service.arn, tags },
      child
    );
  }
}
