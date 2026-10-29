// WhatsApp linked-device sessions (services/whatsapp_session_service).
//
// New monitors, not adopted. Every one reads a structured log event the service
// emits, keyed by `telemetry_event`, so the fields below are its contract:
//
// - `whatsapp_session_health`, once a minute per replica:
//   `accounts_running`, `accounts_unowned` (connected or pairing accounts whose
//   advisory lock no session holds), `oldest_unprocessed_inbound_seconds`.
// - `whatsapp_session_reconnect`, once per websocket reconnect: `account_id`.
// - `whatsapp_send_outcome`, once per finished send: `outcome`
//   (`sent` | `failed` | `unknown`).
// - `whatsapp_session_drain`, once per SIGTERM drain: `drain_duration_ms`,
//   `accounts_released`.
//
// Ids are opaque account uuids; never phone numbers, JIDs, or content.
// Thresholds are starting points: there is no baseline before launch.
import * as datadog from '@pulumi/datadog';
import { goalertWebhooks } from '../goalert';
import { notify, RENOTIFY_MINUTES } from '../notify';

const CONTEXT = `Runbook: services/whatsapp_session_service/AGENTS.md. To stop all
WhatsApp traffic, scale whatsapp-session-service to 0 tasks; sends recorded
meanwhile expire unsent after ten minutes. Turning off the enable-whatsapp-linked
flag only hides the app UI.
${notify({ pages: false })}`;

const HEALTH = '@telemetry_event:whatsapp_session_health';

for (const environment of ['dev', 'prod']) {
  const env = `env:${environment}`;
  const label = `[${environment.toUpperCase()}] WhatsApp sessions`;
  const common = {
    tags: [env, 'service:whatsapp-session-service'],
    priority: environment === 'prod' ? '2' : '3',
    includeTags: true,
    requireFullWindow: false,
    renotifyInterval: RENOTIFY_MINUTES,
  };

  new datadog.Monitor(
    `whatsapp-session-unowned-accounts-${environment}`,
    {
      ...common,
      name: `${label}: accounts without an owner`,
      type: 'log alert',
      query: `logs("${HEALTH} ${env}").index("*").rollup("min", "@accounts_unowned").last("10m") > 0`,
      message: `{{value}} connected accounts have had no replica holding their lease for ten minutes, so their groups receive and send nothing. Check replica count, MAX_ACCOUNTS headroom, and the lock connection (DATABASE_URL must be the direct MacroDB instance endpoint).\n${CONTEXT}`,
      monitorThresholds: { critical: '0' },
      // Health events stop when the service is not deployed; that is not zero.
      onMissingData: 'resolve',
    },
    { dependsOn: goalertWebhooks }
  );

  new datadog.Monitor(
    `whatsapp-session-reconnect-churn-${environment}`,
    {
      ...common,
      name: `${label}: {{account_id.name}} reconnect churn`,
      type: 'log alert',
      query: `logs("@telemetry_event:whatsapp_session_reconnect ${env}").index("*").rollup("count").by("@account_id").last("15m") > 10`,
      message: `Account {{account_id.name}} reconnected {{value}} times in 15 minutes. A flapping session can get the number flagged by WhatsApp; check the disconnect reasons on its spans, and whether two replicas are fighting over the lease (lease_epoch bumps).\n${CONTEXT}`,
      monitorThresholds: { critical: '10', warning: '5' },
      onMissingData: 'resolve',
    },
    { dependsOn: goalertWebhooks }
  );

  new datadog.Monitor(
    `whatsapp-session-unknown-sends-${environment}`,
    {
      ...common,
      name: `${label}: sends with unknown outcome`,
      type: 'log alert',
      query: `logs("@telemetry_event:whatsapp_send_outcome @outcome:unknown ${env}").index("*").rollup("count").last("15m") > 5`,
      message: `{{value}} sends timed out after submission in 15 minutes. They are never resent automatically; the sender sees them as unknown. Check WhatsApp connectivity and drain/takeover timing around deploys.\n${CONTEXT}`,
      monitorThresholds: { critical: '5', warning: '0' },
      onMissingData: 'resolve',
    },
    { dependsOn: goalertWebhooks }
  );

  new datadog.Monitor(
    `whatsapp-session-inbound-lag-${environment}`,
    {
      ...common,
      name: `${label}: oldest unprocessed inbound event`,
      type: 'log alert',
      query: `logs("${HEALTH} ${env}").index("*").rollup("max", "@oldest_unprocessed_inbound_seconds").last("10m") > 300`,
      message: `An inbound WhatsApp event has waited {{value}}s for ingestion. Messages are reaching the replica but not the channel; check the ingestion spans and MacroDB latency.\n${CONTEXT}`,
      monitorThresholds: { critical: '300', warning: '60' },
      onMissingData: 'resolve',
    },
    { dependsOn: goalertWebhooks }
  );

  new datadog.Monitor(
    `whatsapp-session-drain-duration-${environment}`,
    {
      ...common,
      name: `${label}: drain close to the stop timeout`,
      type: 'log alert',
      query: `logs("@telemetry_event:whatsapp_session_drain ${env}").index("*").rollup("max", "@drain_duration_ms").last("1h") > 100000`,
      message: `A replica took {{value}}ms to drain on SIGTERM. ECS kills the task at 120s, cutting off in-flight sends (they become unknown). Raise DRAIN_BATCH or lower MAX_ACCOUNTS (services/whatsapp_session_service/src/main.rs).\n${CONTEXT}`,
      monitorThresholds: { critical: '100000', warning: '80000' },
      onMissingData: 'resolve',
    },
    { dependsOn: goalertWebhooks }
  );
}
