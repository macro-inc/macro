// The Stripe event inbox: billing events Macro failed to apply, applies late,
// or disagrees with Stripe about.
//
// New monitors, not adopted. Each reads a log event with a fixed message
// that crates/stripe_inbox writes from authentication-service, so these
// strings are their contract (see crates/stripe_inbox/AGENTS.md):
//
// - `stripe inbox cursor dead-lettered` (error): a consumer gave up on an
//   event, at once for one it can never apply (a grant on an unknown price, a
//   payload in an unsupported API version) or after about 74 hours of
//   retries. That consumer stops for that customer until replayed (or, after
//   retries, until its next event). Fields: `consumer`,
//   `customer_id`, `event_id`, `attempts`.
// - `stripe inbox dead cursors` (error): every replica logs it every 15
//   minutes while any cursor is dead-lettered, so the alert holds until the
//   cursor is replayed. Fields: `consumer`, `dead`.
// - `stripe inbox backlog` (warn): an event applied more than five minutes
//   after the webhook stored it. Field: `consumer`.
// - `stripe audit mismatch` (warn): the daily audit found Stripe and Macro
//   disagreeing. Fields: `kind`, `object_id`.
import * as datadog from '@pulumi/datadog';
import { goalertWebhooks } from '../goalert';
import { notify, RENOTIFY_MINUTES } from '../notify';

const REPLAY = `Fix the cause, then replay: POST /internal/stripe_inbox/replay on authentication-service with {"consumer", "orderingKey", "skipDeadEvent"}, or every dead cursor with POST /internal/stripe_inbox/replay_dead (skip only an event that must never apply). A cursor whose retries ran out re-arms on its next event. See docs/runbooks/stripe-event-inbox.md.`;

for (const environment of ['dev', 'prod'] as const) {
  const env = `env:${environment}`;
  const pages = environment === 'prod';

  new datadog.Monitor(
    `stripe-inbox-dead-letter-${environment}`,
    {
      name: `[${environment.toUpperCase()}] Stripe inbox: {{consumer.name}} dead-lettered an event`,
      type: 'log alert',
      // The periodic count keeps it alerting until the cursor recovers.
      query: `logs("service:authentication-service status:error (\\"stripe inbox cursor dead-lettered\\" OR \\"stripe inbox dead cursors\\") ${env}").index("*").rollup("count").by("@consumer").last("30m") > 0`,
      message: `The {{consumer.name}} consumer stopped applying Stripe events for a customer. Its billing state (roles, team seats, credits or computers) stays as it was until the cursor is replayed.

Search "stripe inbox cursor dead-lettered" @consumer:{{consumer.name}} for the customer, event and error. ${REPLAY}

${notify({ pages, environment })}`,
      monitorThresholds: { critical: '0' },
      tags: [env, 'service:authentication-service'],
      priority: pages ? '2' : '3',
      includeTags: true,
      requireFullWindow: false,
      renotifyInterval: RENOTIFY_MINUTES,
      onMissingData: 'resolve',
    },
    { dependsOn: goalertWebhooks }
  );

  new datadog.Monitor(
    `stripe-inbox-backlog-${environment}`,
    {
      name: `[${environment.toUpperCase()}] Stripe inbox: {{consumer.name}} is applying events late`,
      type: 'log alert',
      query: `logs("service:authentication-service \\"stripe inbox backlog\\" ${env}").index("*").rollup("count").by("@consumer").last("15m") > 5`,
      message: `The {{consumer.name}} consumer applied Stripe events more than five minutes after they arrived, so plan changes and payments reach people late. Look for failing applies ("stripe inbox apply failed") and for Stripe rate limits ("stripe inbox rate limited").

${notify({ pages, environment })}`,
      monitorThresholds: { critical: '5' },
      tags: [env, 'service:authentication-service'],
      priority: pages ? '2' : '3',
      includeTags: true,
      requireFullWindow: false,
      renotifyInterval: RENOTIFY_MINUTES,
      onMissingData: 'resolve',
    },
    { dependsOn: goalertWebhooks }
  );

  new datadog.Monitor(
    `stripe-audit-mismatch-${environment}`,
    {
      name: `[${environment.toUpperCase()}] Stripe audit: {{kind.name}} mismatch`,
      type: 'log alert',
      query: `logs("service:authentication-service \\"stripe audit mismatch\\" ${env}").index("*").rollup("count").by("@kind").last("1d") > 0`,
      message: `The daily Stripe audit found {{kind.name}}: Stripe and Macro disagree. It changes nothing; the findings are rows in stripe_audit_mismatch for the run. A missing_event is a webhook Stripe sent that never arrived; an unconsumed_event_type is a type the endpoint sends that no consumer applies.

${REPLAY}

${notify({ pages: false, environment })}`,
      monitorThresholds: { critical: '0' },
      tags: [env, 'service:authentication-service'],
      priority: '3',
      includeTags: true,
      requireFullWindow: false,
      renotifyInterval: RENOTIFY_MINUTES,
      onMissingData: 'resolve',
    },
    { dependsOn: goalertWebhooks }
  );
}
