import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

// Account-wide provider, owned only by the prod observability stack.
export function createCiTelemetryRole(secretArn: string) {
  const provider = new aws.iam.OpenIdConnectProvider(
    'github-actions',
    {
      url: 'https://token.actions.githubusercontent.com',
      clientIdLists: ['sts.amazonaws.com'],
    },
    { protect: true }
  );
  const role = new aws.iam.Role('observability-ci', {
    name: 'macro-observability-ci',
    assumeRolePolicy: provider.arn.apply((arn) =>
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Principal: { Federated: arn },
            Action: 'sts:AssumeRoleWithWebIdentity',
            Condition: {
              StringEquals: {
                'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
                'token.actions.githubusercontent.com:sub':
                  'repo:macro-inc/macro:ref:refs/heads/main',
              },
            },
          },
        ],
      })
    ),
  });
  new aws.iam.RolePolicy('observability-ci-ingest', {
    role: role.id,
    policy: pulumi.jsonStringify({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: 'secretsmanager:GetSecretValue',
          Resource: secretArn,
        },
      ],
    }),
  });
  return role.arn;
}
