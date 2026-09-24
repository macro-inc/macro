import * as datadog from '@pulumi/datadog';
import * as pulumi from '@pulumi/pulumi';
import { MACRODB_PROD_MONITORS } from './monitors';

const stack = pulumi.getStack();

if (stack === 'prod') {
  for (const spec of MACRODB_PROD_MONITORS) {
    new datadog.Monitor(spec.id, {
      name: spec.name,
      type: spec.type,
      query: spec.query,
      message: spec.message,
      tags: spec.tags,
      priority: String(spec.priority),
      monitorThresholds: {
        critical: spec.thresholds.critical,
        warning: spec.thresholds.warning,
        criticalRecovery: spec.thresholds.criticalRecovery,
        warningRecovery: spec.thresholds.warningRecovery,
      },
      requireFullWindow: spec.requireFullWindow,
      evaluationDelay: spec.evaluationDelay,
      notifyNoData: spec.notifyNoData,
      noDataTimeframe: spec.noDataTimeframe,
      includeTags: true,
      newGroupDelay: 60,
      timeoutH: 0,
    });
  }
}

export const monitorCount =
  stack === 'prod' ? MACRODB_PROD_MONITORS.length : 0;
