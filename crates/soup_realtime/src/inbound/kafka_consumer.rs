//! Kafka consumer for entity events that change realtime Soup items.
//!
//! Delivery is at least once: offsets are committed only after successful
//! domain processing. Malformed and recognized-but-irrelevant events are
//! poison/ignored records and are committed so they cannot wedge a partition.

#[cfg(test)]
mod test;

use std::{future::Future, time::Duration};

use channels::domain::broker_events::{ChannelMacroEvent, ChannelTopicEvent};
use chat::domain::events::{ChatMacroEvent, ChatTopicEvent};
use documents::domain::events::{DocumentMacroEvent, DocumentTopicEvent};
use email::domain::events::{EmailMacroEvent, EmailTopicEvent};
use kafka_util::{GroupName, KafkaEventConsumer};
use macro_event_broker::{
    KafkaConsumerAdapter, MacroEvent as _, MacroEventCollection as _, MacroEventConsumerService,
};
use model_entity::{Entity, EntityType};
use projects::domain::events::{ProjectMacroEvent, ProjectTopicEvent};
use rdkafka::consumer::CommitMode;
use rdkafka::message::{BorrowedMessage, Message as _};
use rootcause::prelude::{Report, ResultExt as _};
use tokio_retry::{Retry, strategy::ExponentialBackoff};

use crate::domain::{
    models::SoupRealtimeUpdate,
    ports::{SoupItemReader, SoupRealtimePublisher, SoupRealtimeService, UserAccessExpander},
    service::SoupRealtimeServiceImpl,
};

/// Consumer group used for Soup-affecting entity event offsets.
struct SoupRealtimeConsumerGroup;

impl GroupName for SoupRealtimeConsumerGroup {
    const GROUP_NAME: &'static str = "soup-realtime";
}

type SoupRealtimeKafkaAdapter = KafkaConsumerAdapter<SoupRealtimeConsumerGroup, DeclaredMacroEvent>;
type SoupRealtimeKafkaConsumer =
    MacroEventConsumerService<DeclaredMacroEvent, SoupRealtimeKafkaAdapter>;

macro_event_broker::declare_topics!(
    DeclaredMacroEvent:
        DocumentMacroEvent,
        ProjectMacroEvent,
        ChatMacroEvent,
        EmailMacroEvent,
        ChannelMacroEvent,
);

/// Total service attempts before returning for supervisor-driven redelivery.
const MAX_SERVICE_ATTEMPTS: u32 = 5;
/// Delay before the first retry; each subsequent delay doubles.
const SERVICE_RETRY_BASE_DELAY: Duration = Duration::from_secs(1);

fn service_retry_strategy() -> impl Iterator<Item = Duration> {
    ExponentialBackoff::from_millis(2)
        .factor(500)
        .take((MAX_SERVICE_ATTEMPTS - 1) as usize)
}

fn entity(entity_type: EntityType, entity_id: impl ToString) -> Entity<'static> {
    entity_type.with_entity_string(entity_id.to_string())
}

fn update(entity_type: EntityType, entity_id: impl ToString) -> SoupRealtimeUpdate {
    SoupRealtimeUpdate::for_entity(entity(entity_type, entity_id))
}

fn entities_from_document_event(event: &DocumentTopicEvent) -> Vec<SoupRealtimeUpdate> {
    let document_id = match event {
        DocumentTopicEvent::Created(metadata) => &metadata.document_id,
        DocumentTopicEvent::Updated(metadata) => &metadata.document_id,
        DocumentTopicEvent::Copied(metadata) => &metadata.document_id,
        DocumentTopicEvent::Deleted(_) | DocumentTopicEvent::Interaction(_) => return Vec::new(),
    };
    vec![update(EntityType::Document, document_id)]
}

fn entities_from_project_event(event: &ProjectTopicEvent) -> Vec<SoupRealtimeUpdate> {
    let project_id = match event {
        ProjectTopicEvent::Created(metadata) if metadata.parent_project_id.is_none() => {
            &metadata.project_id
        }
        ProjectTopicEvent::Updated(metadata)
            if metadata
                .parent_id
                .as_ref()
                .map_or(metadata.previous_parent_id.is_none(), String::is_empty) =>
        {
            &metadata.project_id
        }
        ProjectTopicEvent::Restored(metadata) if metadata.parent_project_id.is_none() => {
            &metadata.project_id
        }
        ProjectTopicEvent::Uploaded(metadata) if metadata.parent_project_id.is_none() => {
            &metadata.root_project_id
        }
        ProjectTopicEvent::Created(_)
        | ProjectTopicEvent::Updated(_)
        | ProjectTopicEvent::Deleted(_)
        | ProjectTopicEvent::Restored(_)
        | ProjectTopicEvent::PermanentlyDeleted(_)
        | ProjectTopicEvent::Uploaded(_) => return Vec::new(),
    };
    vec![update(EntityType::Project, project_id)]
}

