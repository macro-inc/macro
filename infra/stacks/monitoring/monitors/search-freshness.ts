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
//   `entity_type`, `event_type` (the wire type, e.g. `email.message_received`),
//   `outcome` (`indexed`, `ignored`, `dropped`, `coalesced`,
//   `no_index_change`, `retry_queued`, `failed`, `source_missing`) and
//   `delivery` (`kafka`, or `sqs_replay` for a replay, whose lag still counts
//   from the original record). Freshness reads `outcome:indexed`;
//   `retry_queued` marks an event that will be late. It covers processed
//   events only: a stalled consumer records nothing here.
// - `search.index.oldest_pending_ms`: per assigned `topic` and `partition`, ms
//   since the oldest record not yet processed was recorded, 0 when caught up
//   (gauge, refreshed every 10 s). It keeps rising during a stall. Each task
//   reports only its own partitions, and a partition that moves stops
//   reporting within 30 s, so it is read with `max`, and with `.fill(null)` so
//   Datadog does not interpolate a stopped sampler's last reading.
// - `search.index.dropped_events`: events committed without reaching the
//   index (counter), tagged `entity_type`. Events dropped after their
//   attempts and replay also carry `event_type`, `delivery` (`kafka` or
//   `sqs_replay`) and the last attempt's `failure` (`bulk_items`,
//   `overloaded`, `source_missing`, `error`); records lost outside the
//   workers carry `failure` (`undecodable`, `cut_off_at_stop`, `not_rewound`,
//   `rewind_unconfirmed`, `queued_without_rewind`).
// - `search.index.failed_bulk_items`: items OpenSearch failed inside a
//   `_bulk` response in the last attempt of an event queued for a replay or
//   dropped (counter), tagged `entity_type`, `outcome` and that attempt's
//   `failure`: `overloaded` when it refused items to protect itself (a 429
//   per item), `bulk_items` when it failed them otherwise. Only bulk writes
//   report items (documents, email messages, call segments, chat repair);
//   a refusal of the whole request, and single-document writes, count none.
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
// - `search.freshness.probe_seconds`: seconds from a write the API
//   acknowledged to the first search that showed it (histogram), recorded by
//   services/search_freshness_probe in src/outbound/metrics.rs. The probe acts
//   as its own user through the public gateway, one round a minute per kind
//   of round, by `entity_type` (`document`, `message`, `project`, `property`,
//   `agent_session`, `call`), tagged `operation` (`create`, `edit`,
//   `rename`, `delete`, and `crowded_prefix`: a document found by a crowded
//   prefix alone, which only a search expanding every match finds). Searches
//   come every second for the first minute,
//   then every 5 s; a round gives up at 300 s, or after 30 s of failed
//   searches. Search hides a deleted entity through its database check, so a
//   delete round measures that, not the index.
// - `search.freshness.probe_rounds`: finished probe rounds (counter), tagged
//   `entity_type`, `operation` and `outcome` (`seen` within 60 s, `late`
//   after it, `unseen` at 300 s, the probe's own failures `write_failed`
//   and `search_failed`, and `fixture_missing` for a type whose fixture is
//   not seeded yet, which probed nothing and no monitor counts).
//
// All are exported every 60 s, and percentiles are not enabled on the
// histograms, so they are graphed by max and count. The probe records one
// round a minute per entity type and operation, so its max over a minute is
// that round.
//
// The monitors judge the backlog, not the lag of processed events, so a stall
// fires them. The email topic carries mailbox imports beside live mail, on the
// same partitions, so it is judged on the bulk thresholds until live mail has
// a path of its own; every other topic is live. Each monitor takes one window
// for both its warning and its alert, as the other monitors in this stack do:
// the live backlog warns at 30 s over the alert's five minutes. The retention
// monitors repeat each topic's retention from
// infra/stacks/kafka-cluster/topics.ts (7 days for every topic);
// change them together.
import * as datadog from '@pulumi/datadog';
import { graphGroup, prodMonitor, thresholdGraph } from '../prod-monitor';

const SERVICE = 'search-processing-service';
const PROBE_SERVICE = 'search-freshness-probe';
const PROBE = `env:$env.value,service:${PROBE_SERVICE}`;
const PROD_PROBE = `env:prod,service:${PROBE_SERVICE}`;
const INDEXER = `env:$env.value,service:${SERVICE}`;
const PROD = `env:prod,service:${SERVICE}`;
const PUBLISHERS = 'env:$env.value';
const MS_TO_S = ' / 1000';
const RUNBOOK = 'docs/runbooks/search-freshness.md';

