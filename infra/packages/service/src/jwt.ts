import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { stack } from '@shared';

const JWT_SECRET_KEY = `fusionauth-jwt-secret-${stack}`;
export const ISSUER =
  stack === 'prod' ? 'auth.macro.com' : 'fusionauth-dev.macro.com';
export const AUDIENCE =
  stack === 'prod'
    ? '75409999-7dc4-4241-b73b-a51818c3a71c'
    : 'eb75fe7a-0ef1-4186-96d9-cc62cfb1d10c';

export class JwtSecretKeyIamPolicy extends pulumi.ComponentResource {
  public readonly policy: aws.iam.Policy;
  public readonly jwtSecretKeyArn: pulumi.Output<string>;

  constructor(
    serviceName: string,
    args: {
      tags: Record<string, string>;
    },
    opts?: pulumi.ComponentResourceOptions
  ) {
    super(
      `macro:cloud_storage:JwtSecretKeyIamPolicy`,
      `${serviceName}-jwt-secret-key-iam-policy`,
      args,
      opts
    );

    const jwtSecretKeyArn: pulumi.Output<string> = aws.secretsmanager
      .getSecretOutput({ name: JWT_SECRET_KEY })
      .apply((secret) => secret.arn);

    this.policy = new aws.iam.Policy(
      `${serviceName}-jwt-secret-key-iam-policy`,
      {
        name: `${serviceName}-jwt-secret-key-iam-policy-${stack}`,
        policy: {
          Version: '2012-10-17',
          Statement: [
            {
              Action: [
                'secretsmanager:GetSecretValue',
                'secretsmanager:DescribeSecret',
              ],
              Resource: [jwtSecretKeyArn],
              Effect: 'Allow',
            },
          ],
        },
        tags: args.tags,
      },
      { parent: this }
    );

    this.jwtSecretKeyArn = jwtSecretKeyArn;
    this.registerOutputs({
      jwtSecretKeyArn,
    });
  }
}
