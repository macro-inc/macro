// DynamoDB consumed capacity.
//
// Adopted from monitors created by hand in the Datadog UI. Do not edit a
// monitor here and in the UI at the same time — this file wins on deploy.
import { adopted } from '../adopted';

// https://us5.datadoghq.com/monitors/16917541
adopted('dynamodb-write-capacity', {
  name: 'Dynamodb ConsumedWriteCapacityUnits High for {{tablename.name}}',
  type: 'query alert',
  query:
    'avg(last_1h):avg:aws.dynamodb.consumed_write_capacity_units{*} by {tablename} > 500',
  message: `@hutch@macro.com 
@evan@macro.com`,
  monitorThresholds: {
    critical: '500',
    warning: '300',
  },
  onMissingData: 'default',
  notifyAudit: false,
  includeTags: true,
  newGroupDelay: 60,
  evaluationDelay: 900,
});

// https://us5.datadoghq.com/monitors/16917574
adopted('dynamodb-read-capacity', {
  name: 'Dynamodb ConsumedReadCapacityUnits High for {{tablename.name}}',
  type: 'query alert',
  query:
    'avg(last_1h):avg:aws.dynamodb.consumed_read_capacity_units{*} by {tablename} > 20',
  message: `@hutch@macro.com 
@evan@macro.com`,
  monitorThresholds: {
    critical: '20',
    warning: '10',
  },
  onMissingData: 'default',
  notifyAudit: false,
  includeTags: true,
  newGroupDelay: 60,
  evaluationDelay: 900,
});
