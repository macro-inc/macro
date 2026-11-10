// Macro computer capacity: order another bare-metal Incus host before the
// fleet sells out.
//
// New monitors, not adopted. They read two gauges agent_harness_service's
// computer operator records every reconcile pass
// (crates/hosted_runtimes/src/domain/telemetry.rs), so these are their contract:
//
// - `computer.capacity.allocated`: what computers hold, from reservation until
//   payment refusal or destruction, asleep or stopped included.
// - `computer.capacity.total`: the host's capacity, for the resources the
//   capacity model bounds.
//
// Tags: `scope` (`host` or `fleet`), `host_id` and `host` (host scope only),
// `resource` (`sold_units`, `awake_units`, `vcpus`, `memory_gib`, `disk_gib`).
// Purchases are refused once `sold_units` reaches its total, so that is what
// these alert on. Every replica records the same values; `max` dedupes them.
import * as datadog from '@pulumi/datadog';
import { graphGroup, prodMonitor, thresholdGraph } from '../prod-monitor';

const soldShare = (scope: 'host' | 'fleet') => {
  const tags = `{env:prod,scope:${scope},resource:sold_units}`;
  const by = scope === 'host' ? ' by {host_id,host}' : '';
  return `100 * max:computer.capacity.allocated${tags}${by} / max:computer.capacity.total${tags}${by}`;
};

const HOST_TITLE = 'Computer host nearly sold out';
const FLEET_TITLE = 'Computer fleet nearly sold out';

// One graph per monitor below, titled like it, with its thresholds.
const dashboard = new datadog.Dashboard('computer-capacity-alerts', {
  title: 'Computer capacity alerts',
  description:
    'Sold computer capacity against the order-a-box thresholds. Declared in infra/stacks/monitoring/monitors/computers.ts; see docs/runbooks/computer-capacity.md.',
  layoutType: 'ordered',
  widgets: [
    graphGroup('Sold units', [
      thresholdGraph({
        title: FLEET_TITLE,
        query: soldShare('fleet'),
        critical: '85',
        warning: '70',
      }),
      thresholdGraph({
        title: HOST_TITLE,
        query: soldShare('host'),
        critical: '85',
        warning: '70',
      }),
    ]),
    graphGroup('Allocation', [
      {
        timeseriesDefinition: {
          title: 'Fleet units sold and capacity',
          requests: [
            {
              q: 'max:computer.capacity.allocated{env:prod,scope:fleet} by {resource}',
              displayType: 'line',
            },
            {
              q: 'max:computer.capacity.total{env:prod,scope:fleet} by {resource}',
              displayType: 'line',
            },
          ],
        },
      },
      {
        timeseriesDefinition: {
          title: 'Resources sold per host',
          requests: [
            {
              q: 'max:computer.capacity.allocated{env:prod,scope:host} by {host,resource}',
              displayType: 'line',
            },
          ],
        },
      },
    ]),
  ],
});

prodMonitor('computer-fleet-capacity', {
  title: FLEET_TITLE,
  service: 'agent-harness-service',
  query: `avg(last_15m):${soldShare('fleet')} > 85`,
  monitorThresholds: { critical: '85', warning: '70' },
  pages: false,
  description:
    'Order another bare-metal box. Computers hold {{value}}% of the units the fleet can sell; at 100% every size is sold out and purchases are refused. Units sold and fleet capacity are on the dashboard.',
  dashboard: dashboard.url,
  runbook: 'docs/runbooks/computer-capacity.md#order-another-box',
});

prodMonitor('computer-host-capacity', {
  title: HOST_TITLE,
  service: 'agent-harness-service',
  query: `avg(last_15m):${soldShare('host')} > 85`,
  monitorThresholds: { critical: '85', warning: '70' },
  pages: false,
  description:
    'Order another bare-metal box. Computers hold {{value}}% of the units {{host.name}} ({{host_id.name}}) can sell; once full, sizes it cannot fit are sold out unless another host has room. Units sold and capacity per host are on the dashboard.',
  dashboard: dashboard.url,
  runbook: 'docs/runbooks/computer-capacity.md#order-another-box',
});
