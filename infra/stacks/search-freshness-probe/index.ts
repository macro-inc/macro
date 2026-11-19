import * as pulumi from '@pulumi/pulumi';
import { stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { SearchFreshnessProbe } from './service';

const tags = {
  environment: stack,
  tech_lead: 'teo',
  project: 'search-freshness-probe',
};

// Config arrives through the Doppler-synced APP_SECRETS_JSON (only
// PROBE_USER_API_KEY). The gateway it calls follows ENVIRONMENT.

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

const probe = new SearchFreshnessProbe(`search-freshness-probe-${stack}`, {
  vpc: get_coparse_api_vpc(),
  ecsClusterArn: cloudStorageStack
    .getOutput('cloudStorageClusterArn')
    .apply((value) => value as string),
  tags,
});

export const logGroupName = probe.logGroupName;
