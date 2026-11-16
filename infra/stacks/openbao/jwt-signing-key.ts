import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';

/** The only algorithm the key may sign with: ES256 is ECDSA P-256 over SHA-256. */
const SIGNING_ALGORITHM = 'ECDSA_SHA_256';

// Administration without any data-plane action or grant creation: the OpenBao
// account's root can manage the key and its alias but neither sign nor hand out
// grants, so only the statements below can mint logins.
const KEY_ADMINISTRATION_ACTIONS = [
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
];

/**
 * The asymmetric KMS key the document storage service signs its ES256 OpenBao
 * login JWTs with. It lives in the dedicated OpenBao AWS account (through
 * `openbaoAccount`); the document storage service stays in the main account
 * and signs cross-account. Its private half never leaves KMS;
 * OpenBao's JWT mounts trust its public half (README "JWT signing key"). Only
 * the document storage task role may sign, and only with ECDSA_SHA_256.
 */
export function createJwtSigningKey(args: {
  name: string;
  stack: string;
  openbaoAccount: aws.Provider;
  documentStorageRoleArn: pulumi.Output<string>;
  tags: Record<string, string>;
}) {
  const { name, stack, openbaoAccount, documentStorageRoleArn, tags } = args;
  const accountRootArn = pulumi.interpolate`arn:aws:iam::${
    aws.getCallerIdentityOutput({}, { provider: openbaoAccount }).accountId
  }:root`;
  const key = new aws.kms.Key(
    `${name}-passwords-jwt-key-${stack}`,
    {
      description: `Passwords OpenBao login JWT signing (ES256) for ${stack}`,
      customerMasterKeySpec: 'ECC_NIST_P256',
      keyUsage: 'SIGN_VERIFY',
      deletionWindowInDays: 30,
      policy: aws.iam.getPolicyDocumentOutput({
        statements: [
          {
            sid: 'AllowAccountKeyAdministration',
            effect: 'Allow',
            principals: [{ type: 'AWS', identifiers: [accountRootArn] }],
            actions: KEY_ADMINISTRATION_ACTIONS,
            resources: ['*'],
          },
          {
            sid: 'AllowDocumentStorageSign',
            effect: 'Allow',
            principals: [
              { type: 'AWS', identifiers: [documentStorageRoleArn] },
            ],
            actions: ['kms:Sign'],
            resources: ['*'],
            conditions: [
              {
                test: 'StringEquals',
                variable: 'kms:SigningAlgorithm',
                values: [SIGNING_ALGORITHM],
              },
            ],
          },
          {
            sid: 'AllowDocumentStoragePublicKey',
            effect: 'Allow',
            principals: [
              { type: 'AWS', identifiers: [documentStorageRoleArn] },
            ],
            actions: ['kms:GetPublicKey', 'kms:DescribeKey'],
            resources: ['*'],
          },
        ],
      }).json,
      tags,
    },
    // Replacing the key changes the public key every namespace trusts.
    { provider: openbaoAccount, protect: true, retainOnDelete: true }
  );
  new aws.kms.Alias(
    `${name}-passwords-jwt-key-alias-${stack}`,
    { name: `alias/passwords-jwt-${stack}`, targetKeyId: key.keyId },
    { provider: openbaoAccount }
  );

  // Cross-account use needs both halves: the key policy above, and this
  // identity policy on the document storage role in the main account
  // (default provider).
  new aws.iam.RolePolicy(`${name}-passwords-jwt-sign-${stack}`, {
    role: documentStorageRoleArn.apply((arn) => arn.split('/').slice(-1)[0]),
    policy: key.arn.apply((keyArn) =>
      JSON.stringify({
        Version: '2012-10-17',
        Statement: [
          {
            Effect: 'Allow',
            Action: 'kms:Sign',
            Resource: keyArn,
            Condition: {
              StringEquals: { 'kms:SigningAlgorithm': SIGNING_ALGORITHM },
            },
          },
          {
            Effect: 'Allow',
            Action: ['kms:GetPublicKey', 'kms:DescribeKey'],
            Resource: keyArn,
          },
        ],
      })
    ),
  });

  // Read through the deploy role, which can call GetPublicKey; the operators'
  // view-only access can't. Provisioning trusts exactly this PEM.
  const publicKeyPem = aws.kms.getPublicKeyOutput(
    { keyId: key.arn },
    { provider: openbaoAccount }
  ).publicKeyPem;

  return { key, publicKeyPem };
}
