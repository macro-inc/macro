//! Durable event intake, independent of routine execution. Records are processed
//! serially: no later offset can be committed past an unfinished admission.

#[cfg(test)]
mod test;

use std::future::Future;
use std::time::Duration;

use channels::domain::broker_events::ChannelMacroEvent;
use documents::domain::events::DocumentMacroEvent;
use kafka_util::{GroupName, KafkaEventConsumer};
use macro_event_broker::{
    EventBrokerError, EventConsumer, KafkaConsumerAdapter, MacroEvent as _,
    MacroEventCollection as _, MacroEventConsumerService, MessageWrapper,
};
use rdkafka::consumer::CommitMode;
use rdkafka::message::{BorrowedMessage, Message};
use rootcause::Report;
use tracing::Instrument as _;

use crate::domain::event_runs::{EventIngestion, EventIngestionResult};
use crate::domain::event_trigger::{EventPayload, IncomingEvent};

macro_event_broker::declare_topics!(DeclaredMacroEvent: DocumentMacroEvent, ChannelMacroEvent);

struct ScheduledActionEventIngestionGroup;

impl GroupName for ScheduledActionEventIngestionGroup {
    const GROUP_NAME: &'static str = "scheduled-action-event-ingestion";
}

type ScheduledActionKafkaAdapter =
    KafkaConsumerAdapter<ScheduledActionEventIngestionGroup, DeclaredMacroEvent>;

const MAX_INGEST_ATTEMPTS: u8 = 5;
// Four delays (1+2+4+8 seconds) before the fifth and final attempt.
const INGEST_RETRY_BASE_DELAY: Duration = Duration::from_secs(1);

// Transport-only seam: tests exercise the same receive/admit/commit loop without
// a broker. The domain sees only EventIngestion, never Kafka delivery controls.
trait CommittingConsumer: EventConsumer<DeclaredMacroEvent> {
    fn commit(&self, message: &Self::MessageType<'_>) -> Result<(), Report>;
}

impl CommittingConsumer for ScheduledActionKafkaAdapter {
    fn commit(&self, message: &BorrowedMessage<'_>) -> Result<(), Report> {
        // Async commits only report enqueueing, not broker acknowledgment. Stop
        // on a synchronous commit failure and let a fresh consumer redeliver.
        self.commit_message(message, CommitMode::Sync)
    }
}

fn incoming_event(event: DeclaredMacroEvent) -> IncomingEvent {
    match event {
        DeclaredMacroEvent::DocumentMacroEvent(event) => {
            let envelope = event.event();
            IncomingEvent {
                event_id: envelope.event_id,
                schema_version: envelope.schema_version,
                payload: EventPayload::Document(envelope.event.clone()),
            }
        }
        DeclaredMacroEvent::ChannelMacroEvent(event) => {
            let envelope = event.event();
            IncomingEvent {
                event_id: envelope.event_id,
                schema_version: envelope.schema_version,
                payload: EventPayload::Channel(envelope.event.clone()),
            }
        }
    }
}

fn decode_rejection(error: &EventBrokerError) -> &'static str {
    match error {
        EventBrokerError::UnsupportedSchemaVersion { .. } => "unsupported_schema",
        EventBrokerError::MissingMessageKey => "missing_key",
        EventBrokerError::MissingMessagePayload => "missing_payload",
        EventBrokerError::UnknownTopic(_) => "unsupported_topic",
        _ => "malformed_or_unsupported_payload",
    }
}

async fn ingest_with_retry(
    service: &impl EventIngestion,
    event: &IncomingEvent,
    base_delay: Duration,
) -> Result<(), Report> {
    for attempt in 1..=MAX_INGEST_ATTEMPTS {
        if attempt > 1 {
            tokio::time::sleep(base_delay * (1 << (attempt - 2))).await;
        }
        match service.ingest(event).await {
            Ok(EventIngestionResult::Admitted { inserted }) => {
                tracing::info!(attempt, inserted, outcome = "admitted", "event admitted");
                return Ok(());
            }
            Ok(EventIngestionResult::Rejected(reason)) => {
                tracing::info!(
                    attempt,
                    reason = %reason,
                    outcome = "permanent_reject",
                    "event rejected by ingestion"
                );
                return Ok(());
            }
            Err(_) => {
                // Reports can contain payloads or database values. Only emit
                // the classification, never the underlying admission error.
                tracing::warn!(
                    attempt,
                    outcome = "transient_failure",
                    "event admission failed"
                );
            }
        }
    }
    Err(rootcause::report!("event admission retries exhausted"))
}

