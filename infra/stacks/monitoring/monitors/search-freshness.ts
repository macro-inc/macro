// Search freshness: how far behind the live search indexer is, what it lost,
// and what producers published, with the monitors that post to the Alerts
// channel. None of them pages.
//
// It reads the OTel metrics search-processing-service records in
// services/search_processing_service/src/inbound/kafka_consumer/metrics.rs,
// the offset reset counter crates/kafka_util records for every consumer, and
// the publish counter crates/macro_event_broker records in every service that
// publishes events. Their names and tags are this file's contract; renaming
// one there silently empties its widgets and turns its monitor into missing
// data.
//
// - `search.index.lag_ms`: ms from the record's Kafka timestamp, set when it
//   was published, to the end of its processing (histogram), tagged
//   `entity_type`, `event_type` (the wire type, e.g. `email.message_received`)
//   and `outcome` (`indexed`, `ignored`, `dropped`, `coalesced`,
//   `no_index_change`). Freshness reads `outcome:indexed`. It covers processed
//   events only: a stalled consumer records nothing here.
// - `search.index.oldest_pending_ms`: per assigned `topic` and `partition`, ms
//   since the oldest record not yet processed was recorded, 0 when caught up
//   (gauge, refreshed every 10 s). It keeps rising during a stall. Each task
//   reports only its own partitions, and a partition that moves stops
//   reporting within 30 s, so it is read with `max`, and with `.fill(null)` so
//   Datadog does not interpolate a stopped sampler's last reading.
// - `search.index.dropped_events`: events committed without reaching the
//   index (counter), tagged `entity_type`. Events dropped after their
//   processing retries also carry `event_type`; records lost outside the
//   workers carry `failure` (`undecodable`, `cut_off_at_stop`, `not_rewound`,
//   `rewind_unconfirmed`, `queued_without_rewind`).
// - `kafka.consumer.offset_resets`: partition positions librdkafka reset after
//   an error (counter), tagged `topic`. Usually the position was out of range,
//   older than the topic's retention, and the consumer moved to the newest
//   event, skipping everything between. librdkafka only logs it, and no
//   librdkafka log line from the indexer reaches Datadog.
// - `event_broker.publishes`: events handed to the broker (counter), tagged
//   `topic`, `event_type` (the payload's tag, e.g. `email.message_received`;
//   absent for the calendar topic, whose events carry no tag) and `outcome`
//   (`published`, `failed`, `timed_out`, `unserializable`, `cancelled`).
//
// All are exported every 60 s, and percentiles are not enabled on the lag
// histogram, so it is graphed by max and count.
//
// The monitors judge the backlog, not the lag of processed events, so a stall
// fires them. The email topic carries mailbox imports beside live mail, on the
// same partitions, so it is judged on the bulk thresholds until live mail has
// a path of its own; every other topic is live. Each monitor takes one window
// for both its warning and its alert, as the other monitors in this stack do:
// the live backlog warns at 30 s over the alert's five minutes. The retention
// monitors repeat each topic's retention from
// infra/stacks/kafka-cluster/topics.ts (email 10 days in prod, the others 7);
// change them together.
import * as datadog from '@pulumi/datadog';
import { graphGroup, prodMonitor, thresholdGraph } from '../prod-monitor';

const SERVICE = 'search-processing-service';
const INDEXER = `env:$env.value,service:${SERVICE}`;
const PROD = `env:prod,service:${SERVICE}`;
const PUBLISHERS = 'env:$env.value';
const MS_TO_S = ' / 1000';
const RUNBOOK = 'docs/runbooks/search-freshness.md';

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const EMAIL = 'topic:macro.email';

/** The oldest pending record in prod, per `by`, in `divisor` units. */
function pending(filter: string, by: string, divisor: number): string {
  return `max:search.index.oldest_pending_ms{${PROD},${filter}} by {${by}}.fill(null) / ${divisor}`;
}

const LIVE_BACKLOG = pending(`!${EMAIL}`, 'entity_type', 1000);
const EMAIL_BACKLOG = pending(EMAIL, 'partition', MS_PER_HOUR);
const EMAIL_RETENTION = pending(EMAIL, 'partition', MS_PER_DAY);
const LIVE_RETENTION = pending(`!${EMAIL}`, 'topic', MS_PER_DAY);
const DROPPED = `sum:search.index.dropped_events{${PROD}} by {entity_type}.as_count()`;
const OFFSET_RESETS = `sum:kafka.consumer.offset_resets{${PROD}} by {topic}.as_count()`;
const READINGS = `max:search.index.oldest_pending_ms{${PROD}}.fill(null)`;