const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const EMAIL = 'topic:macro.email';

/** The oldest pending record in prod, per `by` if given, in `divisor` units. */
function pending(filter: string, by: string | null, divisor: number): string {
  const groups = by === null ? '' : ` by {${by}}`;
  return `max:search.index.oldest_pending_ms{${PROD},${filter}}${groups}.fill(null) / ${divisor}`;
}

const LIVE_BACKLOG = pending(`!${EMAIL}`, 'entity_type', 1000);
// One alert for the whole topic, its worst partition: an email backlog spans
// many partitions at once, and each group of a monitor posts on its own.
const EMAIL_BACKLOG = pending(EMAIL, null, MS_PER_HOUR);
const EMAIL_RETENTION = pending(EMAIL, null, MS_PER_DAY);
const LIVE_RETENTION = pending(`!${EMAIL}`, 'topic', MS_PER_DAY);
const DROPPED = `sum:search.index.dropped_events{${PROD}} by {entity_type}.as_count()`;
// Failed items per 5 minutes, a missing bucket read as none. The monitor wants
// every bucket of half an hour to have some: a burst, such as a drain's 429s
// that the replays absorb, comes and goes inside that. It reads the rate, a
// bucket's average times its 300 s: a monitor over `.as_count()` takes only
// `sum`, which would fire on one burst. It evaluates 7 minutes late, so the
// newest bucket is complete: an unfinished one reads as none and would
// recover the alert every 5 minutes.
const FAILED_ITEMS = `default_zero(sum:search.index.failed_bulk_items{${PROD}} by {entity_type,failure}.as_rate().rollup(avg, 300)) * 300`;
const OFFSET_RESETS = `sum:kafka.consumer.offset_resets{${PROD}} by {topic}.as_count()`;
// Per lane: each task reads email and the live topics on separate consumers,
// and one that stops reporting must not hide behind the other's readings.
const LIVE_READINGS = `max:search.index.oldest_pending_ms{${PROD},!${EMAIL}}.fill(null)`;
const EMAIL_READINGS = `max:search.index.oldest_pending_ms{${PROD},${EMAIL}}.fill(null)`;
// Late and unseen are counted, not timed: a slow round records its seconds
// only when it ends, so slow rounds leave the minutes between them empty.
// They judge each entity type's rotation rounds together, one a minute,
// since a type's operations take turns and alone would be too few rounds to
// judge. The crowded-prefix round is a recall check, not a freshness one, so
// it is judged apart.
const ROTATION = '!operation:crowded_prefix';
const CROWDED_PREFIX = 'operation:crowded_prefix';
const PROBE_LATE = `sum:search.freshness.probe_rounds{${PROD_PROBE},${ROTATION},outcome:late} by {entity_type}.as_count()`;
const PROBE_UNSEEN = `sum:search.freshness.probe_rounds{${PROD_PROBE},${ROTATION},outcome:unseen} by {entity_type}.as_count()`;
const PROBE_PREFIX_UNSEEN = `sum:search.freshness.probe_rounds{${PROD_PROBE},${CROWDED_PREFIX},outcome:unseen} by {entity_type}.as_count()`;
// The failing share is per operation: documents have two kinds of round, and
// a failure of one would sit at half the share and never pass it.
// A round skipped because its fixture is not seeded yet (`fixture_missing`)
// probed nothing, so it counts neither as a failure nor in the share.
const PROBE_FAILING = `sum:search.freshness.probe_rounds{${PROD_PROBE},!outcome:seen,!outcome:late,!outcome:unseen,!outcome:fixture_missing} by {entity_type,operation}.as_count()`;
const PROBE_PROBED = `sum:search.freshness.probe_rounds{${PROD_PROBE},!outcome:fixture_missing} by {entity_type,operation}.as_count()`;
const PROBE_ROUNDS = `sum:search.freshness.probe_rounds{${PROD_PROBE}} by {entity_type}.as_count()`;

// The probe runs in prod only once RUNS_IN_PROD is set in
// infra/stacks/search-freshness-probe/service.ts. Until then a heartbeat
// would report it silent every hour, so it is declared only from then; the
// other probe monitors stay quiet without data.
const PROBE_RUNS_IN_PROD = false;

