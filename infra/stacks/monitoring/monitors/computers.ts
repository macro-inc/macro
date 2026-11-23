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
// - `computer purchase refund abandoned`, from authentication-service: a
//   computer released after failing its first start twice could not be
//   refunded within its attempt cap, so the team paid for a computer that
//   never worked. Fields: `computer_id`, `effect_id`, `attempts`.
// - `computer purchase refund found no paid purchase`, from
//   authentication-service: a computer released after two failed first starts
//   was billed on an item, but no paid invoice carried its purchase (still
//   open, or older than the invoices searched), so nothing was refunded.
//   Fields: `computer_id`.
// - `agent invite undo abandoned`, from authentication-service: a computer
//   bought for an agent teammate was released after failing its first start,
//   and taking the agent back failed for its whole attempt cap. Fields:
//   `computer_id`, `effect_id`, `attempts`.
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
    `computer-purchase-refund-abandoned-${environment}`,
    {
      name: `[${environment.toUpperCase()}] Computers: purchase refund abandoned for {{computer_id.name}}`,
      type: 'log alert',
      query: `logs("service:authentication-service status:error \\"computer purchase refund abandoned\\" ${env}").index("*").rollup("count").by("@computer_id").last("1h") > 0`,
      message: `Computer {{computer_id.name}} failed its first start twice and was released, but refunding its purchase failed for its whole retry budget. The team paid for a computer that never worked.

Find the invoice line whose price has metadata computer_id={{computer_id.name}} and credit note it (refund the card part), then remove the item carrying that computer_id without proration. Search @computer_id:{{computer_id.name}} "billing effect failed" for the errors. See crates/hosted_runtimes/AGENTS.md.

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
    `computer-purchase-refund-unmatched-${environment}`,
    {
      name: `[${environment.toUpperCase()}] Computers: no purchase found to refund for {{computer_id.name}}`,
      type: 'log alert',
      query: `logs("service:authentication-service status:error \\"computer purchase refund found no paid purchase\\" ${env}").index("*").rollup("count").by("@computer_id").last("1h") > 0`,
      message: `Computer {{computer_id.name}} was released after failing its first start twice and was billed on an item, but no paid invoice carried its purchase, so nothing was refunded.

Find the team's invoice whose line has a price with metadata computer_id={{computer_id.name}} (it may still be open, or older than the 20 most recent paid invoices) and credit note it. See crates/hosted_runtimes/AGENTS.md.

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
    `computer-agent-invite-undo-abandoned-${environment}`,
    {
      name: `[${environment.toUpperCase()}] Computers: agent not taken back for {{computer_id.name}}`,
      type: 'log alert',
      query: `logs("service:authentication-service status:error \\"agent invite undo abandoned\\" ${env}").index("*").rollup("count").by("@computer_id").last("1h") > 0`,
      message: `Computer {{computer_id.name}} was released after failing its first start, and taking back the agent teammate it was bought for failed for its whole retry budget. The agent may still hold its seat, membership, keys and repository with no computer.

Remove the agent from the team's Members settings, or find it by hosted_runtime.agent_user_id for this computer. Search @computer_id:{{computer_id.name}} "agent effect failed" for the errors. See crates/hosted_runtimes/AGENTS.md.

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