const TITLES = {
  liveBacklog: 'Search indexing behind on live changes',
  emailBacklog: 'Search indexing of email far behind',
  emailRetention: 'Search email backlog within a day of Kafka retention',
  liveRetention: 'Search backlog within a day of Kafka retention',
  dropped: 'Search events committed without reaching the index',
  offsetReset: 'Search indexer reset a Kafka position after an error',
  silent: 'Search indexer reports no backlog readings',
};

const TARGETS: datadog.types.input.DashboardWidgetTimeseriesDefinitionMarker[] =
  [
    { label: '60 s', value: 'y = 60', displayType: 'warning dashed' },
    { label: '5 min', value: 'y = 300', displayType: 'error dashed' },
  ];

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

function bars(title: string, q: string): datadog.types.input.DashboardWidget {
  return {
    timeseriesDefinition: {
      title,
      showLegend: true,
      requests: [{ q, displayType: 'bars' }],
    },
  };
}

function toplist(
  title: string,
  q: string
): datadog.types.input.DashboardWidget {
  return { toplistDefinition: { title, requests: [{ q }] } };
}

export const searchFreshnessDashboard = new datadog.Dashboard(
  'search-freshness',
  {
    title: 'Search freshness',
    description:
      'How far behind the live search indexer is, what it dropped, and what producers published, with the graphs of the search freshness monitors. Declared in infra/stacks/monitoring/monitors/search-freshness.ts, whose header lists the metrics and tags; see docs/runbooks/search-freshness.md.',
    layoutType: 'ordered',
    templateVariables: [{ name: 'env', prefix: 'env', default: 'prod' }],
    widgets: [
      graphGroup('Monitors (prod)', [
        thresholdGraph({
          title: TITLES.liveBacklog,
          query: LIVE_BACKLOG,
          critical: '60',
          warning: '30',
        }),
        thresholdGraph({
          title: TITLES.emailBacklog,
          query: EMAIL_BACKLOG,
          critical: '24',
          warning: '6',
        }),
        thresholdGraph({
          title: TITLES.emailRetention,
          query: EMAIL_RETENTION,
          critical: '9',
          warning: '8',
        }),
        thresholdGraph({
          title: TITLES.liveRetention,
          query: LIVE_RETENTION,
          critical: '6',
          warning: '5',
        }),
        thresholdGraph({
          title: TITLES.dropped,
          query: `${DROPPED}.rollup(sum, 900)`,
          critical: '0',
        }),
        thresholdGraph({
          title: TITLES.offsetReset,
          query: `${OFFSET_RESETS}.rollup(sum, 600)`,
          critical: '0',
        }),
        thresholdGraph({
          title: TITLES.silent,
          query: READINGS,
          critical: '0',
        }),
      ]),
      graphGroup('Behind', [
        lines(
          'Oldest unprocessed record by entity type (s)',
          `max:search.index.oldest_pending_ms{${INDEXER}} by {entity_type}.fill(null)${MS_TO_S}`,
          TARGETS
        ),
        toplist(
          'Partitions furthest behind now (s)',
          `top(max:search.index.oldest_pending_ms{${INDEXER}} by {topic,partition}.fill(null)${MS_TO_S}, 10, 'last', 'desc')`
        ),
        lines(
          'Longest lag of an indexed event by entity type (s)',
          `max:search.index.lag_ms{${INDEXER},outcome:indexed} by {entity_type}${MS_TO_S}`,
          TARGETS
        ),
        lines(
          'Longest lag of an indexed email event by event type (s)',
          `max:search.index.lag_ms{${INDEXER},outcome:indexed,entity_type:email} by {event_type}${MS_TO_S}`,
          TARGETS
        ),
      ]),
      graphGroup('Processed and lost', [
        bars(
          'Events processed by outcome',
          `count:search.index.lag_ms{${INDEXER}} by {outcome}.as_count()`
        ),
        bars(
          'Dropped events by entity type',
          `default_zero(sum:search.index.dropped_events{${INDEXER}} by {entity_type,failure}.as_count())`
        ),
        bars(
          'Offset resets by topic',
          `default_zero(sum:kafka.consumer.offset_resets{${INDEXER}} by {topic}.as_count())`
        ),
        bars(
          'Failed publishes by service and topic',
          `default_zero(sum:event_broker.publishes{${PUBLISHERS},!outcome:published} by {service,topic,outcome}.as_count())`
        ),
      ]),
      graphGroup('Published', [
        bars(
          'Email events published by event type',
          `sum:event_broker.publishes{${PUBLISHERS},${EMAIL},outcome:published} by {event_type}.as_count()`
        ),
        bars(
          'Events published by topic',
          `sum:event_broker.publishes{${PUBLISHERS},outcome:published} by {topic}.as_count()`
        ),
      ]),
    ],
  }
);

