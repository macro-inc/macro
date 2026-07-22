//! Kafka consumer for `document.updated` realtime Soup fan-out.
//!
//! Delivery is at least once: offsets are committed only after successful
//! domain processing. Malformed and currently unsupported document events are
//! poison/ignored records and are committed so they cannot wedge a partition.

#[cfg(test)]
mod test;

use std::{future::Future, time::Duration};

use documents::domain::events::DocumentTopicEvent;
use kafka_consumer_util::{GroupName, KafkaEventConsumer};
use macro_event_broker::{Event, EventBrokerError, Topic as _};
use macro_event_topics::MacroDocumentsTopic;
use model_entity::{Entity, EntityType};
use rdkafka::consumer::CommitMode;
use rdkafka::message::{BorrowedMessage, Message as _};
use rootcause::prelude::{Report, ResultExt as _};

use crate::domain::ports::SoupRealtimeService;

/// Consumer group used for document update fan-out offsets.
struct SoupRealtimeConsumerGroup;

impl GroupName for SoupRealtimeConsumerGroup {
    const GROUP_NAME: &'static str = "soup-realtime";
}

type SoupRealtimeKafkaConsumer = KafkaEventConsumer<SoupRealtimeConsumerGroup>;

/// Total service attempts before returning for supervisor-driven redelivery.
const MAX_SERVICE_ATTEMPTS: u32 = 5;
/// Delay before the first retry; each subsequent delay doubles.
const SERVICE_RETRY_BASE_DELAY: Duration = Duration::from_secs(1);

fn subscribed_topics() -> [&'static str; 1] {
    [MacroDocumentsTopic.as_str()]
}

fn entity_from_document_event(event: DocumentTopicEvent) -> Option<Entity<'static>> {
    match event {
        DocumentTopicEvent::Updated(metadata) => {
            Some(EntityType::Document.with_entity_string(metadata.document_id))
        }
        DocumentTopicEvent::Created(_) => {
            tracing::trace!(event_type = "document.created", "ignoring document event");
            None
        }
        DocumentTopicEvent::Deleted(_) => {
            tracing::trace!(event_type = "document.deleted", "ignoring document event");
            None
        }
        DocumentTopicEvent::Copied(_) => {
            tracing::trace!(event_type = "document.copied", "ignoring document event");
            None
        }
    }
}

fn decode_updated_entity(payload: &[u8]) -> Result<Option<Entity<'static>>, EventBrokerError> {
    let event = Event::<DocumentTopicEvent>::decode(payload)?;
    Ok(entity_from_document_event(event.event))
}

/// Commit-safe outcome after processing one non-empty document payload.
enum DocumentPayloadOutcome {
    /// An update was successfully sent through the domain service.
    Notified,
    /// A recognized document event is outside the current scope.
    Ignored,
    /// The payload could not be decoded and should be treated as poison.
    Malformed(EventBrokerError),
}

#[tracing::instrument(skip(service, payload), fields(partition, offset, payload_len = payload.len()), err)]
async fn process_document_payload<S: SoupRealtimeService>(
    service: &S,
    payload: &[u8],
    partition: i32,
    offset: i64,
) -> Result<DocumentPayloadOutcome, Report> {
    match decode_updated_entity(payload) {
        Ok(Some(entity)) => {
            notify_with_retry(service, entity, partition, offset).await?;
            Ok(DocumentPayloadOutcome::Notified)
        }
        Ok(None) => Ok(DocumentPayloadOutcome::Ignored),
        Err(error) => Ok(DocumentPayloadOutcome::Malformed(error)),
    }
}

#[tracing::instrument(
    skip(service),
    fields(
        entity_type = %entity.entity_type,
        entity_id = %entity.entity_id,
        partition,
        offset,
    ),
    err
)]
async fn notify_with_retry<S: SoupRealtimeService>(
    service: &S,
    entity: Entity<'static>,
    partition: i32,
    offset: i64,
) -> Result<(), Report> {
    let mut delay = SERVICE_RETRY_BASE_DELAY;
    let mut attempt = 1u32;

    loop {
        tracing::trace!(attempt, "notifying realtime Soup recipients");
        match service.notify_users(entity.clone()).await {
            Ok(()) => {
                tracing::trace!(attempt, "realtime Soup recipients notified");
                return Ok(());
            }
            Err(error) if attempt < MAX_SERVICE_ATTEMPTS => {
                tracing::warn!(
                    error = ?error,
                    attempt,
                    delay_secs = delay.as_secs_f32(),
                    "realtime Soup fan-out failed, retrying"
                );
                tokio::time::sleep(delay).await;
                delay *= 2;
                attempt += 1;
            }
            Err(error) => {
                return Err(error
                    .context(format!(
                        "realtime Soup fan-out failed after {MAX_SERVICE_ATTEMPTS} attempts \
                         (partition {partition} offset {offset})"
                    ))
                    .into_dynamic());
            }
        }
    }
}

