import * as pulumi from '@pulumi/pulumi';
import { config, stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { SlackSessionService } from './service';

const tags = {
  environment: stack,
  tech_lead: 'wolf',
  project: 'slack-session-service',
};

// Config arrives through the Doppler-synced APP_SECRETS_JSON (only
// DATABASE_URL). The service derives this stack's KMS alias
// (`alias/slack-session-service-<stack>`) from ENVIRONMENT; keep the two in step.

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

// DSS's task role, which seals pasted Slack sessions under this key.
const dssStack = new pulumi.StackReference('cloud-storage-service-stack', {
  name: `macro-inc/cloud-storage-service/${stack}`,
});

const service = new SlackSessionService(
  `slack-session-service-${stack}`,
  {
    vpc: get_coparse_api_vpc(),
    ecsClusterArn: cloudStorageStack
      .getOutput('cloudStorageClusterArn')
      .apply((value) => value as string),
    ecsClusterName: cloudStorageStack
      .getOutput('cloudStorageClusterName')
      .apply((value) => value as string),
    dssRoleArn: dssStack
      .getOutput('cloudStorageServiceRoleArn')
      .apply((value) => value as string),
    kmsDeletionWindowInDays: config.requireNumber(
      'session_kms_deletion_window_days'
    ),
    tags,
  }
);

export const sessionKmsKeyAlias = service.kmsKeyAlias;
export const sessionKmsKeyArn = service.kmsKeyArn;
export const logGroupName = service.logGroupName;
