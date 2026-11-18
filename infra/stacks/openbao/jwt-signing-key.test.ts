import { beforeAll, describe, expect, mock, test } from 'bun:test';
import * as pulumi from '@pulumi/pulumi';

const resources: pulumi.runtime.MockResourceArgs[] = [];
let publicKeyPem: pulumi.Output<string>;
const OPENBAO_ACCOUNT = '169344408001';
const DEPLOY_ROLE = `arn:aws:iam::${OPENBAO_ACCOUNT}:role/openbao-deploy/openbao-deploy-dev`;
const DSS_ROLE =
  'arn:aws:iam::569036502058:role/cloud-storage-service-role-dev';
const KEY_ARN = `arn:aws:kms:us-east-1:${OPENBAO_ACCOUNT}:key/synthetic`;

beforeAll(async () => {
  pulumi.runtime.setAllConfig({
    'aws:region': 'us-east-1',
    'openbao:deployRoleArn': DEPLOY_ROLE,
  });
  pulumi.runtime.setMocks(
    {
      newResource(args) {
        resources.push(args);
        return {
          id: args.name,
          state: {
            ...args.inputs,
            arn: args.type === 'aws:kms/key:Key' ? KEY_ARN : undefined,
            keyId: args.type === 'aws:kms/key:Key' ? 'synthetic' : undefined,
          },
        };
      },
      call(args) {
        if (args.token === 'aws:index/getCallerIdentity:getCallerIdentity') {
          return { accountId: OPENBAO_ACCOUNT };
        }
        if (args.token === 'aws:kms/getPublicKey:getPublicKey') {
          return { publicKeyPem: `synthetic PEM for ${args.inputs.keyId}` };
        }
        if (args.token === 'aws:iam/getPolicyDocument:getPolicyDocument') {
          return { json: JSON.stringify(args.inputs.statements) };
        }
        return args.inputs;
      },
    },
    'openbao',
    'dev',
    false
  );
  // Avoid the shared barrel's pre-existing ESM cycle; only `stack` is read.
  mock.module('../../packages/shared', () => ({ stack: 'dev' }));
  const { openbaoAccount } = await import('./account');
  const { createJwtSigningKey } = await import('./jwt-signing-key');
  ({ publicKeyPem } = createJwtSigningKey({
    name: 'openbao',
    stack: 'dev',
    openbaoAccount,
    documentStorageRoleArn: pulumi.output(DSS_ROLE),
    tags: {},
  }));
  await pulumi.runtime.waitForRPCs();
});

function only(type: string): pulumi.runtime.MockResourceArgs {
  const matches = resources.filter((resource) => resource.type === type);
  expect(matches).toHaveLength(1);
  return matches[0];
}

async function resolved<Value>(value: pulumi.Input<Value>): Promise<Value> {
  return new Promise((resolve) => pulumi.output(value).apply(resolve));
}

describe('Passwords JWT signing key', () => {
  test('is an ECC P-256 signing key, created in the OpenBao account through the deploy role', () => {
    // Provider inputs reach the mock JSON-encoded.
    const provider = only('pulumi:providers:aws');
    expect(JSON.parse(provider.inputs.allowedAccountIds)).toEqual([
      OPENBAO_ACCOUNT,
    ]);
    expect(JSON.parse(provider.inputs.assumeRoles)).toEqual([
      { roleArn: DEPLOY_ROLE, sessionName: 'pulumi-openbao-dev' },
    ]);
    expect(JSON.parse(provider.inputs.defaultTags)).toEqual({
      tags: { 'openbao:env': 'dev' },
    });

    const key = only('aws:kms/key:Key');
    expect(key.inputs.customerMasterKeySpec).toBe('ECC_NIST_P256');
    expect(key.inputs.keyUsage).toBe('SIGN_VERIFY');
    expect(key.provider).toContain('pulumi:providers:aws::openbao-account-dev');

    const alias = only('aws:kms/alias:Alias');
    expect(alias.inputs.name).toBe('alias/passwords-jwt-dev');
    expect(alias.provider).toContain(
      'pulumi:providers:aws::openbao-account-dev'
    );
  });

  test('lets only the DSS role sign, only with ECDSA_SHA_256, and the account root only administer', async () => {
    const policy = JSON.parse(
      await resolved(only('aws:kms/key:Key').inputs.policy as string)
    );
    expect(policy).toEqual([
      {
        sid: 'AllowAccountKeyAdministration',
        effect: 'Allow',
        principals: [
          {
            type: 'AWS',
            identifiers: [`arn:aws:iam::${OPENBAO_ACCOUNT}:root`],
          },
        ],
        actions: [
          'kms:CancelKeyDeletion',
          'kms:CreateAlias',
          'kms:DeleteAlias',
          'kms:Describe*',
          'kms:Disable*',
          'kms:Enable*',
          'kms:Get*',
          'kms:List*',
          'kms:Put*',
          'kms:RevokeGrant',
          'kms:ScheduleKeyDeletion',
          'kms:TagResource',
          'kms:UntagResource',
          'kms:UpdateAlias',
          'kms:UpdateKeyDescription',
        ],
        resources: ['*'],
      },
      {
        sid: 'AllowDocumentStorageSign',
        effect: 'Allow',
        principals: [{ type: 'AWS', identifiers: [DSS_ROLE] }],
        actions: ['kms:Sign'],
        resources: ['*'],
        conditions: [
          {
            test: 'StringEquals',
            variable: 'kms:SigningAlgorithm',
            values: ['ECDSA_SHA_256'],
          },
        ],
      },
      {
        sid: 'AllowDocumentStoragePublicKey',
        effect: 'Allow',
        principals: [{ type: 'AWS', identifiers: [DSS_ROLE] }],
        actions: ['kms:GetPublicKey', 'kms:DescribeKey'],
        resources: ['*'],
      },
    ]);
  });

  test('never lets the account root sign or create grants', async () => {
    const [administration] = JSON.parse(
      await resolved(only('aws:kms/key:Key').inputs.policy as string)
    );
    for (const action of [
      'kms:Sign',
      'kms:CreateGrant',
      'kms:*',
      'kms:Create*',
    ]) {
      expect(administration.actions).not.toContain(action);
    }
  });

  test('exposes the public key read through the OpenBao account', async () => {
    expect(await resolved(publicKeyPem)).toBe(`synthetic PEM for ${KEY_ARN}`);
  });

  test('adds the matching statement to the DSS role in the main account', async () => {
    const rolePolicy = only('aws:iam/rolePolicy:RolePolicy');
    expect(rolePolicy.provider ?? '').not.toContain('openbao-account');
    expect(await resolved(rolePolicy.inputs.role)).toBe(
      'cloud-storage-service-role-dev'
    );
    expect(
      JSON.parse(await resolved(rolePolicy.inputs.policy as string))
    ).toEqual({
      Version: '2012-10-17',
      Statement: [
        {
          Effect: 'Allow',
          Action: 'kms:Sign',
          Resource: KEY_ARN,
          Condition: {
            StringEquals: { 'kms:SigningAlgorithm': 'ECDSA_SHA_256' },
          },
        },
        {
          Effect: 'Allow',
          Action: ['kms:GetPublicKey', 'kms:DescribeKey'],
          Resource: KEY_ARN,
        },
      ],
    });
  });
});
