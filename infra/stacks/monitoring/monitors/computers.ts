// Macro computers: billing and fleet failures that need a person.
//
// New monitors, not adopted. Each reads an error-level log event with a fixed
// message, written by crates/hosted_runtimes, so these strings are their
// contract (see crates/hosted_runtimes/AGENTS.md):
//
// - `computer billing item removal abandoned`, from authentication-service:
//   removing a computer's Stripe subscription item failed for its whole
//   attempt cap and stopped retrying, so the team may still be billed for a
//   computer it no longer has. Fields: `computer_id`, `effect_id`, `attempts`.
// - `computer needs an operator`, from agent-harness-service: a computer gave
//   up restarting, a fleet effect failed for good, or its resources drifted.
//   Fields: `computer_id`, `reason`.
import * as datadog from '@pulumi/datadog';
import { goalertWebhooks } from '../goalert';
import { notify, RENOTIFY_MINUTES } from '../notify';

for (const environment of ['dev', 'prod'] as const) {
  const env = `env:${environment}`;

  new datadog.Monitor(
    `computer-billing-removal-abandoned-${environment}`,
    {
      name: `[${environment.toUpperCase()}] Computers: billing item removal abandoned for {{computer_id.name}}`,
      type: 'log alert',
      query: `logs("service:authentication-service status:error \\"computer billing item removal abandoned\\" ${env}").index("*").rollup("count").by("@computer_id").last("1h") > 0`,
      message: `Removing the Stripe subscription item of computer {{computer_id.name}} failed for its whole retry budget and stopped. The team may still be billed for a computer that was canceled or released.

Find the item carrying metadata computer_id={{computer_id.name}} on the team subscription and remove it without proration, or confirm it is gone. Search @computer_id:{{computer_id.name}} "billing effect failed" for the errors. See crates/hosted_runtimes/AGENTS.md.

${notify({ pages: environment === 'prod', environment })}`,
      monitorThresholds: { critical: '0' },
      tags: [env, 'service:authentication-service'],
      priority: environment === 'prod' ? '2' : '3',
      includeTags: true,
      requireFullWindow: false,
      renotifyInterval: RENOTIFY_MINUTES,
      onMissingData: 'resolve',
    },
    { dependsOn: goalertWebhooks }
  );

  new datadog.Monitor(
    `computer-needs-operator-${environment}`,
    {
      name: `[${environment.toUpperCase()}] Computers: {{computer_id.name}} needs an operator`,
      type: 'log alert',
      query: `logs("service:agent-harness-service status:error \\"computer needs an operator\\" ${env}").index("*").rollup("count").by("@computer_id").last("15m") > 0`,
      message: `Computer {{computer_id.name}} paged: it gave up restarting, a fleet effect failed for good, or its resource limits drifted. The log's reason says which.

Retry it from Settings or POST /team/computers/{id}/retry once the cause is fixed. See crates/hosted_runtimes/AGENTS.md.

${notify({ pages: environment === 'prod', environment })}`,
      monitorThresholds: { critical: '0' },
      tags: [env, 'service:agent-harness-service'],
      priority: environment === 'prod' ? '2' : '3',
      includeTags: true,
      requireFullWindow: false,
      renotifyInterval: RENOTIFY_MINUTES,
      onMissingData: 'resolve',
    },
    { dependsOn: goalertWebhooks }
  );
}
