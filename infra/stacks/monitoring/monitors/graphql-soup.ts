// GraphQL soup rollout (PostHog flag `enable-graphql-soup`).
//
// New monitors, not adopted from the UI, so they are not `protect`ed — tune or
// remove them freely once the rollout settles.
//
// Thresholds sit above the 7 days before the 2026-10-11 ramp: none of these
// would have fired in that week except where noted. PostHog covers the client
// side (exceptions, browser cache and draft-queue logs, usage) on
// https://us.posthog.com/project/299018/dashboard/2198651.
//
// GraphQL resolver errors return HTTP 200 on a single path, so the endpoint
// monitors can't see them. The per-operation monitors read the `graphql.execute`
// span, whose APM resource is `graphql.<type>.<operationName>` (lowercased in
// metric tags) once https://github.com/macro-inc/macro/pull/7911 deploys; until
// then they have no data.
import * as datadog from '@pulumi/datadog';

const GRAPHQL =
  'service:cloud-storage-service,env:prod,resource_name:post_/dss/items/soup/graphql';
// Excludes the pre-#7911 resource, which only covers the few spans that happen
// to be top-level and has a different latency profile.
const GRAPHQL_OPERATIONS =
  'service:cloud-storage-service,env:prod,resource_name:graphql.*,!resource_name:graphql.execute';
const GRAPHQL_WS =
  'service:cloud-storage-service,env:prod,resource_name:get_/dss/items/soup/graphql/ws';
const DSS =
  'clustername:cloud-storage-cluster-prod,servicename:cloud-storage-service*';
const DSS_TARGET_GROUP =
  'targetgroup:targetgroup/prod-cloud-storage-service-tg/efcc30d4d72a4d50';
const GATEWAY_ALB = 'loadbalancer:app/prod-gateway-alb/8e99d35bdc70b1c9';

const ROLLOUT_CONTEXT = `Rollout: \`enable-graphql-soup\` (https://us.posthog.com/project/299018/feature_flags/738783).
Client-side view: https://us.posthog.com/project/299018/dashboard/2198651`;

// Datadog webhook integration that posts into the Macro "Alerts" channel
// (https://macro.com/app/channel/019fb34d-fcfd-7548-9a0f-7084ea16416c). There
// is no separate severe channel, so severity is marked in the message instead.
const MACRO_ALERTS_CHANNEL = '@webhook-macro-alert-hook';

const notify = (severe: boolean) =>
  severe
    ? `{{#is_alert}}SEVERE: user-facing impact likely, act now.{{/is_alert}}\n${MACRO_ALERTS_CHANNEL}`
    : MACRO_ALERTS_CHANNEL;

function rolloutMonitor(
  name: string,
  args: {
    name: string;
    type: string;
    query: string;
    description: string;
    critical: string;
    warning: string;
    service: string;
    severe?: boolean;
  }
): datadog.Monitor {
  return new datadog.Monitor(name, {
    name: args.name,
    type: args.type,
    query: args.query,
    message: `${args.description}

${ROLLOUT_CONTEXT}

${notify(args.severe ?? false)}`,
    tags: ['env:prod', `service:${args.service}`, 'rollout:graphql-soup'],
    priority: args.severe ? '2' : '3',
    monitorThresholds: { critical: args.critical, warning: args.warning },
    // APM and log counts are sparse at night; a full window would skip
    // evaluations, and an empty count must read as zero rather than alert.
    requireFullWindow: false,
    onMissingData: 'default',
    includeTags: true,
    notifyAudit: false,
  });
}

// Latency. The endpoint's p95 is long-tailed even when healthy (30-minute p95
// had a 99th percentile of 8.5s), so the median is the user-facing signal and
// p95 only catches a broad slowdown.
rolloutMonitor('graphql-soup-latency-p50', {
  name: '[PROD] GraphQL soup: median request latency high',
  type: 'query alert',
  query: `percentile(last_30m):p50:trace.http.server.request{${GRAPHQL}} > 1`,
  description:
    'Median latency of POST /dss/items/soup/graphql is above {{threshold}}s (normal is about 35ms). No depth, complexity, or timeout limits exist yet, so check for an expensive query or DB contention.',
  critical: '1',
  warning: '0.5',
  service: 'cloud-storage-service',
});

rolloutMonitor('graphql-soup-latency-p95', {
  name: '[PROD] GraphQL soup: p95 request latency high',
  type: 'query alert',
  query: `percentile(last_30m):p95:trace.http.server.request{${GRAPHQL}} > 10`,
  description:
    'p95 latency of POST /dss/items/soup/graphql is above {{threshold}}s over 30 minutes (normal median p95 is under 1s).',
  critical: '10',
  warning: '8',
  service: 'cloud-storage-service',
});

rolloutMonitor('graphql-soup-error-spans', {
  name: '[PROD] GraphQL soup: request error spans high',
  type: 'query alert',
  query: `sum(last_15m):sum:trace.http.server.request.errors{${GRAPHQL}}.as_count() > 40`,
  description:
    'POST /dss/items/soup/graphql produced {{value}} error spans in 15 minutes (normal median 4, max 31).',
  critical: '40',
  warning: '20',
  service: 'cloud-storage-service',
});

