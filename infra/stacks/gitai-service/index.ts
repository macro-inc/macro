import * as doppler from '@pulumiverse/doppler';
import * as pulumi from '@pulumi/pulumi';
import { getServiceUrl, ServiceUrl, stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';
import { createTaskRole, GitaiService } from './service';
import { GitaiStorage } from './storage';

const tags = {
  environment: stack,
  tech_lead: 'eric',
  project: 'gitai-service',
};

const cloudStorageStack = new pulumi.StackReference('cloud-storage-stack', {
  name: `macro-inc/document-storage/${stack}`,
});

const role = createTaskRole(tags);
const storage = new GitaiStorage('gitai-storage', { taskRole: role, tags });

// MacroConfig reads only Doppler (APP_SECRETS_JSON) in ECS, so the names
// infra generates reach the service through it. GITAI_SHARED_KEY and the
// optional GITHUB_TOKEN are set in Doppler by hand.
const configurationSecrets = Object.entries({
  GITAI_EVENTS_BUCKET: storage.eventsBucket.bucket,
  GITAI_SESSIONS_BUCKET: storage.sessionsBucket.bucket,
  GITAI_TABLE: storage.table.name,
}).map(
  ([key, value]) =>
    new doppler.Secret(`gitai-${key}-${stack}`, {
      project: pulumi.getProject(),
      config: stack === 'prod' ? 'prd' : 'dev',
      name: key,
      value,
    })
);

new GitaiService(`gitai-service-${stack}`, {
  role,
  vpc: get_coparse_api_vpc(),
  tags,
  ecsClusterArn: cloudStorageStack
    .getOutput('cloudStorageClusterArn')
    .apply((value) => value as string),
  ecsClusterName: cloudStorageStack
    .getOutput('cloudStorageClusterName')
    .apply((value) => value as string),
  configurationSecrets,
});

export const eventsBucketName = storage.eventsBucket.bucket;
export const sessionsBucketName = storage.sessionsBucket.bucket;
export const tableName = storage.table.name;
export const gitaiServiceUrl = getServiceUrl(ServiceUrl.GITAI_SERVICE_URL);
