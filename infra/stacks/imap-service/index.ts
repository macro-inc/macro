import * as pulumi from '@pulumi/pulumi';
import { config, stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { ImapService } from './service';

const tags = {
  environment: stack,
  tech_lead: 'wolf',
  project: 'imap-service',
};

// Doppler provides DATABASE_URL, INTERNAL_AUTH_KEY and IMAP_CREDENTIAL_KMS_KEY_ID.
// The credential key must be this stack's dedicated alias.

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

const service = new ImapService(`imap-service-${stack}`, {
  // These subnets must route through dedicated, approved mail NAT addresses.
  // Keep bootstrap_pending until the network and Doppler values are ready.
  vpc: {
    ...get_coparse_api_vpc(),
    privateSubnetIds: config.requireObject<string[]>('mail_private_subnet_ids'),
  },
  ecsClusterArn: cloudStorageStack
    .getOutput('cloudStorageClusterArn')
    .apply((value) => value as string),
  ecsClusterName: cloudStorageStack
    .getOutput('cloudStorageClusterName')
    .apply((value) => value as string),
  kmsDeletionWindowInDays: config.requireNumber(
    'credential_kms_deletion_window_days'
  ),
  tags,
});

export const credentialKmsKeyAlias = service.kmsKeyAlias;
export const credentialKmsKeyArn = service.kmsKeyArn;
export const logGroupName = service.logGroupName;