const dashboard = searchFreshnessDashboard.url;

prodMonitor('search-live-backlog', {
  title: TITLES.liveBacklog,
  service: SERVICE,
  query: `min(last_5m):${LIVE_BACKLOG} > 60`,
  monitorThresholds: { critical: '60', warning: '30' },
  pages: false,
  description:
    'For five minutes, the oldest {{entity_type.name}} change not in search yet has been older than the threshold, in seconds. New {{entity_type.name}} changes are missing from search until it drains.',
  dashboard,
  runbook: `${RUNBOOK}#live-backlog`,
});

prodMonitor('search-email-backlog', {
  title: TITLES.emailBacklog,
  service: SERVICE,
  query: `min(last_15m):${EMAIL_BACKLOG} > 24`,
  monitorThresholds: { critical: '24', warning: '6' },
  pages: false,
  description:
    'For 15 minutes, the oldest email event not yet indexed on macro.email partition {{partition.name}} has been older than the threshold, in hours. Mailbox imports share these partitions with live mail, so new mail on the partition waits behind them.',
  dashboard,
  runbook: `${RUNBOOK}#email-backlog`,
});

prodMonitor('search-email-near-retention', {
  title: TITLES.emailRetention,
  service: SERVICE,
  query: `max(last_5m):${EMAIL_RETENTION} > 9`,
  monitorThresholds: { critical: '9', warning: '8' },
  pages: false,
  description:
    'The oldest email event not yet indexed on macro.email partition {{partition.name}} is older than the threshold, in days. The topic keeps events for 10 days; past that the indexer skips straight to the newest and the events between are lost.',
  dashboard,
  runbook: `${RUNBOOK}#retention`,
});

prodMonitor('search-near-retention', {
  title: TITLES.liveRetention,
  service: SERVICE,
  query: `max(last_5m):${LIVE_RETENTION} > 6`,
  monitorThresholds: { critical: '6', warning: '5' },
  pages: false,
  description:
    'The oldest event not yet indexed on {{topic.name}} is older than the threshold, in days. The topic keeps events for 7 days; past that the indexer skips straight to the newest and the events between are lost.',
  dashboard,
  runbook: `${RUNBOOK}#retention`,
});

prodMonitor('search-dropped-events', {
  title: TITLES.dropped,
  service: SERVICE,
  query: `sum(last_15m):${DROPPED} > 0`,
  monitorThresholds: { critical: '0' },
  pages: false,
  description:
    'The indexer committed {{entity_type.name}} events in the last 15 minutes that never reached the search index: dropped after their retries, undecodable, or lost when a consumer stopped. Each is a change missing from search until it is reindexed.',
  dashboard,
  runbook: `${RUNBOOK}#dropped-events`,
  alertDetail: '{{value}} events',
  recoveryDetail: '{{value}} events',
});

prodMonitor('search-offset-reset', {
  title: TITLES.offsetReset,
  service: SERVICE,
  query: `sum(last_10m):${OFFSET_RESETS} > 0`,
  monitorThresholds: { critical: '0' },
  pages: false,
  description:
    "librdkafka reset a {{topic.name}} partition's position after an error. Usually the position was older than the topic's retention and the consumer moved to the newest event, skipping every event in between, which must be reconciled from the source. Resets that keep coming without skipping mean its offset queries fail.",
  dashboard,
  runbook: `${RUNBOOK}#offset-reset`,
  alertDetail: '{{value}} resets',
  recoveryDetail: '{{value}} resets',
});

prodMonitor('search-indexer-silent', {
  title: TITLES.silent,
  service: SERVICE,
  query: `max(last_5m):${READINGS} < 0`,
  monitorThresholds: { critical: '0' },
  pages: false,
  description:
    'No indexer task has reported a backlog reading for 10 minutes: the consumer is down, not running, or not exporting metrics. Its lag is unknown, not zero.',
  dashboard,
  runbook: `${RUNBOOK}#no-readings`,
  noDataTimeframe: 10,
});
