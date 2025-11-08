import * as pulumi from '@pulumi/pulumi';
import { config, stack } from './resources/shared';
import { get_coparse_api_vpc } from './resources/vpc';
import * as aws from '@pulumi/aws';
import { Database } from './database';
import { FusionAuthService } from './fusionauth-service';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'fusion-auth',
};

const vpc = get_coparse_api_vpc();

// IMPORTANT: never export this variable. it contains sensitive information.
const password = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('db-password-secret-key'),
  })
  .apply(secret => secret.secretString);

const database = new Database('fusionauth-db', {
  publiclyAccessible: stack !== 'prod', // We keep the database publicly accessible in dev to make sure everything is working.
  dbArgs: {
    dbName: 'fusionauth',
    instanceClass: stack === 'prod' ? 'db.t4g.large' : 'db.t4g.micro',
    allocatedStorage: stack === 'prod' ? 50 : 20,
    password,
  },
  vpc,
  tags,
});

export const fusionAuthDatabaseEndpoint =
  stack !== 'prod' ? database.endpoint : 'fusionauthdb-prod.macro.com';

// Due to a very silly storage encryption oversight, we hard code the db url in prod to be `fusionauthdb-prod.macro.com`
let DATABASE_URL: pulumi.Output<string> | string = '';
if (stack === 'prod') {
  DATABASE_URL = 'jdbc:postgresql://fusionauthdb-prod.macro.com/fusionauth';
} else {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  DATABASE_URL = database.endpoint!.apply(
    endpoint => `jdbc:postgresql://${endpoint}/fusionauth`,
  );
}

// ---- ECS Cluster ----
const cluster = new aws.ecs.Cluster(`fusionauth-${stack}`, {
  name: `fusionauth-${stack}`,
  settings: [{ name: 'containerInsights', value: 'enabled' }],
  tags,
});

export const fusionAuthClusterName = cluster.name;
export const fusionAuthClusterArn = cluster.arn;
export const fusionAuthClusterId = cluster.id;

const service = new FusionAuthService('fusionauth-service', {
  tags,
  clusterArn: fusionAuthClusterArn,
  clusterName: fusionAuthClusterName,
  vpc,
  platform: {
    family: 'linux',
    architecture: 'amd64',
  },
  serviceContainerPort: 9011,
  isPrivate: false,
  healthCheckPath: '/api/status',
  containerEnvVars: [
    // NOTE: FUSIONAUTH_APP_URL is set in the service itself
    {
      name: 'DATABASE_URL',
      value: pulumi.interpolate`${DATABASE_URL}`,
    },
    {
      name: 'DATABASE_ROOT_USERNAME',
      value: 'macrouser',
    },
    {
      name: 'DATABASE_ROOT_PASSWORD',
      value: password,
    },
    {
      name: 'DATABASE_USERNAME',
      value: 'macrouser',
    },
    {
      name: 'DATABASE_PASSWORD',
      value: password,
    },
    {
      name: 'FUSIONAUTH_APP_MEMORY',
      value: stack === 'prod' ? '3072M' : '3072M', // half of the available memory
    },
    {
      name: 'FUSIONAUTH_APP_RUNTIME_MODE',
      value: stack === 'prod' ? 'production' : 'development',
    },
    {
      name: 'FUSIONAUTH_APP_SLENT_MODE',
      value: 'true',
    },
  ],
});

export const fusionAuthServiceUrl = pulumi.interpolate`${service.domain}`;
