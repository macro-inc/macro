import * as aws from '@pulumi/aws';
import { config, stack } from '../../packages/shared';

const tags = {
  environment: stack,
  tech_lead: 'hutch',
  project: 'macro-db',
};

// ---- Parameter Groups ----

const prodParameterGroup = new aws.rds.ParameterGroup(
  'macro-db-prod-custom',
  {
    name: 'macro-db-prod-custom',
    family: 'postgres14',
    description: 'Custom parameter group for macro-db-prod',
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

const devParameterGroup = new aws.rds.ParameterGroup(
  'macro-db-dev-custom',
  {
    name: 'macro-db-dev-custom',
    family: 'postgres16',
    description: 'Custom parameter group for macro-db-dev',
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

// ---- RDS Instances ----
// These are imported from existing AWS resources.
// On first `pulumi up`, use:
//   pulumi import aws:rds/instance:Instance macro-db-prod macro-db-prod
//   pulumi import aws:rds/instance:Instance macro-db-dev macro-db-dev

const password = aws.secretsmanager
  .getSecretVersionOutput({
    secretId: config.require('db_password_secret_key'),
  })
  .apply((secret) => secret.secretString);

const prodInstance = new aws.rds.Instance(
  'macro-db-prod',
  {
    identifier: 'macro-db-prod',
    engine: 'postgres',
    engineVersion: '14.17',
    instanceClass: 'db.t4g.xlarge',
    storageType: 'gp2',
    allocatedStorage: 1500,
    maxAllocatedStorage: 2000,
    username: 'macrouser',
    password,
    dbName: 'macrodb',
    dbSubnetGroupName:
      'macro-db-prod-stack-macrodbinstancesubnetgroup483984b1-ny9ca5kliq6z',
    vpcSecurityGroupIds: ['sg-0997207417c39f5b3'],
    publiclyAccessible: true,
    skipFinalSnapshot: false,
    finalSnapshotIdentifier: 'macro-db-prod-final',
    deletionProtection: true,
    parameterGroupName: prodParameterGroup.name,
    enabledCloudwatchLogsExports: ['postgresql', 'upgrade'],
    multiAz: true,
    storageEncrypted: true,
    backupRetentionPeriod: 6,
    backupWindow: '04:24-04:54',
    maintenanceWindow: 'sun:05:00-sun:05:30',
    tags,
  },
  { protect: true, import: 'macro-db-prod' }
);

const devInstance = new aws.rds.Instance(
  'macro-db-dev',
  {
    identifier: 'macro-db-dev',
    engine: 'postgres',
    engineVersion: '16.8',
    instanceClass: 'db.t4g.large',
    storageType: 'gp2',
    allocatedStorage: 50,
    maxAllocatedStorage: 100,
    username: 'macrouser',
    password,
    dbName: 'macrodb',
    dbSubnetGroupName:
      'macro-db-dev-stack-macrodbinstancesubnetgroup483984b1-io15kk1yffvr',
    vpcSecurityGroupIds: ['sg-0c947d88145e1141b'],
    publiclyAccessible: true,
    skipFinalSnapshot: true,
    deletionProtection: false,
    parameterGroupName: devParameterGroup.name,
    storageEncrypted: true,
    backupRetentionPeriod: 1,
    backupWindow: '05:00-06:00',
    maintenanceWindow: 'fri:06:15-fri:09:15',
    tags,
  },
  { protect: true, import: 'macro-db-dev' }
);

export const prodEndpoint = prodInstance.endpoint;
export const devEndpoint = devInstance.endpoint;
