// cloud-storage-service database pool waits, beside what explains them:
// search stage timings, the service's own CPU, and the database instance.
//
// New monitor, not adopted. It reads the OTel pool metrics
// cloud-storage-service records for each of its sqlx pools, so these are its
// contract; renaming one silently turns the monitor into missing data:
//
// - `db.client.connection.wait_time`: seconds a probe waited for a connection
//   (histogram). Each task acquires and releases one connection per pool every
//   second, tagged `outcome` (`acquired`, `timed_out` or `failed`); a timed-out
//   sample reads the pool's acquire timeout.
// - `db.client.connection.count`: connections by `db.client.connection.state`
//   (`idle` or `used`).
// - `db.client.connection.max`: the pool's maximum.
//
// All tagged `db.client.connection.pool.name` (`primary` or `readonly`), plus
// `env` and `service`. The gauges are per task and tasks may share a series,
// so they are read with `max`, never `sum`. A task that fell back to the
// primary at startup reports no `readonly` series. The dashboard also reads the `perform_unified_search`
// span (`search.search_on`, `search.caller`) and its child spans from
// crates/search_service, and the text of sqlx's slow-acquire warning.
//
// Thresholds come from the `soup.pool.acquire` span, the nearest existing
// measure of the same wait, since the metrics are newer than every incident.
// Its 10-minute average was 1-5 ms on a quiet weekday, about 35 ms in a
// two-minute burst on 2026-11-11, and 1.3-2.3 s on 2026-11-09 (prod, primary
// overloaded) and 2026-11-13 (dev, one task out of CPU with the database
// idle). The warning would have fired in all three and the critical within
// about two minutes of the start of the last two. Retune once the metrics
// have a week of data: indexed spans over-represent slow requests, and the
// span is weighted by request where the probe is weighted by time.
import * as datadog from '@pulumi/datadog';
import { graphGroup, prodMonitor, thresholdGraph } from '../prod-monitor';

const TITLE = 'cloud-storage-service database pool waits long';

const POOL = 'db.client.connection.pool.name';
const SERVICE = 'env:$env.value,service:cloud-storage-service';
const TASKS =
  'clustername:cloud-storage-cluster-$env.value,servicename:cloud-storage-service*';
const DB = '{$db}';
const SLOW_ACQUIRE = '"time to acquire exceeded slow threshold" env:$env.value';
const SEARCH_STAGES =
  'service:cloud-storage-service env:$env.value resource_name:(perform_unified_search OR search_unified OR enrich_search_response OR enrich_documents OR enrich_emails OR soup.pool.acquire)';
const UNIFIED_SEARCH =
  'service:cloud-storage-service env:$env.value resource_name:perform_unified_search';
const NS_TO_MS = ' / 1000000';

function lines(
  title: string,
  q: string,
  markers?: datadog.types.input.DashboardWidgetTimeseriesDefinitionMarker[]
): datadog.types.input.DashboardWidget {
  return {
    timeseriesDefinition: {
      title,
      showLegend: true,
      requests: [{ q, displayType: 'line' }],
      markers,
    },
  };
}

function spanP95(
  title: string,
  query: string,
  facet: string
): datadog.types.input.DashboardWidget {
  return {
    timeseriesDefinition: {
      title,
      showLegend: true,
      requests: [
        {
          queries: [
            {
              eventQuery: {
                dataSource: 'spans',
                name: 'p95',
                computes: [{ aggregation: 'pc95', metric: '@duration' }],
                search: { query },
                indexes: ['*'],
                groupBies: [
                  {
                    facet,
                    limit: 10,
                    sort: {
                      aggregation: 'pc95',
                      metric: '@duration',
                      order: 'desc',
                    },
                  },
                ],
              },
            },
          ],
          formulas: [{ formulaExpression: `p95${NS_TO_MS}` }],
          displayType: 'line',
        },
      ],
    },
  };
}

