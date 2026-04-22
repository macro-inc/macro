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

// The original parameter group we assign to the dbs
// For prod, we need to use the _legacy family config value to ensure we don't destroy the existing one while it's still needed
const parameterGroupFamily =
  stack === 'prod'
    ? config.require('parameter_group_family_legacy')
    : config.require('parameter_group_family');

const originalParameterGroup = new aws.rds.ParameterGroup(
  'parameter-group',
  {
    name: `macro-db-parameter-group-${stack}`,
    family: parameterGroupFamily,
    description: `Custom parameter group for macro-db-${stack}`,
    parameters: [
      { name: 'checkpoint_timeout', value: '900' },
      { name: 'max_wal_size', value: '16384' },
      { name: 'min_wal_size', value: '4096' },
      { name: 'vacuum_cost_page_miss', value: '10' },
      {
        name: 'shared_preload_libraries',
        value: 'pg_stat_statements,auto_explain',
        applyMethod: 'pending-reboot',
      },
      { name: 'auto_explain.log_format', value: 'json' },
      { name: 'auto_explain.log_min_duration', value: '1000' },
      { name: 'auto_explain.log_analyze', value: 'on' },
      { name: 'auto_explain.log_buffers', value: 'on' },
      { name: 'auto_explain.log_timing', value: 'off' },
      { name: 'auto_explain.log_triggers', value: 'on' },
      { name: 'auto_explain.log_verbose', value: 'on' },
      { name: 'auto_explain.log_nested_statements', value: 'on' },
      { name: 'auto_explain.sample_rate', value: '1' },
      { name: 'idle_in_transaction_session_timeout', value: '300000' },
    ],
    tags,
  },
  { protect: true }
);

// For prod, we need to create a "new" parameter group for postgres 16 family
if (stack === 'prod') {
  new aws.rds.ParameterGroup(
    'parameter-group-v16',
    {
      name: `macro-db-parameter-group-v16-${stack}`,
      family: config.require('parameter_group_family'),
      description: `Custom parameter group (${config.require('parameter_group_family')}) for macro-db-${stack}`,
      parameters: [
        { name: 'checkpoint_timeout', value: '900' },
        { name: 'max_wal_size', value: '16384' },
        { name: 'min_wal_size', value: '4096' },
        { name: 'vacuum_cost_page_miss', value: '10' },
        {
          name: 'shared_preload_libraries',
          value: 'pg_stat_statements,auto_explain',
          applyMethod: 'pending-reboot',
        },
        { name: 'auto_explain.log_format', value: 'json' },
        { name: 'auto_explain.log_min_duration', value: '1000' },
        { name: 'auto_explain.log_analyze', value: 'on' },
        { name: 'auto_explain.log_buffers', value: 'on' },
        { name: 'auto_explain.log_timing', value: 'off' },
        { name: 'auto_explain.log_triggers', value: 'on' },
        { name: 'auto_explain.log_verbose', value: 'on' },
        { name: 'auto_explain.log_nested_statements', value: 'on' },
        { name: 'auto_explain.sample_rate', value: '1' },
        { name: 'idle_in_transaction_session_timeout', value: '300000' },
      ],
      tags,
    },
    { protect: true }
  );
}

export const parameterGroupArn = originalParameterGroup.arn;

const MAINTANENCE_WINDOW = 'sun:04:00-sun:05:00'; // SUNDAY 0000 to 0100 EST

const database = new aws.rds.Instance(
  'database',
  {
    applyImmediately: stack !== 'prod',
    identifier: `macro-db-${stack}`,
    engine: 'postgres',
    engineVersion: config.require('engine_version'),
    instanceClass: config.require('instance_size'),
    storageType: config.require('storage_type'),
    iops: config.getNumber('storage_iops'), // this may be undefined to allow for default iops configuration
    storageThroughput: config.getNumber('storage_throughput'),
    allocatedStorage: config.requireNumber('allocated_storage'),
    maxAllocatedStorage: config.requireNumber('max_allocated_storage'),
    caCertIdentifier: config.require('ca_cert_identifier'),
    username: 'macrouser',
    password,
    kmsKeyId: config.require('kms_key_id'),
    monitoringInterval: config.requireNumber('monitoring_interval'),
    monitoringRoleArn: config.require('rds_monitoring_role_arn'),
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
    parameterGroupName: pulumi.interpolate`${originalParameterGroup.name}`,
    enabledCloudwatchLogsExports:
      stack === 'prod' ? ['postgresql', 'upgrade'] : undefined,
    multiAz: stack === 'prod',
    storageEncrypted: true,
    backupRetentionPeriod: config.requireNumber('backup_retention_days'),
    backupWindow: '03:00-03:30',
    maintenanceWindow: MAINTANENCE_WINDOW,
    allowMajorVersionUpgrade: true,
    tags,
  },
  { protect: true }
);

export const endpoint = database.endpoint;

// ---- Read Replica ----

const readReplica = new aws.rds.Instance(
  'read-replica',
  {
    applyImmediately: stack !== 'prod',
    identifier: `macro-db-${stack}-read-replica`,
    replicateSourceDb: database.identifier,
    instanceClass: config.require('read_replica_instance_size'),
    storageType: config.require('storage_type'),
    iops: config.getNumber('storage_iops'),
    storageThroughput: config.getNumber('storage_throughput'),
    caCertIdentifier: config.require('ca_cert_identifier'),
    kmsKeyId: config.require('kms_key_id'),
    storageEncrypted: true,
    performanceInsightsEnabled: true,
    performanceInsightsRetentionPeriod: config.requireNumber(
      'performance_insights_retention_days'
    ),
    performanceInsightsKmsKeyId: config.require(
      'performance_insights_kms_key_id'
    ),
    publiclyAccessible: true,
    vpcSecurityGroupIds: [...config.require('security_group_ids').split(',')],
    parameterGroupName: pulumi.interpolate`${originalParameterGroup.name}`,
    enabledCloudwatchLogsExports:
      stack === 'prod' ? ['postgresql', 'upgrade'] : undefined,
    skipFinalSnapshot: true,
    deletionProtection: stack === 'prod',
    maintenanceWindow: MAINTANENCE_WINDOW,
    allowMajorVersionUpgrade: true,
    tags: {
      ...tags,
      role: 'read-replica',
    },
  },
  { dependsOn: [database] }
);

export const readReplicaEndpoint = readReplica?.endpoint;