// Per operation. Only resolver failures for signed-in callers mark the span
// errored; coded domain errors and unauthenticated requests do not. These
// series don't exist before #7911, so the thresholds below are starting points
// rather than back-tested.
rolloutMonitor('graphql-soup-operation-errors', {
  name: '[PROD] GraphQL soup: {{resource_name.name}} resolver errors high',
  type: 'query alert',
  query: `sum(last_15m):sum:trace.Internal.errors{${GRAPHQL_OPERATIONS}} by {resource_name}.as_count() > 20`,
  description:
    'GraphQL operation `{{resource_name.name}}` had {{value}} failed executions in 15 minutes. Find the failing resolver path with the "graphql resolver error" logs grouped by `@graphql.error.path`.',
  critical: '20',
  warning: '10',
  service: 'cloud-storage-service',
});

// The +200 keeps quiet operations from alerting on a couple of errors: it
// fires once errors exceed 5% of requests plus 10.
rolloutMonitor('graphql-soup-operation-error-rate', {
  name: '[PROD] GraphQL soup: {{resource_name.name}} error rate high',
  type: 'query alert',
  query: `sum(last_15m):sum:trace.Internal.errors{${GRAPHQL_OPERATIONS}} by {resource_name}.as_count() / (sum:trace.Internal.hits{${GRAPHQL_OPERATIONS}} by {resource_name}.as_count() + 200) > 0.05`,
  description:
    'More than 5% of `{{resource_name.name}}` executions failed in 15 minutes (beyond a 10-error floor).',
  critical: '0.05',
  warning: '0.02',
  service: 'cloud-storage-service',
});

rolloutMonitor('graphql-soup-operation-latency-p95', {
  name: '[PROD] GraphQL soup: {{resource_name.name}} p95 latency high',
  type: 'query alert',
  query: `percentile(last_30m):p95:trace.Internal{${GRAPHQL_OPERATIONS}} by {resource_name} > 3`,
  description:
    'p95 execution time of GraphQL operation `{{resource_name.name}}` is above {{threshold}}s over 30 minutes. The endpoint p95 mixes every operation, so one slow resolver shows up here first.',
  critical: '3',
  warning: '2',
  service: 'cloud-storage-service',
});

rolloutMonitor('graphql-soup-resolver-error-logs', {
  name: '[PROD] GraphQL soup: {{[@graphql.resource].name}} resolver error logs high',
  type: 'log alert',
  query:
    'logs("service:cloud-storage-service env:prod status:error \\"graphql resolver error\\"").index("*").rollup("count").by("@graphql.resource").last("15m") > 50',
  description:
    'cloud-storage-service logged {{value}} "graphql resolver error" lines for `{{[@graphql.resource].name}}` in 15 minutes. Each response logs at most 10 errors; group by `@graphql.error.path` to find the resolver.',
  critical: '50',
  warning: '20',
  service: 'cloud-storage-service',
});

// Anonymous callers are collapsed into one resource per operation type, so a
// surge here is likely probing (S5). There is no baseline before #7911; retune
// after its first day.
rolloutMonitor('graphql-soup-unauthenticated-mutations', {
  name: '[PROD] GraphQL soup: unauthenticated mutations',
  type: 'query alert',
  query:
    'sum(last_15m):sum:trace.Internal.hits{service:cloud-storage-service,env:prod,resource_name:graphql.mutation.unauthenticated}.as_count() > 50',
  description:
    'cloud-storage-service received {{value}} GraphQL mutations without a signed-in user in 15 minutes. Check the caller IPs on the `graphql.mutation.unauthenticated` spans.',
  critical: '50',
  warning: '20',
  service: 'cloud-storage-service',
});

// Volume. There is no rate limit on the endpoint, so a client retry loop or
// reconnect herd shows up here before it shows up as errors.
rolloutMonitor('graphql-soup-request-volume', {
  name: '[PROD] GraphQL soup: request volume surge',
  type: 'query alert',
  query: `sum(last_15m):sum:trace.http.server.request.hits{${GRAPHQL}}.as_count() > 15000`,
  description:
    'POST /dss/items/soup/graphql received {{value}} requests in 15 minutes (pre-rollout max was 3,841). Check for a client retry loop before scaling.',
  critical: '15000',
  warning: '8000',
  service: 'cloud-storage-service',
});

rolloutMonitor('graphql-soup-websocket-surge', {
  name: '[PROD] GraphQL soup: websocket upgrade surge',
  type: 'query alert',
  query: `sum(last_15m):sum:trace.http.server.request.hits{${GRAPHQL_WS}}.as_count() > 300`,
  description:
    'GraphQL websocket upgrades reached {{value}} in 15 minutes (pre-rollout max was 168). A spike after a deploy or network blip is a reconnect herd.',
  critical: '300',
  warning: '150',
  service: 'cloud-storage-service',
});