const dashboard = new datadog.Dashboard('storage-pool-saturation', {
  title: 'Search and database saturation',
  description:
    'Pool waits in cloud-storage-service beside search stage timings, the service tasks and the database instance, to tell a saturated database from a starved service. Declared in infra/stacks/monitoring/monitors/storage-pool.ts; see docs/runbooks/macrodb.md#pool-waits.',
  layoutType: 'ordered',
  templateVariables: [
    { name: 'env', prefix: 'env', default: 'prod' },
    {
      name: 'db',
      prefix: 'dbinstanceidentifier',
      default: 'macro-db-prod-read-replica',
    },
  ],
  widgets: [
    graphGroup('Pool', [
      thresholdGraph({
        title: TITLE,
        query: `avg:db.client.connection.wait_time{${SERVICE}} by {${POOL}}`,
        critical: '0.25',
        warning: '0.025',
      }),
      lines(
        'Longest wait for a connection (s) by pool',
        `max:db.client.connection.wait_time{${SERVICE}} by {${POOL}}`
      ),
      lines(
        'Connections in use against the maximum, busiest task, by pool',
        `max:db.client.connection.count{${SERVICE},db.client.connection.state:used} by {${POOL}}, max:db.client.connection.max{${SERVICE}} by {${POOL}}`
      ),
      lines(
        'Idle connections, emptiest task, by pool',
        `min:db.client.connection.count{${SERVICE},db.client.connection.state:idle} by {${POOL}}`
      ),
      lines(
        'Probes that timed out or failed, by pool and outcome',
        `count:db.client.connection.wait_time{${SERVICE},!outcome:acquired} by {${POOL},outcome}.as_count()`
      ),
      {
        timeseriesDefinition: {
          title: 'Waits over 2 s (sqlx slow-acquire warnings) by service',
          showLegend: true,
          requests: [
            {
              queries: [
                {
                  eventQuery: {
                    dataSource: 'logs',
                    name: 'waits',
                    computes: [{ aggregation: 'count' }],
                    search: { query: SLOW_ACQUIRE },
                    indexes: ['*'],
                    groupBies: [
                      {
                        facet: 'service',
                        limit: 10,
                        sort: { aggregation: 'count', order: 'desc' },
                      },
                    ],
                  },
                },
              ],
              formulas: [{ formulaExpression: 'waits' }],
              displayType: 'bars',
            },
          ],
        },
      },
      lines(
        'cloud-storage-service task CPU (%), average and busiest task',
        `avg:aws.ecs.service.cpuutilization{${TASKS}}, max:aws.ecs.service.cpuutilization.maximum{${TASKS}}`
      ),
    ]),
    graphGroup('Search', [
      lines(
        'POST /dss/search p50 and p95 (s)',
        'p50:trace.http.server.request{service:cloud-storage-service,env:$env.value,resource_name:post_/dss/search}, p95:trace.http.server.request{service:cloud-storage-service,env:$env.value,resource_name:post_/dss/search}'
      ),
      spanP95(
        'Search stages p95 (ms), indexed spans',
        SEARCH_STAGES,
        'resource_name'
      ),
      spanP95(
        'Unified search p95 (ms) by mode, indexed spans',
        UNIFIED_SEARCH,
        '@search.search_on'
      ),
      spanP95(
        'Unified search p95 (ms) by caller, indexed spans',
        UNIFIED_SEARCH,
        '@search.caller'
      ),
    ]),
    graphGroup('Database instance', [
      lines(
        'Active sessions per vCPU',
        `avg:aws.rds.dbload_relative_to_num_vcpus${DB} by {dbinstanceidentifier}`
      ),
      lines(
        'Replica lag (s)',
        `max:aws.rds.replica_lag${DB} by {dbinstanceidentifier}`
      ),
      lines(
        'Connections',
        `max:aws.rds.database_connections${DB} by {dbinstanceidentifier}`
      ),
      lines(
        'Freeable memory and swap (bytes)',
        `avg:aws.rds.freeable_memory${DB} by {dbinstanceidentifier}, max:aws.rds.swap_usage${DB} by {dbinstanceidentifier}`
      ),
      lines(
        'Instance I/O credits (EBSIOBalance%) and throughput credits (EBSByteBalance%)',
        `min:aws.rds.ebsiobalance${DB} by {dbinstanceidentifier}, min:aws.rds.ebsbyte_balance${DB} by {dbinstanceidentifier}`
      ),
      lines(
        'Read plus write IOPS against the 6,000 the prod instance class sustains',
        `avg:aws.rds.read_iops${DB} by {dbinstanceidentifier} + avg:aws.rds.write_iops${DB} by {dbinstanceidentifier}`,
        [
          {
            label: 'prod instance baseline',
            value: 'y = 6000',
            displayType: 'warning dashed',
          },
        ]
      ),
      lines(
        'Disk queue depth',
        `avg:aws.rds.disk_queue_depth${DB} by {dbinstanceidentifier}`
      ),
      lines(
        'Disk read latency (s)',
        `avg:aws.rds.read_latency${DB} by {dbinstanceidentifier}`
      ),
      lines(
        'CPU (%) and CPU credit balance (burstable classes only)',
        `avg:aws.rds.cpuutilization${DB} by {dbinstanceidentifier}, min:aws.rds.cpucredit_balance${DB} by {dbinstanceidentifier}`
      ),
    ]),
  ],
});

prodMonitor('storage-pool-wait', {
  title: TITLE,
  service: 'cloud-storage-service',
  query: `avg(last_10m):avg:db.client.connection.wait_time{env:prod,service:cloud-storage-service} by {${POOL}} > 0.25`,
  monitorThresholds: { critical: '0.25', warning: '0.025' },
  pages: false,
  description: `The prod cloud-storage-service \`{{[${POOL}].name}}\` pool took {{value}} s on average to hand out a database connection over 10 minutes. Normal is under 5 ms. This is time queued inside the service before any SQL runs, not query time. Two causes look the same here. Connections in use at the pool maximum: the pool is the queue, because the database is slow and connections come back late (active sessions per vCPU or I/O credits on the dashboard are off, task CPU normal or low). Connections in use below the maximum: the service is starved and cannot get to the connections it has (busiest task CPU near 100%, database idle).`,
  dashboard: dashboard.url,
  runbook: 'docs/runbooks/macrodb.md#pool-waits',
});
