import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { stack } from '@shared';
import { get_coparse_api_vpc } from '@vpc';

// Path to worker trigger lambda as if we are in the stack package
const HANDLER_BASE = '../../../';
const ZIP_LOCATION = `${HANDLER_BASE}/target/lambda/worker-trigger/bootstrap.zip`;

const coparse_api_vpc = get_coparse_api_vpc();

export type CreateWorkerTriggerArgs = {
  clusterArn: pulumi.Output<string> | string;
  taskDefinitionArn: pulumi.Output<string> | string;
  tags: { [key: string]: string };
};

export class WorkerTrigger extends pulumi.ComponentResource {
  // The role of the lambda
  role: aws.iam.Role;
  // The trigger lambda function
  lambda: aws.lambda.Function;

  constructor(
    name: string,
    { clusterArn, taskDefinitionArn, tags }: CreateWorkerTriggerArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:WorkerTrigger', name, {}, opts);

    const lambdaEnvVars = {
      TASK_DEFINITION: pulumi.interpolate`${taskDefinitionArn}`,
      CLUSTER: pulumi.interpolate`${clusterArn}`,
      SUBNETS: coparse_api_vpc.privateSubnetIds.join(','),
      ENVIRONMENT: stack,
      RUST_LOG: 'worker_trigger=info',
    };

    const ecsAccessPolicy = new aws.iam.Policy(
      `${name}-ecs-policy`,
      {
        policy: pulumi.output({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Action: ['ecs:RunTask'],
              Resource: [taskDefinitionArn, pulumi.interpolate`${clusterArn}`],
            },
            {
              Effect: 'Allow',
              Action: ['iam:PassRole'],
              Resource: ['*'],
              Condition: {
                StringEquals: {
                  'iam:PassedToService': 'ecs-tasks.amazonaws.com',
                },
              },
            },
          ],
        }),
        tags,
      },
      { parent: this }
    );

    this.role = new aws.iam.Role(
      `${name}-role-${stack}`,
      {
        name: `${name}-role-${stack}`,
        assumeRolePolicy: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Action: 'sts:AssumeRole',
              Effect: 'Allow',
              Principal: {
                Service: 'lambda.amazonaws.com',
              },
            },
          ],
        }),
        managedPolicyArns: [
          aws.iam.ManagedPolicies.AWSLambdaBasicExecutionRole,
          aws.iam.ManagedPolicies.AWSLambdaRole,
          ecsAccessPolicy.arn,
        ],
        tags,
      },
      { parent: this }
    );

    this.lambda = new aws.lambda.Function(
      `${name}-${stack}`,
      {
        code: new pulumi.asset.FileArchive(ZIP_LOCATION),
        name: `${name}-${stack}`,
        handler: 'bootstrap',
        runtime: 'provided.al2023',
        architectures: ['x86_64'],
        role: this.role.arn,
        environment: {
          variables: lambdaEnvVars,
        },
        tags,
      },
      {
        parent: this,
        dependsOn: [this.role],
      }
    );
  }
}