async fn process_message<C: CommittingConsumer>(
    consumer: &C,
    service: &impl EventIngestion,
    message: &MessageWrapper<C::MessageType<'_>, DeclaredMacroEvent>,
    base_delay: Duration,
) -> Result<(), Report> {
    match message.decode_payload() {
        Ok(event) => {
            let event = incoming_event(event);
            tracing::Span::current()
                .record("macro.event.id", tracing::field::display(event.event_id));
            ingest_with_retry(service, &event, base_delay).await?;
        }
        Err(error) => {
            // Serde errors can include attacker-controlled strings. Do not log
            // the error itself, message key, or raw payload.
            tracing::warn!(
                reason = decode_rejection(&error),
                outcome = "permanent_reject",
                "broker record rejected"
            );
        }
    }
    consumer
        .commit(message.inner())
        .map_err(|_| rootcause::report!("event offset commit failed"))?;
    tracing::info!(outcome = "committed", records = 1, "event offset committed");
    Ok(())
}

async fn consume<C>(
    consumer: C,
    service: impl EventIngestion,
    shutdown: impl Future<Output = ()> + Send,
    base_delay: Duration,
) -> Result<(), Report>
where
    C: CommittingConsumer,
    for<'a> C::MessageType<'a>: Message,
{
    let consumer = MacroEventConsumerService::new(consumer);
    let mut shutdown = std::pin::pin!(shutdown);
    loop {
        let message = tokio::select! {
            biased;
            _ = &mut shutdown => return Ok(()),
            result = consumer.recv() => {
                result.map_err(|_| rootcause::report!("event consumer receive failed"))?
            }
        };
        let span = kafka_util::consumer_span(
            message.inner(),
            ScheduledActionEventIngestionGroup::GROUP_NAME,
        );
        let result = tokio::select! {
            biased;
            _ = &mut shutdown => {
                tracing::info!(parent: &span, outcome = "cancelled_uncommitted", "event intake stopped");
                // Dropping admission can leave partial durable fan-out. Exit,
                // never continue this consumer; redelivery deduplicates it.
                return Ok(());
            }
            result = process_message(consumer.inner(), &service, &message, base_delay)
                .instrument(span.clone()) => result,
        };
        result.inspect_err(|_| {
            kafka_util::record_span_error(&span, "event intake stopped without advancing");
            tracing::error!(parent: &span, outcome = "fatal", "event intake stopped without advancing");
        })?;
    }
}

/// Consume exactly document and channel topics under a dedicated durable group.
///
/// Only durable admission or a permanent rejection permits committing. Admission
/// errors get five attempts with bounded exponential backoff. Exhausted retries,
/// receive errors, and commit failures are fatal: restart with a fresh consumer,
/// not the old in-memory position. Shutdown also drops the consumer without
/// committing unfinished admission. Partial fan-out is safe to redeliver through
/// the ingestion port's durable deduplication contract.
pub async fn run_scheduled_action_event_consumer(
    brokers: &str,
    service: impl EventIngestion,
    shutdown: impl Future<Output = ()> + Send,
) -> Result<(), Report> {
    let consumer = KafkaEventConsumer::<ScheduledActionEventIngestionGroup>::from_env(brokers)?;
    let consumer = KafkaConsumerAdapter::<ScheduledActionEventIngestionGroup, ()>::new(consumer)
        .subscribe::<DeclaredMacroEvent>()?;
    tracing::info!(
        topics = ?DeclaredMacroEvent::topics(),
        group = ScheduledActionEventIngestionGroup::GROUP_NAME,
        "scheduled action event consumer listening"
    );
    consume(consumer, service, shutdown, INGEST_RETRY_BASE_DELAY).await
}
