//! An event whose attempts all failed is queued on the search event queue and
//! applied again from its original record a minute later, through the same
//! handlers. The queue redelivers a failed replay once and then moves it to
//! its dead-letter queue, where it can be inspected and redriven.

use std::{collections::HashMap, future::Future, time::Duration};

use macro_event_broker::{MacroEventCollection as _, MessageParts};
use opentelemetry::trace::TraceContextExt as _;
use sqs_client::search::{SearchQueueMessage, replay::ReplayBrokerEvent};
use tracing::{Instrument as _, field};
use tracing_opentelemetry::OpenTelemetrySpanExt as _;

use super::{
    DeclaredMacroEvent, Delivery, EventOutcome, KafkaProcessingContext, OutcomeRecord,
    ReceivedEvent,
    attempts::{Attempted, Attempts, Exhausted, Failure},
    event_type, process_event, processing_span, record_event_identity, record_outcome,
    subscribed_topic,
};

/// How long a failed event waits before its replay. Longer than the email
/// index's refresh interval, so a delete-by-query that conflicted with a
/// write the index had not refreshed yet sees it on the replay.
pub(crate) const REPLAY_DELAY: Duration = Duration::from_secs(60);
/// The search event queue's `maxReceiveCount`
/// (`infra/stacks/search-event-queue/index.ts`): a replay that fails on this
/// delivery moves to the dead-letter queue instead of being delivered again.
pub(crate) const REPLAY_MAX_RECEIVES: u32 = 2;
/// How long a worker waits to queue a replay before dropping the event, so an
/// unreachable queue cannot hold the worker. Shorter than the drain a stop
/// allows, so a stopping worker still finishes queueing.
const REPLAY_QUEUE_TIMEOUT: Duration = Duration::from_secs(3);

/// Where events whose attempts failed wait to be applied again.
pub(crate) trait ReplayQueue: Send + Sync {
    fn replay_later(
        &self,
        replay: ReplayBrokerEvent,
        delay: Duration,
    ) -> impl Future<Output = anyhow::Result<()>> + Send;
}

impl ReplayQueue for sqs_client::SQS {
    async fn replay_later(&self, replay: ReplayBrokerEvent, delay: Duration) -> anyhow::Result<()> {
        self.send_message_to_search_event_queue_after(
            SearchQueueMessage::ReplayBrokerEvent(replay),
            delay,
        )
        .await
        .map(|_| ())
    }
}

/// The replay of `received`, whose attempts ended in `exhausted`.
pub(super) fn replay_of(received: &ReceivedEvent, exhausted: &Exhausted) -> ReplayBrokerEvent {
    ReplayBrokerEvent {
        event_id: super::event_id(&received.event).to_string(),
        topic: received.topic.to_owned(),
        partition: received.partition,
        offset: received.offset,
        key: received.key.clone(),
        payload: received.payload.clone(),
        produced_at_ms: received.produced_at_ms,
        attempts: exhausted.attempts,
        failure: <&'static str>::from(exhausted.diagnosis.failure).to_owned(),
        traceparent: current_traceparent(),
    }
}

const TRACEPARENT: &str = "traceparent";

/// The current span's W3C context, if it is being traced.
pub(super) fn current_traceparent() -> Option<String> {
    let context = tracing::Span::current().context();
    if !context.span().span_context().is_valid() {
        return None;
    }
    let mut carrier = HashMap::new();
    opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.inject_context(&context, &mut carrier);
    });
    carrier.remove(TRACEPARENT)
}

/// Parent `span` on the failed processing a replay continues.
pub(super) fn adopt_traceparent(span: &tracing::Span, traceparent: Option<&str>) {
    let Some(traceparent) = traceparent else {
        return;
    };
    let carrier = HashMap::from([(TRACEPARENT.to_owned(), traceparent.to_owned())]);
    let context = opentelemetry::global::get_text_map_propagator(|propagator| {
        propagator.extract_with_context(&opentelemetry::Context::new(), &carrier)
    });
    if context.span().span_context().is_valid() {
        let _ = span.set_parent(context);
    }
}

/// Ends the attempts of a Kafka event: a failed event is queued for its
/// replay, or dropped when that fails too.
pub(super) async fn conclude_kafka_attempts<Q: ReplayQueue>(
    received: &ReceivedEvent,
    attempted: Attempted,
    replays: &Q,
) -> OutcomeRecord {
    let exhausted = match attempted {
        Ok((handled, attempts)) => return OutcomeRecord::handled(handled, attempts),
        Err(exhausted) => exhausted,
    };
    let failure = <&'static str>::from(exhausted.diagnosis.failure);
    let queued = tokio::time::timeout(
        REPLAY_QUEUE_TIMEOUT,
        replays.replay_later(replay_of(received, &exhausted), REPLAY_DELAY),
    )
    .await
    .unwrap_or_else(|_| Err(anyhow::anyhow!("queueing the replay timed out")));
    match queued {
        Ok(()) => {
            tracing::warn!(
                error = %exhausted.error,
                failure,
                attempts = exhausted.attempts,
                failed_items = exhausted.diagnosis.failed_items,
                "search-index event failed; queued for a replay"
            );
            OutcomeRecord::failed(EventOutcome::RetryQueued, &exhausted)
        }
        Err(replay_error) => {
            tracing::error!(
                error = %exhausted.error,
                replay_error = ?replay_error,
                failure,
                attempts = exhausted.attempts,
                failed_items = exhausted.diagnosis.failed_items,
                "dropping search-index event: it failed and its replay could not be queued"
            );
            OutcomeRecord::failed(EventOutcome::Dropped, &exhausted)
        }
    }
}

