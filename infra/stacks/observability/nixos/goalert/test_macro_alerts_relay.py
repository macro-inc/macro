"""Run with `python3 -m unittest` from this directory."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    'relay', Path(__file__).with_name('macro-alerts-relay.py')
)
relay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(relay)

DATADOG_DETAILS = """https://us5.datadoghq.com/event/event?id=8876996053944573810

🔴 CRITICAL: 2631.578 (threshold 1800.0)

The oldest open transaction on macro-db-prod.ctkwyjgndnfr.us-east-1.rds.amazonaws.com is 2631.578 seconds old. Long transactions hold locks and stop vacuum.

Runbook: https://github.com/macro-inc/macro/blob/main/docs/runbooks/macrodb.md#locks
Dashboard: https://us5.datadoghq.com/dashboard/42x-f55-h6z/macrodb-alerts

@webhook-goalert-notify

`avg(last_10m):max:postgresql.activity.xact_start_age{host:macro-db-prod*} by {host} > 1800`

Metric value: 2631.578

Metric Graph: https://us5.datadoghq.com/monitors/23404621?group=host · Monitor Status: https://us5.datadoghq.com/monitors/23404621"""

GRAFANA_DETAILS = """| Label | Value |
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

```
[ var='B' labels={} type='reduce' value=3.98 ]
```"""


class AlertPostTest(unittest.TestCase):
    def test_datadog_alert(self):
        post = relay.goalert_content({
            'Type': 'Alert',
            'ServiceName': 'Notify',
            'Summary': '[P3] [Triggered on {host:macro-db-prod.ctkwyjgndnfr.us-east-1.rds.amazonaws.com}] [PROD] macro-db-prod long-running transaction',
            'Details': DATADOG_DETAILS,
            'GoAlertURL': 'https://oncall.macro-internal.com/alerts/130',
        })
        self.assertEqual(post, """---
🔔 · **macro-db-prod long-running transaction — macro-db-prod**
🔴 critical: 2631.578 (threshold 1800.0)
The oldest open transaction on macro-db-prod is 2631.578 seconds old. Long transactions hold locks and stop vacuum.
[Acknowledge](https://oncall.macro-internal.com/alerts/130) · [Graph](https://us5.datadoghq.com/dashboard/42x-f55-h6z/macrodb-alerts) · [Runbook](https://github.com/macro-inc/macro/blob/main/docs/runbooks/macrodb.md#locks)""")

    def test_grafana_page(self):
        post = relay.goalert_content({
            'Type': 'Alert',
            'ServiceName': 'Grafana critical',
            'Summary': 'macro-db-prod database load above vCPU count',
            'Details': GRAFANA_DETAILS,
            'GoAlertURL': 'https://oncall.macro-internal.com/alerts/127',
        })
        self.assertEqual(post, """---
🚨 **PAGE** · **macro-db-prod database load above vCPU count — macro-db-prod-read-replica**
🟠 warning
macro-db-prod-read-replica has 3.98x as many active sessions as vCPUs. Normal is under 1.3.
[Acknowledge](https://oncall.macro-internal.com/alerts/127) · [Graph](https://grafana.macro-internal.com/d/prod-alerts?viewPanel=4) · [Runbook](https://github.com/macro-inc/macro/blob/main/docs/runbooks/macrodb.md#load)""")

    def test_status_update_is_one_line(self):
        post = relay.goalert_content({
            'Type': 'AlertStatus',
            'ServiceName': 'Notify',
            'Summary': '[P3] [Recovered on {tablename:events}] DynamoDB reads high',
            'LogEntry': 'Closed by Datadog',
            'GoAlertURL': 'https://oncall.macro-internal.com/alerts/48',
        })
        self.assertEqual(post, """---
Closed by Datadog · DynamoDB reads high — events · [Open](https://oncall.macro-internal.com/alerts/48)""")

    def test_long_description_is_cut_at_a_sentence(self):
        sentence = 'A' * 200 + '. '
        cut = relay.first_sentences(sentence * 3)
        self.assertEqual(cut, 'A' * 200 + '.')


if __name__ == '__main__':
    unittest.main()