fn entities_from_chat_event(event: &ChatTopicEvent) -> Vec<SoupRealtimeUpdate> {
    let chat_id = match event {
        ChatTopicEvent::Created(metadata) => &metadata.chat_id,
        ChatTopicEvent::Updated(metadata) => &metadata.chat_id,
        ChatTopicEvent::Restored(metadata) => &metadata.chat_id,
        ChatTopicEvent::Copied(metadata) => &metadata.chat_id,
        ChatTopicEvent::Deleted(_)
        | ChatTopicEvent::PermanentlyDeleted(_)
        | ChatTopicEvent::MessageSent(_) => return Vec::new(),
    };
    vec![update(EntityType::Chat, chat_id)]
}

fn entities_from_email_event(event: &EmailTopicEvent) -> Vec<SoupRealtimeUpdate> {
    let thread_id = match event {
        EmailTopicEvent::MessageReceived(metadata) if !metadata.is_spam_or_trash => {
            metadata.thread_id
        }
        EmailTopicEvent::MessageSent(metadata) => metadata.thread_id,
        EmailTopicEvent::MessageDeleted(metadata) => metadata.thread_id,
        EmailTopicEvent::MessageSendQueued(metadata) => metadata.thread_id,
        EmailTopicEvent::MessageSendCancelled(metadata) => metadata.thread_id,
        EmailTopicEvent::ThreadArchived(metadata) => metadata.thread_id,
        EmailTopicEvent::ThreadTrashed(metadata) if !metadata.trashed => metadata.thread_id,
        EmailTopicEvent::ThreadRead(metadata) => metadata.thread_id,
        EmailTopicEvent::ThreadStarred(metadata) => metadata.thread_id,
        EmailTopicEvent::ThreadProjectChanged(metadata) => metadata.thread_id,
        EmailTopicEvent::ThreadLabelsUpdated(metadata) => metadata.thread_id,
        EmailTopicEvent::LinkConnected(_)
        | EmailTopicEvent::LinkDisconnected(_)
        | EmailTopicEvent::LinkReauthRequired(_)
        | EmailTopicEvent::MessageReceived(_)
        | EmailTopicEvent::ThreadTrashed(_) => return Vec::new(),
    };
    vec![update(EntityType::EmailThread, thread_id)]
}

fn channel_and_thread_entities(
    channel_id: impl ToString,
    message_id: impl ToString,
    thread_id: Option<impl ToString>,
) -> Vec<SoupRealtimeUpdate> {
    let channel = entity(EntityType::Channel, channel_id);
    let thread = entity(
        EntityType::ChannelMessage,
        thread_id
            .map(|id| id.to_string())
            .unwrap_or_else(|| message_id.to_string()),
    );
    vec![
        SoupRealtimeUpdate::for_entity(channel.clone()),
        SoupRealtimeUpdate::new(thread, channel),
    ]
}

fn entities_from_channel_event(event: &ChannelTopicEvent) -> Vec<SoupRealtimeUpdate> {
    match event {
        ChannelTopicEvent::Updated(metadata) => {
            vec![update(EntityType::Channel, metadata.channel_id)]
        }
        ChannelTopicEvent::MessagePosted(metadata) => channel_and_thread_entities(
            metadata.channel_id,
            metadata.message_id,
            metadata.thread_id,
        ),
        ChannelTopicEvent::MessagePatched(metadata) => channel_and_thread_entities(
            metadata.channel_id,
            metadata.message_id,
            metadata.thread_id,
        ),
        ChannelTopicEvent::MessageDeleted(metadata) => {
            let channel = entity(EntityType::Channel, metadata.channel_id);
            let mut entities = vec![SoupRealtimeUpdate::for_entity(channel.clone())];
            if let Some(thread_id) = metadata.thread_id {
                entities.push(SoupRealtimeUpdate::new(
                    entity(EntityType::ChannelMessage, thread_id),
                    channel,
                ));
            }
            entities
        }
        ChannelTopicEvent::MessageAttachmentCreated(metadata) => channel_and_thread_entities(
            metadata.channel_id,
            metadata.message_id,
            metadata.thread_id,
        ),
        ChannelTopicEvent::MessageAttachmentRemoved(metadata) => channel_and_thread_entities(
            metadata.channel_id,
            metadata.message_id,
            metadata.thread_id,
        ),
        ChannelTopicEvent::ParticipantAdded(metadata) => {
            vec![update(EntityType::Channel, metadata.channel_id)]
        }
        ChannelTopicEvent::ParticipantRemoved(metadata) => {
            vec![update(EntityType::Channel, metadata.channel_id)]
        }
        ChannelTopicEvent::Created(metadata) => {
            vec![update(EntityType::Channel, metadata.channel_id)]
        }
        ChannelTopicEvent::Deleted(_) => Vec::new(),
    }
}