const TITLES = {
  liveBacklog: 'Search indexing behind on live changes',
  emailBacklog: 'Search indexing of email far behind',
  emailRetention: 'Search email backlog within a day of Kafka retention',
  liveRetention: 'Search backlog within a day of Kafka retention',
  dropped: 'Search events committed without reaching the index',
  failedItems: 'Search bulk index writes keep failing items',
  offsetReset: 'Search indexer reset a Kafka position after an error',
  silent: 'Search indexer reports no live backlog readings',
  emailSilent: 'Search indexer reports no email backlog readings',
  probeLate: 'Search shows changes late end to end',
  probeUnseen: 'Search never showed probe changes',
  probePrefixUnseen: 'Search content prefix search drops matches',
  probeFailing: 'Search freshness probe cannot write or search',
  probeSilent: 'Search freshness probe reports no rounds',
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
          critical: '6',
          warning: '5',
        }),
        thresholdGraph({
          title: TITLES.liveRetention,
          query: LIVE_RETENTION,
          critical: '6',
          warning: '5',
        }),
        thresholdGraph({
          title: TITLES.failedItems,
          query: `moving_rollup(${FAILED_ITEMS}, 1800, 'min')`,
          critical: '0',
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
          query: LIVE_READINGS,
          critical: '0',
        }),
        thresholdGraph({
          title: TITLES.emailSilent,
          query: EMAIL_READINGS,
          critical: '0',
        }),
      ]),
      graphGroup('Probe monitors (prod)', [
        thresholdGraph({
          title: TITLES.probeLate,
          query: `${PROBE_LATE}.rollup(sum, 900)`,
          critical: '3',
        }),
        thresholdGraph({
          title: TITLES.probeUnseen,
          query: `${PROBE_UNSEEN}.rollup(sum, 1800)`,
          critical: '2',
        }),
        thresholdGraph({
          title: TITLES.probePrefixUnseen,
          query: `${PROBE_PREFIX_UNSEEN}.rollup(sum, 1800)`,
          critical: '2',
        }),
        thresholdGraph({
          title: TITLES.probeFailing,
          query: `${PROBE_FAILING}.rollup(sum, 900) / ${PROBE_PROBED}.rollup(sum, 900)`,
          critical: '0.5',
        }),
        thresholdGraph({
          title: TITLES.probeSilent,
          query: `${PROBE_ROUNDS}.rollup(sum, 600)`,
          critical: '1',
        }),
      ]),
      graphGroup('End to end', [
        lines(
          'Seconds until search showed a probe change, by entity type',
          `max:search.freshness.probe_seconds{${PROBE}} by {entity_type}.fill(null)`,
          TARGETS
        ),
        lines(
          'Seconds until search showed a probe change, by operation',
          `max:search.freshness.probe_seconds{${PROBE}} by {entity_type,operation}.fill(null)`,
          TARGETS
        ),
        bars(
          'Probe rounds by outcome',
          `sum:search.freshness.probe_rounds{${PROBE}} by {entity_type,outcome}.as_count()`
        ),
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
          'Failed bulk items by entity type, failure and outcome',
          `default_zero(sum:search.index.failed_bulk_items{${INDEXER}} by {entity_type,failure,outcome}.as_count())`
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
    "For 15 minutes, the oldest email event not yet indexed has been older than the threshold, in hours, on macro.email's worst partition (the dashboard's partition list shows which). Mailbox imports share each mailbox's partition with its live mail, so new mail there waits behind them.",
  dashboard,
  runbook: `${RUNBOOK}#email-backlog`,
});

