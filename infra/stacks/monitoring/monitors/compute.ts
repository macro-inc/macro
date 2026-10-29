// ECS and Lambda.
//
// Adopted from monitors created by hand in the Datadog UI. Do not edit a
// monitor here and in the UI at the same time — this file wins on deploy.
import { adopted } from '../adopted';
import { notify } from '../notify';

// https://us5.datadoghq.com/monitors/1062688
// Average per task, not the sum over a family's tasks: the sum crossed the old
// 400/500 thresholds whenever a service scaled out. Per-task averages peaked
// around 50% over the 3 days to 2026-10-29.
adopted('ecs-high-cpu', {
  name: '[PROD] High cpu usage across ECS Clusters',
  type: 'query alert',
  query:
    'avg(last_5m):avg:ecs.fargate.cpu.percent{(ecs_cluster:macro-cluster-prod OR ecs_cluster:cloud-storage-cluster-prod OR ecs_cluster:macroai-cluster-prod-4cbe721)} by {task_name} > 90',
  message: `{{task_name.name}} is experiencing high cpu usage in ECS

${notify({ pages: false })}`,
  monitorThresholds: {
    critical: '90',
    warning: '80',
  },
  onMissingData: 'show_no_data',
  notifyAudit: false,
  includeTags: false,
  newGroupDelay: 0,
});

// https://us5.datadoghq.com/monitors/1065393
adopted('lambda-error-count', {
  name: '[PROD] Lambda Increased Error Count',
  type: 'query alert',
  query:
    'sum(last_1h):sum:aws.lambda.errors{(level:prod OR environment:prod ) AND NOT functionname:ws-api-gateway-authorizer-lambda-prod} by {functionname}.as_rate() > 500',
  message: `Lambda {{functionname.name}} is failing at {{value}} errors per second.

${notify({ pages: true })}`,
  monitorThresholds: {
    critical: '500',
    warning: '100',
  },
  onMissingData: 'show_no_data',
  notifyAudit: false,
  includeTags: true,
  newGroupDelay: 60,
  evaluationDelay: 900,
});

// https://us5.datadoghq.com/monitors/1291765
adopted('document-text-extractor-prod', {
  name: '[PROD] Document Text Extractor Failing',
  type: 'query alert',
  query:
    'sum(last_4h):(sum:aws.lambda.errors{resource:document-text-extractor-prod}.as_count() / sum:aws.lambda.invocations{resource:document-text-extractor-prod}.as_count()) * 100 > 80',
  message: `Document text extractor failing: {{value}}% of invocations errored over 4 hours.

${notify({ pages: false })}`,
  monitorThresholds: {
    critical: '80',
    warning: '50',
  },
  onMissingData: 'default',
  notifyAudit: false,
  includeTags: false,
  newHostDelay: 300,
  evaluationDelay: 900,
});

// https://us5.datadoghq.com/monitors/1291772
adopted('document-text-extractor-dev', {
  name: '[DEV] Document Text Extractor Failing',
  type: 'query alert',
  query:
    'sum(last_4h):(sum:aws.lambda.errors{resource:document-text-extractor-dev}.as_count() / sum:aws.lambda.invocations{resource:document-text-extractor-dev}.as_count()) * 100 > 80',
  message: `Document text extractor failing: {{value}}% of invocations errored over 4 hours.

${notify({ pages: false, environment: 'dev' })}`,
  monitorThresholds: {
    critical: '80',
    warning: '50',
  },
  onMissingData: 'default',
  notifyAudit: false,
  includeTags: false,
  newHostDelay: 300,
  evaluationDelay: 900,
});
