import * as pulumi from '@pulumi/pulumi';
import { config, stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { WhatsappSessionService } from './service';

const tags = {
  environment: stack,
  tech_lead: 'wolf',
  project: 'whatsapp-session-service',
};

// Config (DATABASE_URL, WHATSAPP_SESSION_LOCK_DATABASE_URL,
// WHATSAPP_SESSION_KMS_KEY_ID, ...) arrives through the Doppler-synced
// APP_SECRETS_JSON; see AGENTS.md for the key list.

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
    desiredCount: config.requireNumber('desired_count'),
    kmsDeletionWindowInDays: config.requireNumber(
      'session_kms_deletion_window_days'
    ),
    tags,
  }
);

/** Set WHATSAPP_SESSION_KMS_KEY_ID in this service's Doppler config to this. */
export const sessionKmsKeyAlias = service.kmsKeyAlias;
export const sessionKmsKeyArn = service.kmsKeyArn;
export const logGroupName = service.logGroupName;
