import { describe, expect, test } from 'bun:test';
import {
  compactAlert,
  firstSentences,
  renderPost,
  statusPost,
} from '../src/format';

// A real Datadog monitor message and Grafana alert details, as GoAlert
// forwards them in `Details`.
const DATADOG_DETAILS = `https://us5.datadoghq.com/event/event?id=8876996053944573810

🔴 CRITICAL: 2631.578 (threshold 1800.0)

The oldest open transaction on macro-db-prod.ctkwyjgndnfr.us-east-1.rds.amazonaws.com is 2631.578 seconds old. Long transactions hold locks and stop vacuum.

Runbook: https://github.com/macro-inc/macro/blob/main/docs/runbooks/macrodb.md#locks
Dashboard: https://us5.datadoghq.com/dashboard/42x-f55-h6z/macrodb-alerts

@webhook-goalert-notify

\`avg(last_10m):max:postgresql.activity.xact_start_age{host:macro-db-prod*} by {host} > 1800\`

Metric value: 2631.578

Metric Graph: https://us5.datadoghq.com/monitors/23404621?group=host · Monitor Status: https://us5.datadoghq.com/monitors/23404621`;

const GRAFANA_DETAILS = `| Label | Value |
| ----- | ----- |
| DBInstanceIdentifier | macro-db-prod-read-replica |
| alertname | [PROD] macro-db-prod database load above vCPU count (warning) |
| pages | false |
| severity | warning |
| Annotation | Value |
| ---------- | ----- |
| description | macro-db-prod-read-replica has 3.98x as many active sessions as vCPUs. Normal is under 1.3. |
| panel_url | https://grafana.macro-internal.com/d/prod-alerts?viewPanel=4 |
| runbook_url | https://github.com/macro-inc/macro/blob/main/docs/runbooks/macrodb.md#load |
| summary | macro-db-prod database load above vCPU count |

Source: https://grafana.macro-internal.com/alerting/grafana/macrodb-load-warn/view?orgId=1

\`\`\`
[ var='B' labels={} type='reduce' value=3.98 ]
\`\`\``;

const HERE_TAG = '<m-group-mention>{"groupAlias":"here"}</m-group-mention>';

describe('compact alert posts', () => {
  test('Datadog notify alert', () => {
    const post = compactAlert({
      ServiceName: 'Notify',
      Summary:
        '[P3] [Triggered on {host:macro-db-prod.ctkwyjgndnfr.us-east-1.rds.amazonaws.com}] [PROD] macro-db-prod long-running transaction',
      Details: DATADOG_DETAILS,
      GoAlertURL: 'https://oncall.macro-internal.com/alerts/130',
    });
    expect(renderPost(post)).toEqual({
      content: `🔔 · **macro-db-prod long-running transaction — macro-db-prod**
🔴 critical: 2631.578 (threshold 1800.0)
The oldest open transaction on macro-db-prod is 2631.578 seconds old. Long transactions hold locks and stop vacuum.
[Acknowledge](https://oncall.macro-internal.com/alerts/130) · [Graph](https://us5.datadoghq.com/dashboard/42x-f55-h6z/macrodb-alerts) · [Runbook](https://github.com/macro-inc/macro/blob/main/docs/runbooks/macrodb.md#locks)`,
      mentions: [],
    });
  });

  test('Grafana page mentions here', () => {
    const post = compactAlert({
      ServiceName: 'Grafana critical',
      Summary: 'macro-db-prod database load above vCPU count',
      Details: GRAFANA_DETAILS,
      GoAlertURL: 'https://oncall.macro-internal.com/alerts/127',
    });
    expect(renderPost(post)).toEqual({
      content: `🚨 **PAGE** · **macro-db-prod database load above vCPU count — macro-db-prod-read-replica** ${HERE_TAG}
🟠 warning
macro-db-prod-read-replica has 3.98x as many active sessions as vCPUs. Normal is under 1.3.
[Acknowledge](https://oncall.macro-internal.com/alerts/127) · [Graph](https://grafana.macro-internal.com/d/prod-alerts?viewPanel=4) · [Runbook](https://github.com/macro-inc/macro/blob/main/docs/runbooks/macrodb.md#load)`,
      mentions: [{ entity_type: 'group', entity_id: 'here' }],
    });
  });

  test('resolved page keeps the post and drops the mention', () => {
    const post = compactAlert({
      ServiceName: 'Grafana critical',
      Summary: 'macro-db-prod database load above vCPU count',
      Details: GRAFANA_DETAILS,
      GoAlertURL: 'https://oncall.macro-internal.com/alerts/127',
    });
    expect(renderPost(post, true)).toEqual({
      content: `✅ Resolved · 🚨 **PAGE** · **macro-db-prod database load above vCPU count — macro-db-prod-read-replica**
🟠 warning
macro-db-prod-read-replica has 3.98x as many active sessions as vCPUs. Normal is under 1.3.
[Acknowledge](https://oncall.macro-internal.com/alerts/127) · [Graph](https://grafana.macro-internal.com/d/prod-alerts?viewPanel=4) · [Runbook](https://github.com/macro-inc/macro/blob/main/docs/runbooks/macrodb.md#load)`,
      mentions: [],
    });
  });

  test('status change without a posted alert is one line', () => {
    expect(
      statusPost({
        Type: 'AlertStatus',
        AlertID: 48,
        ServiceID: '',
        ServiceName: 'Notify',
        Summary: '[P3] [Recovered on {tablename:events}] DynamoDB reads high',
        LogEntry: 'Closed by Datadog',
        GoAlertURL: 'https://oncall.macro-internal.com/alerts/48',
      })
    ).toEqual({
      content: `Closed by Datadog · DynamoDB reads high — events · [Open](https://oncall.macro-internal.com/alerts/48)`,
      mentions: [],
    });
  });

  test('long description is cut at a sentence', () => {
    const sentence = `${'A'.repeat(200)}. `;
    expect(firstSentences(sentence.repeat(3))).toBe(`${'A'.repeat(200)}.`);
  });
});
