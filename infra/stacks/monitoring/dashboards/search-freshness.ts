// Search freshness: how far behind the live search indexer is, what it lost,
// and what producers published. It has no monitors yet.
//
// It reads the OTel metrics search-processing-service records in
// services/search_processing_service/src/inbound/kafka_consumer/metrics.rs,
// and the publish counter crates/macro_event_broker records in every service
// that publishes events. Their names and tags are this file's contract;
// renaming one there silently empties its widgets.
//
// - `search.index.lag_ms`: ms from the record's Kafka timestamp, set when it was
//   published, to the end of its processing (histogram), tagged `entity_type`, `event_type` (the wire
//   type, e.g. `email.message_received`) and `outcome` (`indexed`, `ignored`,
//   `dropped`, `coalesced`, `no_index_change`). Freshness reads
//   `outcome:indexed`. It covers processed events only: a stalled consumer
//   records nothing here.
// - `search.index.oldest_pending_ms`: per assigned `topic` and `partition`, ms
//   since the oldest record not yet processed was recorded, 0 when caught up
//   (gauge, refreshed every 10 s). It keeps rising during a stall. Each task
//   reports only its own partitions, and a partition that moves stops
//   reporting within 30 s, so it is read with `max`.
// - `search.index.dropped_events`: events committed without reaching the
//   index (counter), tagged `entity_type`, plus `event_type` when dropped after
//   their processing retries, or `failure` (`undecodable`, `cut_off_at_stop`,
//   `not_rewound`, `rewind_unconfirmed`, `queued_at_error_exit`) for records
//   lost outside the workers.
// - `event_broker.publishes`: events handed to the broker (counter), tagged
//   `topic`, `event_type` (the payload's tag, e.g. `email.message_received`;
//   absent for the calendar topic, whose events carry no tag) and `outcome`
//   (`published`, `failed`, `timed_out`, `unserializable`).
//
// All are exported every 60 s, and percentiles are not enabled on the lag
// histogram, so it is graphed by max and count.
import * as datadog from '@pulumi/datadog';
import { graphGroup } from '../prod-monitor';

const INDEXER = 'env:$env.value,service:search-processing-service';
const PUBLISHERS = 'env:$env.value';
const MS_TO_S = ' / 1000';

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
      'How far behind the live search indexer is, what it dropped, and what producers published. Declared in infra/stacks/monitoring/dashboards/search-freshness.ts, whose header lists the metrics and tags.',
    layoutType: 'ordered',
    templateVariables: [{ name: 'env', prefix: 'env', default: 'prod' }],
    widgets: [
      graphGroup('Behind', [
        lines(
          'Oldest unprocessed record by entity type (s)',
          `max:search.index.oldest_pending_ms{${INDEXER}} by {entity_type}${MS_TO_S}`,
          TARGETS
        ),
        toplist(
          'Partitions furthest behind now (s)',
          `top(max:search.index.oldest_pending_ms{${INDEXER}} by {topic,partition}${MS_TO_S}, 10, 'last', 'desc')`
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
          'Failed publishes by service and topic',
          `default_zero(sum:event_broker.publishes{${PUBLISHERS},!outcome:published} by {service,topic,outcome}.as_count())`
        ),
      ]),
      graphGroup('Published', [
        bars(
          'Email events published by event type',
          `sum:event_broker.publishes{${PUBLISHERS},topic:macro.email,outcome:published} by {event_type}.as_count()`
        ),
        bars(
          'Events published by topic',
          `sum:event_broker.publishes{${PUBLISHERS},outcome:published} by {topic}.as_count()`
        ),
      ]),
    ],
  }
);