prodMonitor('search-email-near-retention', {
  title: TITLES.emailRetention,
  service: SERVICE,
  query: `max(last_5m):${EMAIL_RETENTION} > 6`,
  monitorThresholds: { critical: '6', warning: '5' },
  pages: false,
  description:
    "The oldest email event not yet indexed, on macro.email's worst partition, is older than the threshold, in days. The topic keeps events for 7 days; past that the indexer skips straight to the newest and the events between are lost.",
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

prodMonitor('search-failed-bulk-items', {
  title: TITLES.failedItems,
  service: SERVICE,
  query: `min(last_30m):${FAILED_ITEMS} > 0`,
  monitorThresholds: { critical: '0' },
  pages: false,
  description:
    'For 30 minutes, OpenSearch has failed items of {{entity_type.name}} bulk index writes in every 5 minutes, for the reason {{failure.name}}: overloaded when it keeps refusing them to protect itself, bulk_items when it fails them otherwise. Those changes wait for a replay and reach search late, or not at all once their replay fails too.',
  dashboard,
  runbook: `${RUNBOOK}#failed-bulk-items`,
  alertDetail: '{{value}} items in the quietest 5 minutes',
  recoveryDetail: '{{value}} items in the quietest 5 minutes',
  evaluationDelay: 420,
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
  query: `max(last_5m):${LIVE_READINGS} < 0`,
  monitorThresholds: { critical: '0' },
  pages: false,
  description:
    "No indexer task has reported a backlog reading for the live topics (every topic but macro.email) for 10 minutes: the live lane's consumer is down, not running, or not exporting metrics. Its lag is unknown, not zero.",
  dashboard,
  runbook: `${RUNBOOK}#no-readings`,
  noDataTimeframe: 10,
});

prodMonitor('search-email-indexer-silent', {
  title: TITLES.emailSilent,
  service: SERVICE,
  query: `max(last_5m):${EMAIL_READINGS} < 0`,
  monitorThresholds: { critical: '0' },
  pages: false,
  description:
    "No indexer task has reported a backlog reading for macro.email for 10 minutes: the email lane's consumer is down, not running, or not exporting metrics. Its lag is unknown, not zero.",
  dashboard,
  runbook: `${RUNBOOK}#no-readings`,
  noDataTimeframe: 10,
});

prodMonitor('search-probe-late', {
  title: TITLES.probeLate,
  service: PROBE_SERVICE,
  query: `sum(last_15m):${PROBE_LATE} >= 3`,
  monitorThresholds: { critical: '3' },
  pages: false,
  description:
    "In the last 15 minutes, search showed at least the threshold's number of the probe's {{entity_type.name}} changes only after 60 s, measured from the API acknowledging the write. Users see their {{entity_type.name}} changes in search that late.",
  alertDetail: '{{value}} rounds',
  recoveryDetail: '{{value}} rounds',
  dashboard,
  runbook: `${RUNBOOK}#probe-late`,
});

prodMonitor('search-probe-unseen', {
  title: TITLES.probeUnseen,
  service: PROBE_SERVICE,
  query: `sum(last_30m):${PROBE_UNSEEN} >= 2`,
  monitorThresholds: { critical: '2' },
  pages: false,
  description:
    "In the last 30 minutes, search still did not show the probe's {{entity_type.name}} change five minutes after the write, more than once. A change that never shows is a freshness miss. An unseen round lasts five minutes, so a type has at most six in the window.",
  dashboard,
  runbook: `${RUNBOOK}#probe-unseen`,
  alertDetail: '{{value}} rounds',
  recoveryDetail: '{{value}} rounds',
});

prodMonitor('search-probe-prefix-unseen', {
  title: TITLES.probePrefixUnseen,
  service: PROBE_SERVICE,
  query: `sum(last_30m):${PROBE_PREFIX_UNSEEN} >= 2`,
  monitorThresholds: { critical: '2' },
  pages: false,
  description:
    "In the last 30 minutes, the probe's crowded_prefix round missed its {{entity_type.name}} more than once: a partial search for con alone did not find the probe's new document, one word that sorts late under con. If the other document rounds pass, content prefix search is dropping matches, likely through a prefix expansion capped per shard, and users miss results for short prefixes; if they miss too, documents are not reaching the index. An unseen round lasts five minutes, so there are at most six in the window.",
  dashboard,
  runbook: `${RUNBOOK}#probe-prefix-unseen`,
  alertDetail: '{{value}} rounds',
  recoveryDetail: '{{value}} rounds',
});

prodMonitor('search-probe-failing', {
  title: TITLES.probeFailing,
  service: PROBE_SERVICE,
  query: `sum(last_15m):${PROBE_FAILING} / ${PROBE_PROBED} > 0.5`,
  monitorThresholds: { critical: '0.5' },
  pages: false,
  description:
    "More than half of the probe's {{entity_type.name}} {{operation.name}} rounds in 15 minutes failed to write or to search; a round ends as a search failure after 30 s of failed searches, so a search outage fails one a minute. Freshness of {{entity_type.name}} is not measured while it lasts.",
  dashboard,
  runbook: `${RUNBOOK}#probe-failing`,
  alertDetail: '{{value}} of rounds',
  recoveryDetail: '{{value}} of rounds',
});

if (PROBE_RUNS_IN_PROD) {
  prodMonitor('search-probe-silent', {
    title: TITLES.probeSilent,
    service: PROBE_SERVICE,
    query: `sum(last_10m):${PROBE_ROUNDS} < 1`,
    monitorThresholds: { critical: '1' },
    pages: false,
    description:
      'The probe has finished no {{entity_type.name}} round for 10 minutes: it is down, stuck, or not exporting metrics. End-to-end freshness is unknown, not good.',
    dashboard,
    runbook: `${RUNBOOK}#probe-silent`,
    noDataTimeframe: 10,
  });
}
