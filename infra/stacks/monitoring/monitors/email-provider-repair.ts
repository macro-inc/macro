// Contract: validation_deferred means a failed validation; validation_blocked
// is an hourly heartbeat after eight definite constraint violations. The stream
// metric counts verified mismatch classifications, not all inconsistent rows.
// No mailbox/provider/cursor dimensions. Code only, never deployed on merge.
import * as datadog from '@pulumi/datadog';
import { graphGroup, prodMonitor, thresholdGraph } from '../prod-monitor';

const signals = [
  {
    name: 'email-reconciliation-provider-validation-deferred',
    metric: 'macro.email.provider_repair.validation_deferred',
    filter: '@backfill.outcome:validation_deferred',
    title: 'Email reconciliation provider validation deferred',
    description:
      'Mailbox-work FK validation failed in the last two hours. Inspect the durable scan/completion marker and lock or statement deadlines. Transient failures keep retrying with backoff up to one hour and never consume the constraint cap. Do not reset the cursor or run an unbounded UPDATE.',
  },
  {
    name: 'email-reconciliation-provider-validation-blocked',
    metric: 'macro.email.provider_repair.validation_blocked',
    filter: '@backfill.outcome:validation_blocked',
    title: 'Email reconciliation provider validation blocked',
    description:
      'Eight definite FK violations capped validation. No further table scan is attempted; an hourly heartbeat keeps this alarm active while constraints remain unvalidated. Inspect the constraint failure count and validation target; resolve the inconsistent-row cause before an authorized recovery. Lock, statement, deadlock and serialization failures do not consume this cap.',
  },
  {
    name: 'email-reconciliation-provider-stream-mismatch',
    metric: 'macro.email.provider_repair.stream_mismatch',
    filter: '@backfill.stream_provider_mismatch_count:1',
    title: 'Email mailbox stream provider mismatch',
    description:
      'A stream FK validation proved an inconsistent legacy provider row. This counts classifications, not distinct bad rows; retries may encounter the same row. Reconciliation repair cannot repair stream metadata. The constraint cap and persistent blocked alarm prevent silent endless validation.',
  },
] as const;

for (const signal of signals) {
  new datadog.SpansMetric(signal.metric, {
    name: signal.metric,
    compute: { aggregationType: 'count' },
    filter: {
      query: `resource_name:email.reconciliation.provider_backfill ${signal.filter}`,
    },
    groupBies: [{ path: 'env', tagName: 'env' }],
  });
}

const dashboard = new datadog.Dashboard('email-provider-repair', {
  title: 'Email reconciliation provider repair',
  description:
    'Automatic resumable rollout maintenance. Failed attempts, verified stream mismatch classifications and hourly capped-state heartbeats; no user dimensions or inferred remaining-row counts.',
  layoutType: 'ordered',
  widgets: [
    graphGroup(
      'Validation state',
      signals.map((signal) =>
        thresholdGraph({
          title: signal.title,
          query: `sum:${signal.metric}{env:prod}.as_count()`,
          critical: '1',
        })
      )
    ),
  ],
});

for (const signal of signals) {
  prodMonitor(signal.name, {
    title: signal.title,
    service: 'email-service',
    query: `sum(last_2h):sum:${signal.metric}{env:prod}.as_count() >= 1`,
    monitorThresholds: { critical: '1' },
    pages: false,
    description: `${signal.description} A two-hour alert window can outlast recovery.`,
    dashboard: dashboard.url,
    runbook: 'docs/runbooks/email-provider-repair.md',
  });
}
