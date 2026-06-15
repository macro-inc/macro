import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { stack } from '.';

export type DopplerEcsEnvironmentArgs = {
  // Resource tags
  tags: { [key: string]: string };
};

export class DopplerEcsEnvironment extends pulumi.ComponentResource {
  public containerSecrets: {
    name: string;
    valueFrom: pulumi.Output<string> | string;
  }[];
  public executionRole: aws.iam.Role;

  constructor(
    name: string,
    { tags }: DopplerEcsEnvironmentArgs,
    opts?: pulumi.ComponentResourceOptions
  ) {
    super('my:components:DopplerEcsEnvironment', name, {}, opts);
    const dopplerSecretKey = `/doppler/${name}/${stack}`;
    const dopplerSecretSyncArn: pulumi.Output<string> = aws.secretsmanager
      .getSecretVersionOutput({
        secretId: dopplerSecretKey,
      })
      .apply((secret) => secret.arn);

    const executionSecretsPolicy = new aws.iam.Policy(
      `${name}-execution-secrets-policy`,
      {
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: ['secretsmanager:GetSecretValue'],
              Resource: pulumi.interpolate`${dopplerSecretSyncArn}`,
              Effect: 'Allow',
            },
          ],
        },
        tags,
      },
      { parent: this }
    );

    const ecsTaskAssumeRolePolicy = aws.iam.assumeRolePolicyForPrincipal({
      Service: 'ecs-tasks.amazonaws.com',
    });

    this.executionRole = new aws.iam.Role(
      `${name}-execution-role`,
      {
        assumeRolePolicy: ecsTaskAssumeRolePolicy,
        tags,
        managedPolicyArns: [
          'arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy',
          executionSecretsPolicy.arn,
        ],
      },
      { parent: this }
    );

    this.containerSecrets = [
      {
        name: 'APP_SECRETS_JSON',
        valueFrom: pulumi.interpolate`${dopplerSecretSyncArn}`,
      },
    ];
  }
}