// Document storage service capacity.
rolloutMonitor('graphql-soup-dss-cpu', {
  name: '[PROD] GraphQL soup: cloud-storage-service CPU high',
  type: 'query alert',
  query: `avg(last_15m):avg:aws.ecs.service.cpuutilization{${DSS}} > 60`,
  description:
    'cloud-storage-service CPU is above {{threshold}}% (pre-rollout max was 15%).',
  critical: '60',
  warning: '40',
  service: 'cloud-storage-service',
});

rolloutMonitor('graphql-soup-dss-memory', {
  name: '[PROD] GraphQL soup: cloud-storage-service memory high',
  type: 'query alert',
  query: `avg(last_15m):avg:aws.ecs.service.memory_utilization{${DSS}} > 70`,
  description:
    'cloud-storage-service memory is above {{threshold}}% (pre-rollout max was 41%). GraphQL request bodies are unbounded, so check for oversized requests.',
  critical: '70',
  warning: '50',
  service: 'cloud-storage-service',
});

// Each task opens its own DB pool, so a scale-out also eats DB connection
// headroom. It scaled to 7 once in the pre-rollout week.
rolloutMonitor('graphql-soup-dss-tasks', {
  name: '[PROD] GraphQL soup: cloud-storage-service scaled out',
  type: 'query alert',
  query: `max(last_15m):avg:aws.ecs.service.running{${DSS}} >= 6`,
  description:
    'cloud-storage-service is running {{value}} tasks (normal is 3). Check macro-db-prod connections: each task adds a connection pool.',
  critical: '6',
  warning: '5',
  service: 'cloud-storage-service',
});

// Breached in one incident during the pre-rollout week (max 335 in 15 minutes).
rolloutMonitor('graphql-soup-dss-5xx', {
  name: '[PROD] GraphQL soup: cloud-storage-service target group 5xx',
  type: 'query alert',
  query: `sum(last_15m):sum:aws.applicationelb.httpcode_target_5xx{${DSS_TARGET_GROUP}}.as_count() > 25`,
  description:
    'cloud-storage-service returned {{value}} 5xx responses through the ALB in 15 minutes (normal median 0).',
  critical: '25',
  warning: '10',
  service: 'cloud-storage-service',
  severe: true,
});

// Database. About 2,100 connections are available at 7 DSS tasks.
rolloutMonitor('graphql-soup-db-connections', {
  name: '[PROD] GraphQL soup: macro-db-prod connections high',
  type: 'query alert',
  query:
    'avg(last_15m):avg:aws.rds.database_connections{name:macro-db-prod} > 1400',
  description:
    'macro-db-prod has {{value}} connections (pre-rollout max was 968). Headroom runs out around 2,100.',
  critical: '1400',
  warning: '1100',
  service: 'macro-db-prod',
  severe: true,
});

rolloutMonitor('graphql-soup-db-cpu', {
  name: '[PROD] GraphQL soup: macro-db-prod CPU high',
  type: 'query alert',
  query: 'avg(last_15m):avg:aws.rds.cpuutilization{name:macro-db-prod} > 70',
  description:
    'macro-db-prod CPU is above {{threshold}}% (pre-rollout max was 26%).',
  critical: '70',
  warning: '50',
  service: 'macro-db-prod',
});

// Load balancer. The gateway ALB is shared by every prod-gateway service and
// there is no per-route size metric, so these only catch large shifts.
rolloutMonitor('graphql-soup-alb-bytes', {
  name: '[PROD] GraphQL soup: prod-gateway-alb processed bytes surge',
  type: 'query alert',
  query: `sum(last_15m):sum:aws.applicationelb.processed_bytes{${GATEWAY_ALB}}.as_count() > 3000000000`,
  description:
    'prod-gateway-alb processed {{value}} bytes in 15 minutes (pre-rollout max was 1.9 GB). GraphQL request bodies are unbounded.',
  critical: '3000000000',
  warning: '1500000000',
  service: 'prod-gateway-alb',
});

rolloutMonitor('graphql-soup-alb-connections', {
  name: '[PROD] GraphQL soup: prod-gateway-alb active connections high',
  type: 'query alert',
  query: `avg(last_15m):sum:aws.applicationelb.active_connection_count{${GATEWAY_ALB}}.as_count() > 6000`,
  description:
    'prod-gateway-alb active connections are at {{value}} (pre-rollout max was 2,922). Long-lived GraphQL websockets hold connections for up to the 3,600s idle timeout.',
  critical: '6000',
  warning: '4000',
  service: 'prod-gateway-alb',
});

// Browser OTel is gated by `enable-browser-otel`, so volume is low; this only
// catches a large cache failure among users who have it.
rolloutMonitor('graphql-soup-web-cache-logs', {
  name: '[PROD] GraphQL soup: web-app graphql-cache error logs',
  type: 'log alert',
  query:
    'logs("service:web-app status:error graphql-cache").index("*").rollup("count").last("15m") > 150',
  description:
    'web-app logged {{value}} graphql-cache errors in 15 minutes. See the PostHog dashboard for the full browser view.',
  critical: '150',
  warning: '75',
  service: 'web-app',
});
