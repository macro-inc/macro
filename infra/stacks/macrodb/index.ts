import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { config, RDS_PORT, stack } from '../../packages/shared';
import { get_coparse_api_vpc } from '../../packages/vpc';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'macrodb',
};

const databaseSecurityGroupIds = config
  .require('security_group_ids')
  .split(',')
  .map((securityGroupId) => securityGroupId.trim())
  .filter(Boolean);

const datadogDbmEnabled = config.getBoolean('datadog_dbm_enabled') ?? false;

const datadogDbmAgentSecurityGroup = datadogDbmEnabled
  ? new aws.ec2.SecurityGroup('datadog-dbm-agent-security-group', {
      name: `datadog-dbm-agent-${stack}`,
      description: `Datadog DBM agent security group for macro-db-${stack}`,
      vpcId: get_coparse_api_vpc().vpcId,
      tags: {
        ...tags,
        component: 'datadog-dbm-agent',
      },
    })
  : undefined;

if (datadogDbmAgentSecurityGroup) {
  new aws.vpc.SecurityGroupEgressRule('datadog-dbm-agent-all-out', {
    securityGroupId: datadogDbmAgentSecurityGroup.id,
    description: 'Allow outbound traffic for the Datadog DBM agent',
    cidrIpv4: '0.0.0.0/0',
    ipProtocol: '-1',
    tags,
  });

  new aws.vpc.SecurityGroupIngressRule('datadog-dbm-agent-postgres-in', {
    securityGroupId: datadogDbmAgentSecurityGroup.id,
    description: 'Allow Postgres between resources using the Datadog DBM group',
    referencedSecurityGroupId: datadogDbmAgentSecurityGroup.id,
    fromPort: RDS_PORT,
    toPort: RDS_PORT,
    ipProtocol: 'tcp',
    tags,
  });

  databaseSecurityGroupIds.forEach((databaseSecurityGroupId, index) => {
    new aws.vpc.SecurityGroupEgressRule(
      `datadog-dbm-agent-postgres-out-${index}`,
      {
        securityGroupId: datadogDbmAgentSecurityGroup.id,
        description: 'Allow the Datadog DBM agent to connect to Postgres',
        referencedSecurityGroupId: databaseSecurityGroupId,
        fromPort: RDS_PORT,
        toPort: RDS_PORT,
        ipProtocol: 'tcp',
        tags,
      }
    );

    new aws.vpc.SecurityGroupIngressRule(
      `database-datadog-dbm-agent-in-${index}`,
      {
        securityGroupId: databaseSecurityGroupId,
        description: 'Allow the Datadog DBM agent to connect to Postgres',
        referencedSecurityGroupId: datadogDbmAgentSecurityGroup.id,
        fromPort: RDS_PORT,
        toPort: RDS_PORT,
        ipProtocol: 'tcp',
        tags,
      }
    );
  });
}

export const datadogDbmAgentSecurityGroupId = datadogDbmAgentSecurityGroup?.id;

const databaseVpcSecurityGroupIds = datadogDbmAgentSecurityGroup
  ? [...databaseSecurityGroupIds, datadogDbmAgentSecurityGroup.id]
  : databaseSecurityGroupIds;

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
      // Tune planner costs and prefetch for gp3 SSD.
      { name: 'random_page_cost', value: '1.1' },
      { name: 'effective_io_concurrency', value: '256' },
      // Reduce sort/hash disk spills; 16MB sized for the smallest (8GiB dev) instance.
      { name: 'work_mem', value: '16384' },
      // Avoid JIT startup cost for one-off dynamic Soup queries.
      { name: 'jit', value: '0' },
      // Log spills of at least 10MB for follow-up tuning.
      { name: 'log_temp_files', value: '10240' },
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
        // Tune planner costs and prefetch for gp3 SSD.
        { name: 'random_page_cost', value: '1.1' },
        { name: 'effective_io_concurrency', value: '256' },
        // Reduce sort/hash disk spills; 16MB sized for the smallest (8GiB dev) instance.
        { name: 'work_mem', value: '16384' },
        // Avoid JIT startup cost for one-off dynamic Soup queries.
        { name: 'jit', value: '0' },
        // Log spills of at least 10MB for follow-up tuning.
        { name: 'log_temp_files', value: '10240' },
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
    vpcSecurityGroupIds: databaseVpcSecurityGroupIds,
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
    vpcSecurityGroupIds: databaseVpcSecurityGroupIds,
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
