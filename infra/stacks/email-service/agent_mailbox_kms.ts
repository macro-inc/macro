import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import * as doppler from '@pulumiverse/doppler';

/** Must match `ENCRYPTION_PURPOSE` in `crates/agent_mailbox/src/outbound/kms.rs`. */
const AGENT_MAILBOX_KMS_PURPOSE = 'agent-mailbox-key';
const AGENT_MAILBOX_KMS_ACTIONS = ['kms:Encrypt', 'kms:Decrypt'];

/**
 * The KMS key email_service encrypts agent mailboxes' scoped provider keys
 * with, usable by the service role only for that purpose. MacroConfig reads
 * only Doppler in ECS, so the key reaches the service as
 * `AGENT_MAILBOX_KMS_KEY_ID` in Doppler rather than the container env.
 */
export function agentMailboxKms({
  role,
  stack,
  tags,
}: {
  role: aws.iam.Role;
  stack: string;
  tags: Record<string, string>;
}) {
  const accountRootArn = pulumi.interpolate`arn:aws:iam::${aws.getCallerIdentityOutput().accountId}:root`;
  const purposeCondition = {
    test: 'StringEquals',
    variable: 'kms:EncryptionContext:macro:purpose',
    values: [AGENT_MAILBOX_KMS_PURPOSE],
  };
  const key = new aws.kms.Key(
    'email-service-agent-mailbox-key',
    {
      description: 'Encrypts agent mailboxes scoped provider keys',
      enableKeyRotation: true,
      deletionWindowInDays: stack === 'prod' ? 30 : 7,
      policy: aws.iam.getPolicyDocumentOutput({
        statements: [
          {
            sid: 'AllowAccountKeyAdministration',
            effect: 'Allow',
            principals: [{ type: 'AWS', identifiers: [accountRootArn] }],
            actions: [
              'kms:CancelKeyDeletion',
              'kms:Create*',
              'kms:Delete*',
              'kms:Describe*',
              'kms:Disable*',
              'kms:Enable*',
              'kms:Get*',
              'kms:List*',
              'kms:Put*',
              'kms:Revoke*',
              'kms:ScheduleKeyDeletion',
              'kms:TagResource',
              'kms:UntagResource',
              'kms:Update*',
            ],
            resources: ['*'],
          },
          {
            sid: 'AllowAgentMailboxKeyEncryption',
            effect: 'Allow',
            principals: [{ type: 'AWS', identifiers: [role.arn] }],
            actions: AGENT_MAILBOX_KMS_ACTIONS,
            resources: ['*'],
            conditions: [purposeCondition],
          },
        ],
      }).json,
      tags,
    },
    { protect: stack === 'prod' }
  );
  const alias = new aws.kms.Alias('email-service-agent-mailbox-key-alias', {
    name: `alias/email-service-agent-mailbox-${stack}`,
    targetKeyId: key.keyId,
  });
  new aws.iam.RolePolicy('email-service-agent-mailbox-kms-policy', {
    role: role.id,
    policy: {
      Version: '2012-10-17',
      Statement: [
        {
          Action: AGENT_MAILBOX_KMS_ACTIONS,
          Resource: key.arn,
          Effect: 'Allow',
          Condition: {
            StringEquals: {
              'kms:EncryptionContext:macro:purpose': AGENT_MAILBOX_KMS_PURPOSE,
            },
          },
        },
      ],
    },
  });
  new doppler.Secret(`email-service-AGENT_MAILBOX_KMS_KEY_ID-${stack}`, {
    project: 'email-service',
    config: stack === 'prod' ? 'prd' : 'dev',
    name: 'AGENT_MAILBOX_KMS_KEY_ID',
    value: alias.name,
  });
}