/// Decode a replay's original record as the consumer decoded it.
pub(super) fn decode(
    replay: &ReplayBrokerEvent,
) -> Result<DeclaredMacroEvent, macro_event_broker::EventBrokerError> {
    DeclaredMacroEvent::decode(&ReplayRecord(replay))
}

/// The original record a replay carries.
struct ReplayRecord<'a>(&'a ReplayBrokerEvent);

impl MessageParts for ReplayRecord<'_> {
    fn key(&self) -> Option<&str> {
        Some(&self.0.key)
    }

    fn payload(&self) -> Option<&[u8]> {
        Some(self.0.payload.as_bytes())
    }

    fn topic(&self) -> &str {
        &self.0.topic
    }
}

/// Whether the queue should delete a replay's message.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ReplayDone {
    /// The replay ended: applied, nothing to apply, or its source is gone.
    Finished,
    /// The replay failed; the queue delivers it again or dead-letters it.
    Redeliver,
}

/// Apply a queued replay once. `receive_count` is how many times the queue
/// has delivered it, this delivery included.
pub(crate) async fn replay_broker_event(
    context: &KafkaProcessingContext,
    replay: &ReplayBrokerEvent,
    receive_count: u32,
) -> ReplayDone {
    let span = tracing::info_span!(
        "search.replay_event",
        messaging.kafka.topic = replay.topic.as_str(),
        messaging.kafka.partition = replay.partition,
        messaging.kafka.offset = replay.offset,
        macro.event.id = field::Empty,
        macro.event.type = field::Empty,
        agent.session.id = field::Empty,
        receive_count,
        kafka_attempts = replay.attempts,
        kafka_failure = replay.failure.as_str(),
        otel.status_code = field::Empty,
        otel.status_description = field::Empty,
    );
    adopt_traceparent(&span, replay.traceparent.as_deref());
    let decoded = span.in_scope(|| decode(replay));
    let (event, topic) = match (decoded, subscribed_topic(&replay.topic)) {
        (Ok(event), Some(topic)) => (event, topic),
        (decoded, _) => {
            // A release that reads this event's schema can still apply it, so
            // the replay stays for the dead-letter queue and a redrive.
            super::record_span_error(&span, "undecodable replay");
            tracing::error!(
                parent: &span,
                error = ?decoded.err(),
                event_id = replay.event_id,
                receive_count,
                "a search-index replay does not decode; leaving it for the dead-letter queue"
            );
            return ReplayDone::Redeliver;
        }
    };
    let received = ReceivedEvent {
        event_type: event_type(&event),
        event,
        topic,
        partition: replay.partition,
        offset: replay.offset,
        produced_at_ms: replay.produced_at_ms,
        key: replay.key.clone(),
        payload: replay.payload.clone(),
        delivery: Delivery::SqsReplay,
        span,
    };
    record_event_identity(&received.span, &received);

    let processing = processing_span(&received);
    let attempted = process_event(
        context,
        &received.event,
        received.partition,
        received.offset,
        &Attempts::Once,
    )
    .instrument(processing.clone())
    .instrument(received.span.clone())
    .await;
    let (record, done) = processing.in_scope(|| conclude_replay(attempted, receive_count));
    record_outcome(&context.metrics, &processing, &received, record);
    if record.outcome == EventOutcome::Dropped {
        super::record_span_error(&received.span, "replay failed on its last delivery");
    }
    done
}

fn conclude_replay(attempted: Attempted, receive_count: u32) -> (OutcomeRecord, ReplayDone) {
    let exhausted = match attempted {
        Ok((handled, attempts)) => {
            return (
                OutcomeRecord::handled(handled, attempts),
                ReplayDone::Finished,
            );
        }
        Err(exhausted) => exhausted,
    };
    let failure = <&'static str>::from(exhausted.diagnosis.failure);
    if exhausted.diagnosis.failure == Failure::SourceMissing {
        tracing::warn!(
            error = %exhausted.error,
            "search-index replay ended: the row it needs is still missing"
        );
        return (
            OutcomeRecord::failed(EventOutcome::SourceMissing, &exhausted),
            ReplayDone::Finished,
        );
    }
    if receive_count >= REPLAY_MAX_RECEIVES {
        tracing::error!(
            error = %exhausted.error,
            failure,
            failed_items = exhausted.diagnosis.failed_items,
            receive_count,
            "search-index replay failed on its last delivery; it moves to the dead-letter queue"
        );
        return (
            OutcomeRecord::failed(EventOutcome::Dropped, &exhausted),
            ReplayDone::Redeliver,
        );
    }
    tracing::warn!(
        error = %exhausted.error,
        failure,
        failed_items = exhausted.diagnosis.failed_items,
        receive_count,
        "search-index replay failed; the queue delivers it again"
    );
    (
        OutcomeRecord::failed(EventOutcome::Failed, &exhausted),
        ReplayDone::Redeliver,
    )
}

#[cfg(test)]
mod test;
