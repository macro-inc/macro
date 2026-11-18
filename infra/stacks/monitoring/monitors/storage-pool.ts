// cloud-storage-service database pool waits, beside what explains them:
// search stage timings, the service's own CPU, and the database instance.
//
// New monitor, not adopted. It reads the OTel pool metrics
// cloud-storage-service records for each of its sqlx pools, so these are its
// contract; renaming one silently turns the monitor into missing data. The
// metrics ship separately from this file: the monitor and the pool graphs
// have no data until that cloud-storage-service release is deployed.
//
// - `db.client.connection.wait_time`: seconds a probe waited in the pool's
//   queue (histogram). Each task samples each pool every second, tagged
//   `outcome` (`acquired`, `timed_out` or `failed`). It records 0 while the
//   pool has an idle connection and queues for one only when none is idle, so
//   it measures an exhausted pool and nothing else; a timed-out sample reads
//   the pool's acquire timeout, about 30 s on either pool.
// - `db.client.connection.used`: connections in use, sampled every second
//   (histogram), so its `max` catches bursts the gauges below miss.
// - `db.client.connection.count`: connections by `db.client.connection.state`
//   (`idle` or `used`).
// - `db.client.connection.max`: the pool's maximum.
//
// All tagged `db.client.connection.pool.name` (`primary` or `readonly`), plus
// `env` and `service`. The gauges export one reading a minute, are per task
// and tasks may share a series, so they are read with `max`, never `sum`. A task that fell back to the
// primary at startup reports no `readonly` series. A minute in which every
// wait sample was 0 exports no points, so no data on `wait_time` is the
// healthy state and its average covers only minutes with a wait: the monitor
// must not alert on missing data. The dashboard also reads the `perform_unified_search`
// span (`search.search_on`, `search.caller`) and its child spans from
// crates/search_service, and the text of sqlx's slow-acquire warning.
//
// There is no per-task tag: tasks in one availability zone share a series, so
// every query takes `max` (or `min` for idle) and the graphs split by zone.
// Percentiles are not enabled on the two histograms; a p95 or p99 query needs
// them enabled in Datadog first.
//
// The monitor takes the longest wait in each minute, counts a minute without
// one as 0, and averages that over 10 minutes: a brief wait cannot fire it, a
// single probe that times out (30 s, so 3 s averaged) raises the warning, and
// only a pool that stays exhausted reaches the critical. On dev in the first two hours of
// data both pools filled for a second at a time (20 of 20 and 100 of 100),
// the longest wait was 0.4 s and the 10-minute figure peaked at 0.08 s, so
// neither threshold was reached. During the 2026-11-09 (prod, primary overloaded)
// and 2026-11-13 (dev, one task out of CPU) stalls the `soup.pool.acquire`
// span, the nearest older measure, ran into the 30 s acquire timeout for
// minutes on end, which would put the figure well past the critical. The
// thresholds stay provisional until prod has a week of data.
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
        query: `default_zero(max:db.client.connection.wait_time{${SERVICE}} by {${POOL}})`,
        critical: '5',
        warning: '0.5',
      }),
      lines(
        'Longest wait for a connection (s) by pool and zone',
        `max:db.client.connection.wait_time{${SERVICE}} by {${POOL},availability-zone}`
      ),
      lines(
        'Most connections in use in any second, by pool and zone, against the pool maximum',
        `max:db.client.connection.used{${SERVICE}} by {${POOL},availability-zone}, max:db.client.connection.max{${SERVICE}} by {${POOL}}`
      ),
      lines(
        'Fewest idle connections (one reading a minute), by pool and zone',
        `min:db.client.connection.count{${SERVICE},db.client.connection.state:idle} by {${POOL},availability-zone}`
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
        'Read plus write IOPS against the prod provisioned storage IOPS',
        `avg:aws.rds.read_iops${DB} by {dbinstanceidentifier} + avg:aws.rds.write_iops${DB} by {dbinstanceidentifier}`,
        [
          {
            label: 'prod provisioned storage IOPS',
            value: 'y = 12000',
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
  query: `avg(last_10m):default_zero(max:db.client.connection.wait_time{env:prod,service:cloud-storage-service} by {${POOL}}) > 5`,
  monitorThresholds: { critical: '5', warning: '0.5' },
  pages: false,
  description: `The prod cloud-storage-service \`{{[${POOL}].name}}\` pool's longest wait for a database connection averaged {{value}} s a minute over 10 minutes. Normal is 0. A wait is recorded only while every connection in the pool is in use, and it is time queued inside the service before any SQL runs, not query time. Two causes look the same here. The database is slow, so connections come back late: active sessions per vCPU or I/O credits on the dashboard are off and task CPU is normal or low. Or the service is starved, so its tasks hold connections they are not using: the busiest task's CPU is near 100% and the database is idle.`,
  dashboard: dashboard.url,
  runbook: 'docs/runbooks/macrodb.md#pool-waits',
});
