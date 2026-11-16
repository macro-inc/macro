// convert-service's task disk. LibreOffice conversions write to the task's
// Fargate ephemeral storage, and on a full disk every conversion fails.
//
// A new monitor, not adopted. It reads the ECS Fargate integration's
// `ecs.fargate.ephemeral_storage.utilized` and `.reserved` (MiB, per
// `task_arn`) for convert-service in the prod cloud-storage cluster. Pulumi
// suffixes the ECS service's name, hence the wildcard.
//
// The service fails its health check below 2 GiB free, about 90% of the
// 20 GiB disk (`MIN_FREE_BYTES` in services/convert_service/src/disk.rs), and
// ECS replaces the task. The thresholds sit below that, so this notifies while
// conversions still succeed.
import * as datadog from '@pulumi/datadog';
import { graphGroup, prodMonitor, thresholdGraph } from '../prod-monitor';

const TASKS =
  '{ecs_cluster:cloud-storage-cluster-prod AND ecs_service:convert-service*} by {task_arn}';
const USED = `max:ecs.fargate.ephemeral_storage.utilized${TASKS}`;
const DISK_SHARE = `${USED} / max:ecs.fargate.ephemeral_storage.reserved${TASKS} * 100`;

const DISK_TITLE = 'Convert service task disk filling';

// One graph per monitor below, titled like it, with its thresholds.
const dashboard = new datadog.Dashboard('convert-service-alerts', {
  title: 'Convert service alerts',
  description:
    'Disk used by each convert-service task. Declared in infra/stacks/monitoring/monitors/convert-service.ts; see docs/runbooks/convert-service.md.',
  layoutType: 'ordered',
  widgets: [
    graphGroup('Task disk', [
      thresholdGraph({
        title: DISK_TITLE,
        query: DISK_SHARE,
        critical: '85',
        warning: '70',
      }),
      {
        timeseriesDefinition: {
          title: 'Disk used per task (MiB)',
          requests: [{ q: USED, displayType: 'line' }],
        },
      },
    ]),
  ],
});

prodMonitor('convert-service-disk', {
  title: DISK_TITLE,
  service: 'convert-service',
  query: `avg(last_15m):${DISK_SHARE} >= 85`,
  monitorThresholds: { critical: '85', warning: '70' },
  pages: false,
  description:
    'A convert-service task has used {{value}}% of its disk ({{task_arn.name}}). Conversions leave nothing behind once they end, so something is leaking. Near 90% the task fails its health check and ECS replaces it; a task that stays above that is not being replaced and fails every conversion.',
  dashboard: dashboard.url,
  runbook: 'docs/runbooks/convert-service.md#disk-filling',
});
