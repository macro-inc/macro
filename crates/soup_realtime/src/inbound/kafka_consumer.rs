//! Kafka consumer for `document.updated` realtime Soup fan-out.
//!
//! Delivery is at least once: offsets are committed only after successful
//! domain processing. Malformed and currently unsupported document events are
//! poison/ignored records and are committed so they cannot wedge a partition.

#[cfg(test)]
mod test;

use std::{future::Future, time::Duration};

use documents::domain::events::{DocumentMacroEvent, DocumentTopicEvent};
use kafka_util::{GroupName, KafkaEventConsumer};
use macro_event_broker::{
    KafkaConsumerAdapter, MacroEvent as _, MacroEventCollection as _, MacroEventConsumerService,
};
use model_entity::{Entity, EntityType};
use rdkafka::consumer::CommitMode;
use rdkafka::message::{BorrowedMessage, Message as _};
use rootcause::prelude::{Report, ResultExt as _};
use tokio_retry::{Retry, strategy::ExponentialBackoff};

use crate::domain::{
    ports::{SoupItemReader, SoupRealtimePublisher, SoupRealtimeService, UserAccessExpander},
    service::SoupRealtimeServiceImpl,
};

/// Consumer group used for document update fan-out offsets.
struct SoupRealtimeConsumerGroup;

impl GroupName for SoupRealtimeConsumerGroup {
    const GROUP_NAME: &'static str = "soup-realtime";
}

type SoupRealtimeKafkaAdapter = KafkaConsumerAdapter<SoupRealtimeConsumerGroup, DeclaredMacroEvent>;
type SoupRealtimeKafkaConsumer =
    MacroEventConsumerService<DeclaredMacroEvent, SoupRealtimeKafkaAdapter>;

macro_event_broker::declare_topics!(DeclaredMacroEvent: DocumentMacroEvent);

/// Total service attempts before returning for supervisor-driven redelivery.
const MAX_SERVICE_ATTEMPTS: u32 = 5;
/// Delay before the first retry; each subsequent delay doubles.
const SERVICE_RETRY_BASE_DELAY: Duration = Duration::from_secs(1);

fn service_retry_strategy() -> impl Iterator<Item = Duration> {
    ExponentialBackoff::from_millis(2)
        .factor(500)
        .take((MAX_SERVICE_ATTEMPTS - 1) as usize)
}

fn entity_from_document_event(event: &DocumentMacroEvent) -> Option<Entity<'static>> {
    match &event.event().event {
        DocumentTopicEvent::Updated(metadata) => {
            Some(EntityType::Document.with_entity_string(metadata.document_id.clone()))
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
        DocumentTopicEvent::Interaction(_) => {
            tracing::trace!(
                event_type = "document.interaction",
                "ignoring document event"
            );
            None
        }
    }
}

/// Commit-safe outcome after processing one document event.
enum DocumentEventOutcome {
    /// An update was successfully sent through the domain service.
    Notified,
    /// A recognized document event is outside the current scope.
    Ignored,
}

#[tracing::instrument(skip(service, event), fields(partition, offset), err)]
async fn process_document_event<S: SoupRealtimeService>(
    service: &S,
    event: &DocumentMacroEvent,
    partition: i32,
    offset: i64,
) -> Result<DocumentEventOutcome, Report> {
    match entity_from_document_event(event) {
        Some(entity) => {
            notify_with_retry(service, entity, partition, offset).await?;
            Ok(DocumentEventOutcome::Notified)
        }
        None => Ok(DocumentEventOutcome::Ignored),
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
    let mut attempt = 0u32;
    Retry::start(service_retry_strategy(), || {
        attempt += 1;
        let entity = entity.clone();
        async move {
            tracing::trace!(attempt, "notifying realtime Soup recipients");
            let result = service.notify_users(entity).await;
            match &result {
                Ok(()) => tracing::trace!(attempt, "realtime Soup recipients notified"),
                Err(error) if attempt < MAX_SERVICE_ATTEMPTS => {
                    let delay = SERVICE_RETRY_BASE_DELAY * 2u32.pow(attempt - 1);
                    tracing::warn!(
                        error = ?error,
                        attempt,
                        delay_secs = delay.as_secs_f32(),
                        "realtime Soup fan-out failed, retrying"
                    );
                }
                Err(_) => {}
            }
            result
        }
    })
    .await
    .map_err(|error| {
        error
            .context(format!(
                "realtime Soup fan-out failed after {MAX_SERVICE_ATTEMPTS} attempts \
                 (partition {partition} offset {offset})"
            ))
            .into_dynamic()
    })
}

fn commit_logged(consumer: &SoupRealtimeKafkaConsumer, message: &BorrowedMessage<'_>) {
    match consumer.inner().commit_message(message, CommitMode::Async) {
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

impl<A, R, P> SoupRealtimeServiceImpl<A, R, P>
where
    A: UserAccessExpander,
    R: SoupItemReader,
    P: SoupRealtimePublisher,
{
    /// Runs the document update consumer until `shutdown` resolves.
    ///
    /// The consumer subscribes only to `macro.documents` under the
    /// `soup-realtime` group. It commits malformed and recognized-but-ignored
    /// events, and commits `document.updated` only after [`SoupRealtimeService`]
    /// succeeds. Exhausted service retries return without committing so a future
    /// supervisor restart can redeliver the record.
    #[tracing::instrument(skip(self, shutdown), fields(brokers), err)]
    pub async fn run_document_update_consumer(
        &self,
        brokers: &str,
        shutdown: impl Future<Output = ()> + Send,
    ) -> Result<(), Report> {
        let consumer = KafkaEventConsumer::<SoupRealtimeConsumerGroup>::from_env(brokers)?;
        let consumer = KafkaConsumerAdapter::<SoupRealtimeConsumerGroup, ()>::new(consumer)
            .subscribe::<DeclaredMacroEvent>()
            .context("failed to subscribe to document update topic")?;
        let consumer = SoupRealtimeKafkaConsumer::new(consumer);
        tracing::info!(
            topics = ?DeclaredMacroEvent::topics(),
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
                    let kafka_message = message.inner();
                    let event = match message.decode_payload() {
                        Ok(DeclaredMacroEvent::DocumentMacroEvent(event)) => event,
                        Err(error) => {
                            tracing::error!(
                                error = ?error,
                                topic = kafka_message.topic(),
                                partition = kafka_message.partition(),
                                offset = kafka_message.offset(),
                                "dropping malformed document event"
                            );
                            commit_logged(&consumer, kafka_message);
                            continue;
                        }
                    };

                    match process_document_event(
                        self,
                        &event,
                        kafka_message.partition(),
                        kafka_message.offset(),
                    )
                    .await
                    {
                        Ok(DocumentEventOutcome::Notified | DocumentEventOutcome::Ignored) => {}
                        Err(error) => {
                            tracing::error!(
                                error = ?error,
                                topic = kafka_message.topic(),
                                partition = kafka_message.partition(),
                                offset = kafka_message.offset(),
                                "realtime Soup fan-out retries exhausted; pausing partition for redelivery"
                            );
                            // Kafka commits are cumulative within a partition, so
                            // pause it before any later record can advance the
                            // committed offset past this failure.
                            consumer
                                .inner()
                                .pause_message_partition(kafka_message)
                                .context("failed to pause Kafka partition after fan-out failure")?;
                            continue;
                        }
                    }

                    commit_logged(&consumer, kafka_message);
                }
            }
        }

        Ok(())
    }
}
