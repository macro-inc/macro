import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, stack } from '../../packages/shared';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'macrodb',
};

// db password
const password = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('db_password_secret_key'),
  })
  .apply((secret) => secret.secretString);

// ---- Parameter Groups ----

const parameterGroup = new aws.rds.ParameterGroup(
  'parameter-group',
  {
    name: `macro-db-parameter-group-${stack}`,
    family: config.require('parameter_group_family'),
    description: `Custom parameter group for macro-db-${stack}`,
    parameters: [
      { name: 'checkpoint_timeout', value: '900' },
      { name: 'max_wal_size', value: '16384' },
      { name: 'min_wal_size', value: '4096' },
      { name: 'vacuum_cost_page_miss', value: '10' },
    ],
    tags,
  },
  { protect: true }
);

export const parameterGroupArn = parameterGroup.arn;

const database = new aws.rds.Instance(
  'database',
  {
    identifier: `macro-db-${stack}`,
    engine: 'postgres',
    engineVersion: config.require('engine_version'),
    instanceClass: config.require('instance_size'),
    storageType: config.require('storage_type'),
    allocatedStorage: config.requireNumber('allocated_storage'),
    maxAllocatedStorage: config.requireNumber('max_allocated_storage'),
    caCertIdentifier: config.require('ca_cert_identifier'),
    username: 'macrouser',
    password,
    kmsKeyId: config.require('kms_key_id'),
    performanceInsightsEnabled: true,
    performanceInsightsRetentionPeriod: config.requireNumber(
      'performance_insights_retention_days'
    ),
    performanceInsightsKmsKeyId: config.require(
      'performance_insights_kms_key_id'
    ),
    dbName: 'macrodb',
    dbSubnetGroupName: config.require('subnet_group_name'),
    vpcSecurityGroupIds: [...config.require('security_group_ids').split(',')],
    publiclyAccessible: true,
    skipFinalSnapshot: stack !== 'prod', // we only want to skip final snapshot for non-prod
    finalSnapshotIdentifier:
      stack === 'prod' ? `macro-db-${stack}-final` : undefined, // only final snapshot prod
    deletionProtection: stack === 'prod',
    parameterGroupName: pulumi.interpolate`${parameterGroup.name}`,
    enabledCloudwatchLogsExports:
      stack === 'prod' ? ['postgresql', 'upgrade'] : undefined,
    multiAz: stack === 'prod',
    storageEncrypted: true,
    backupRetentionPeriod: config.requireNumber('backup_retention_days'),
    backupWindow: '04:24-04:54',
    maintenanceWindow: 'sun:05:00-sun:05:30',
    tags,
  },
  { protect: true }
);

export const endpoint = database.endpoint;