fn entities_from_event(event: &DeclaredMacroEvent) -> Vec<SoupRealtimeUpdate> {
    match event {
        DeclaredMacroEvent::DocumentMacroEvent(event) => {
            entities_from_document_event(&event.event().event)
        }
        DeclaredMacroEvent::ProjectMacroEvent(event) => {
            entities_from_project_event(&event.event().event)
        }
        DeclaredMacroEvent::ChatMacroEvent(event) => entities_from_chat_event(&event.event().event),
        DeclaredMacroEvent::EmailMacroEvent(event) => {
            entities_from_email_event(&event.event().event)
        }
        DeclaredMacroEvent::ChannelMacroEvent(event) => {
            entities_from_channel_event(&event.event().event)
        }
    }
}

/// Commit-safe outcome after processing one entity event.
enum EventOutcome {
    /// Every affected item was successfully sent through the domain service.
    Notified,
    /// A recognized event does not update a currently hydratable Soup item.
    Ignored,
}

#[tracing::instrument(skip(service, event), fields(partition, offset), err)]
async fn process_event<S: SoupRealtimeService>(
    service: &S,
    event: &DeclaredMacroEvent,
    partition: i32,
    offset: i64,
) -> Result<EventOutcome, Report> {
    let updates = entities_from_event(event);
    if updates.is_empty() {
        tracing::trace!("ignoring event without a hydratable Soup impact");
        return Ok(EventOutcome::Ignored);
    }

    for update in updates {
        notify_with_retry(service, update, partition, offset).await?;
    }
    Ok(EventOutcome::Notified)
}

#[tracing::instrument(
    skip(service, update),
    fields(
        entity_type = %update.item.entity_type,
        entity_id = %update.item.entity_id,
        access_source_type = %update.access_source.entity_type,
        access_source_id = %update.access_source.entity_id,
        partition,
        offset,
    ),
    err
)]
async fn notify_with_retry<S: SoupRealtimeService>(
    service: &S,
    update: SoupRealtimeUpdate,
    partition: i32,
    offset: i64,
) -> Result<(), Report> {
    let mut attempt = 0u32;
    Retry::start(service_retry_strategy(), || {
        attempt += 1;
        let update = update.clone();
        async move {
            tracing::trace!(attempt, "notifying realtime Soup recipients");
            let result = service.notify_users(update).await;
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
    /// Runs the Soup-affecting entity event consumer until `shutdown` resolves.
    ///
    /// The consumer subscribes to every existing entity topic with events that
    /// can change a Soup item under the `soup-realtime` group. It commits malformed
    /// and recognized-but-ignored events, and commits affecting events only after
    /// [`SoupRealtimeService`] succeeds. Exhausted service retries return without
    /// committing so a future supervisor restart can redeliver the record.
    #[tracing::instrument(skip(self, shutdown), fields(brokers), err)]
    pub async fn run_entity_update_consumer(
        &self,
        brokers: &str,
        shutdown: impl Future<Output = ()> + Send,
    ) -> Result<(), Report> {
        let consumer = KafkaEventConsumer::<SoupRealtimeConsumerGroup>::from_env(brokers)?;
        let consumer = KafkaConsumerAdapter::<SoupRealtimeConsumerGroup, ()>::new(consumer)
            .subscribe::<DeclaredMacroEvent>()
            .context("failed to subscribe to Soup-affecting entity topics")?;
        let consumer = SoupRealtimeKafkaConsumer::new(consumer);
        tracing::info!(
            topics = ?DeclaredMacroEvent::topics(),
            group = SoupRealtimeConsumerGroup::GROUP_NAME,
            "realtime Soup entity consumer listening"
        );

        let mut shutdown = std::pin::pin!(shutdown);
        loop {
            tokio::select! {
                _ = &mut shutdown => {
                    tracing::info!("realtime Soup entity consumer shutting down");
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
                        Ok(event) => event,
                        Err(error) => {
                            tracing::error!(
                                error = ?error,
                                topic = kafka_message.topic(),
                                partition = kafka_message.partition(),
                                offset = kafka_message.offset(),
                                "dropping malformed Soup source event"
                            );
                            commit_logged(&consumer, kafka_message);
                            continue;
                        }
                    };

                    match process_event(
                        self,
                        &event,
                        kafka_message.partition(),
                        kafka_message.offset(),
                    )
                    .await
                    {
                        Ok(EventOutcome::Notified | EventOutcome::Ignored) => {}
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
                            return Err(error
                                .context("realtime Soup entity consumer requires restart for redelivery")
                                .into_dynamic());
                        }
                    }

                    commit_logged(&consumer, kafka_message);
                }
            }
        }

        Ok(())
    }
}
