// Harness presence: whether the service's "connected" agrees with macrod.
//
// New monitor, not adopted. It reads a structured log event, keyed by
// `telemetry_event`, so the fields below are its contract:
//
// - `harness_presence_disagreement`, from document-storage-service, at most once
//   a minute per harness: macrod says it holds a runtime connection and the
//   service reads that harness as offline. Fields: `harness`.
//
// Ids are opaque harness uuids. Macrod sends the signal only once its connection
// has been up for a full minute, so a healthy reconnect never reaches it.
import * as datadog from '@pulumi/datadog';
import { goalertWebhooks } from '../goalert';
import { notify, RENOTIFY_MINUTES } from '../notify';

for (const environment of ['dev', 'prod'] as const) {
  const env = `env:${environment}`;

  new datadog.Monitor(
    `harness-presence-disagreement-${environment}`,
    {
      name: `[${environment.toUpperCase()}] Harness presence: {{harness.name}} online but reported offline`,
      type: 'log alert',
      query: `logs("@telemetry_event:harness_presence_disagreement ${env}").index("*").rollup("count").by("@harness").last("15m") > 5`,
      message: `Macrod for harness {{harness.name}} has held a runtime connection for at least five minutes while the service reports it offline, so the app marks its agents unavailable.

Search @harness:{{harness.name}} @telemetry_event:(harness_runtime_connected OR harness_runtime_disconnected OR harness_runtime_lease_restored). A live connection with no row, or a lease that stopped renewing, is on the replica named in those events. See crates/agents/agent_harness/AGENTS.md.

${notify({ pages: false, environment })}`,
      monitorThresholds: { critical: '5' },
      tags: [env, 'service:agent-harness-service'],
      priority: environment === 'prod' ? '2' : '3',
      includeTags: true,
      requireFullWindow: false,
      renotifyInterval: RENOTIFY_MINUTES,
      // Daemons older than this signal send nothing; that is not a disagreement.
      onMissingData: 'resolve',
    },
    { dependsOn: goalertWebhooks }
  );
}