fn commit_logged(consumer: &SoupRealtimeKafkaConsumer, message: &BorrowedMessage<'_>) {
    match consumer.commit_message(message, CommitMode::Async) {
        Ok(()) => tracing::trace!(
            partition = message.partition(),
            offset = message.offset(),
            "committed realtime Soup input offset"
        ),
        Err(error) => tracing::error!(
            error = ?error,
            partition = message.partition(),
            offset = message.offset(),
            "failed to commit realtime Soup input offset"
        ),
    }
}

/// Runs the document update consumer until `shutdown` resolves.
///
/// The consumer subscribes only to `macro.documents` under the
/// `soup-realtime` group. It commits malformed and recognized-but-ignored
/// events, and commits `document.updated` only after [`SoupRealtimeService`]
/// succeeds. Exhausted service retries return without committing so a future
/// supervisor restart can redeliver the record.
#[tracing::instrument(skip(service, shutdown), fields(brokers), err)]
pub async fn run_document_update_consumer<S>(
    brokers: &str,
    service: S,
    shutdown: impl Future<Output = ()> + Send,
) -> Result<(), Report>
where
    S: SoupRealtimeService,
{
    let consumer = SoupRealtimeKafkaConsumer::from_env(brokers)?;
    consumer
        .subscribe(&subscribed_topics())
        .context("failed to subscribe to document update topic")?;
    tracing::info!(
        topics = ?subscribed_topics(),
        group = SoupRealtimeConsumerGroup::GROUP_NAME,
        "realtime Soup document consumer listening"
    );

    let mut shutdown = std::pin::pin!(shutdown);
    loop {
        tokio::select! {
            _ = &mut shutdown => {
                tracing::info!("realtime Soup document consumer shutting down");
                break;
            }
            result = consumer.recv() => {
                let message = match result {
                    Ok(message) => message,
                    Err(error) => {
                        tracing::error!(error = ?error, "Kafka receive error");
                        continue;
                    }
                };
                tracing::trace!(
                    topic = message.topic(),
                    partition = message.partition(),
                    offset = message.offset(),
                    payload_len = message.payload().map_or(0, <[u8]>::len),
                    "received realtime Soup input"
                );

                let Some(payload) = message.payload().filter(|payload| !payload.is_empty()) else {
                    tracing::warn!(
                        partition = message.partition(),
                        offset = message.offset(),
                        "skipping document event with empty payload"
                    );
                    commit_logged(&consumer, &message);
                    continue;
                };

                let outcome = match process_document_payload(
                    &service,
                    payload,
                    message.partition(),
                    message.offset(),
                )
                .await
                {
                    Ok(outcome) => outcome,
                    Err(error) => {
                        tracing::error!(
                            error = ?error,
                            topic = message.topic(),
                            partition = message.partition(),
                            offset = message.offset(),
                            "realtime Soup fan-out retries exhausted; pausing partition for redelivery"
                        );
                        // Kafka commits are cumulative within a partition, so
                        // pause it before any later record can advance the
                        // committed offset past this failure.
                        consumer
                            .pause_message_partition(&message)
                            .context("failed to pause Kafka partition after fan-out failure")?;
                        continue;
                    }
                };

                match outcome {
                    DocumentPayloadOutcome::Notified | DocumentPayloadOutcome::Ignored => {}
                    DocumentPayloadOutcome::Malformed(error) => tracing::error!(
                        error = ?error,
                        topic = message.topic(),
                        partition = message.partition(),
                        offset = message.offset(),
                        "dropping malformed document event"
                    ),
                }

                commit_logged(&consumer, &message);
            }
        }
    }

    Ok(())
}
