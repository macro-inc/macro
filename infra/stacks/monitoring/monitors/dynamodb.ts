// DynamoDB consumed capacity.
//
// Adopted from monitors created by hand in the Datadog UI. Do not edit a
// monitor here and in the UI at the same time — this file wins on deploy.
import { adopted } from '../adopted';
import { notify } from '../notify';

// https://us5.datadoghq.com/monitors/16917541
adopted('dynamodb-write-capacity', {
  name: 'Dynamodb ConsumedWriteCapacityUnits High for {{tablename.name}}',
  type: 'query alert',
  query:
    'avg(last_1h):avg:aws.dynamodb.consumed_write_capacity_units{*} by {tablename} > 500',
  message: `DynamoDB table {{tablename.name}} is consuming {{value}} write capacity units.

${notify({ pages: false })}`,
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
// connection-gateway-table-prod reads normally peak around 27 units an hour
// (week to 2026-10-29) without throttling, so 10/20 fired on ordinary traffic.
adopted('dynamodb-read-capacity', {
  name: 'Dynamodb ConsumedReadCapacityUnits High for {{tablename.name}}',
  type: 'query alert',
  query:
    'avg(last_1h):avg:aws.dynamodb.consumed_read_capacity_units{*} by {tablename} > 60',
  message: `DynamoDB table {{tablename.name}} is consuming {{value}} read capacity units.

${notify({ pages: false })}`,
  monitorThresholds: {
    critical: '60',
    warning: '40',
  },
  onMissingData: 'default',
  notifyAudit: false,
  includeTags: true,
  newGroupDelay: 60,
  evaluationDelay: 900,
});
