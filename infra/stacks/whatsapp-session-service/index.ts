import * as pulumi from '@pulumi/pulumi';
import { config, stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { WhatsappSessionService } from './service';

const tags = {
  environment: stack,
  tech_lead: 'wolf',
  project: 'whatsapp-session-service',
};

// Config arrives through the Doppler-synced APP_SECRETS_JSON (only
// DATABASE_URL). The service derives this stack's KMS alias
// (`alias/whatsapp-session-service-<stack>`) from ENVIRONMENT; keep the two in step.

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

const service = new WhatsappSessionService(
  `whatsapp-session-service-${stack}`,
  {
    vpc: get_coparse_api_vpc(),
    ecsClusterArn: cloudStorageStack
      .getOutput('cloudStorageClusterArn')
      .apply((value) => value as string),
    ecsClusterName: cloudStorageStack
      .getOutput('cloudStorageClusterName')
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
