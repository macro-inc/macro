//! Kafka consumer for entity events that change realtime Soup items.
//!
//! Delivery is at least once: offsets are committed only after successful
//! domain processing. Malformed and recognized-but-irrelevant events are
//! poison/ignored records and are committed so they cannot wedge a partition.

#[cfg(test)]
mod test;

use std::future::Future;

use crate::domain::{
    models::{Patch, SoupRealtimePatch},
    ports::SoupRealtimeService,
    service::SoupRealtimeServiceImpl,
};
use channels::domain::{
    broker_events::{ChannelMacroEvent, ChannelTopicEvent},
    models::ReferencedShareItemType,
};
use chat::domain::events::{ChatMacroEvent, ChatTopicEvent};
use documents::domain::events::{DocumentMacroEvent, DocumentTopicEvent, InteractionReason};
use email::domain::events::{EmailMacroEvent, EmailTopicEvent};
use kafka_util::{GroupName, KafkaEventConsumer};
use macro_event_broker::{
    KafkaConsumerAdapter, MacroEvent as _, MacroEventCollection as _, MacroEventConsumerService,
};
use model_entity::{Entity, EntityType};
use models_properties::EntityType as PropertyEntityType;
use projects::domain::events::{ProjectMacroEvent, ProjectTopicEvent};
use properties::domain::events::{PropertyMacroEvent, PropertyTopicEvent};
use rdkafka::consumer::CommitMode;
use rdkafka::message::{BorrowedMessage, Message as _};
use rootcause::prelude::{Report, ResultExt as _};

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
        PropertyMacroEvent,
);

fn entity(entity_type: EntityType, entity_id: impl ToString) -> Entity<'static> {
    entity_type.with_entity_string(entity_id.to_string())
}

fn update(entity_type: EntityType, entity_id: impl ToString) -> SoupRealtimePatch {
    SoupRealtimePatch::for_entity(Patch::Updated(entity(entity_type, entity_id)))
}

fn delete(entity_type: EntityType, entity_id: impl ToString) -> SoupRealtimePatch {
    SoupRealtimePatch::for_entity(Patch::Deleted(entity(entity_type, entity_id)))
}

fn push_unique_patch_with_access_source(
    patches: &mut Vec<SoupRealtimePatch>,
    patch: Patch<Entity<'static>>,
    access_source: Entity<'static>,
) {
    if patch.value().entity_id.is_empty()
        || patches.iter().any(|candidate| candidate.patch == patch)
    {
        return;
    }
    patches.push(SoupRealtimePatch::new(patch, access_source));
}

fn push_unique_patch(patches: &mut Vec<SoupRealtimePatch>, patch: Patch<Entity<'static>>) {
    let access_source = patch.value().clone();
    push_unique_patch_with_access_source(patches, patch, access_source);
}

fn push_unique_update(
    patches: &mut Vec<SoupRealtimePatch>,
    entity_type: EntityType,
    entity_id: &str,
) {
    push_unique_patch(patches, Patch::Updated(entity(entity_type, entity_id)));
}

fn push_unique_delete(
    patches: &mut Vec<SoupRealtimePatch>,
    entity_type: EntityType,
    entity_id: &str,
) {
    push_unique_patch(patches, Patch::Deleted(entity(entity_type, entity_id)));
}

fn patches_from_document_event(event: &DocumentTopicEvent) -> Vec<SoupRealtimePatch> {
    let mut updates = Vec::new();
    match event {
        DocumentTopicEvent::Created(metadata) => {
            push_unique_update(&mut updates, EntityType::Document, &metadata.document_id);
            if let Some(project_id) = metadata.project_id.as_deref() {
                push_unique_update(&mut updates, EntityType::Project, project_id);
            }
        }
        DocumentTopicEvent::Updated(metadata) => {
            push_unique_update(&mut updates, EntityType::Document, &metadata.document_id);
            if let Some(project_id) = metadata.project_id.as_deref() {
                push_unique_update(&mut updates, EntityType::Project, project_id);
            }
            if metadata.previous_project_id.as_deref() != metadata.project_id.as_deref()
                && let Some(previous_project_id) = metadata.previous_project_id.as_deref()
            {
                push_unique_update(&mut updates, EntityType::Project, previous_project_id);
            }
        }
        DocumentTopicEvent::Deleted(metadata) => {
            push_unique_delete(&mut updates, EntityType::Document, &metadata.document_id);
            if let Some(project_id) = metadata.project_id.as_deref() {
                push_unique_update(&mut updates, EntityType::Project, project_id);
            }
        }
        DocumentTopicEvent::Copied(metadata) => {
            push_unique_update(&mut updates, EntityType::Document, &metadata.document_id);
        }
        DocumentTopicEvent::Interaction(metadata)
            if metadata.reason == InteractionReason::Edited =>
        {
            push_unique_update(&mut updates, EntityType::Document, &metadata.document_id);
        }
        DocumentTopicEvent::Interaction(_)
        | DocumentTopicEvent::ContentUploaded(_)
        | DocumentTopicEvent::SyncContentUpdated(_)
        | DocumentTopicEvent::Purged(_) => {}
    }
    updates
}

fn patches_from_project_event(event: &ProjectTopicEvent) -> Vec<SoupRealtimePatch> {
    let mut updates = Vec::new();
    match event {
        ProjectTopicEvent::Created(metadata) => {
            push_unique_update(&mut updates, EntityType::Project, &metadata.project_id);
            if let Some(parent_id) = metadata.parent_project_id.as_deref() {
                push_unique_update(&mut updates, EntityType::Project, parent_id);
            }
        }
        ProjectTopicEvent::Updated(metadata) => {
            push_unique_update(&mut updates, EntityType::Project, &metadata.project_id);
            if let Some(previous_parent_id) = metadata.previous_parent_id.as_deref() {
                push_unique_update(&mut updates, EntityType::Project, previous_parent_id);
            }
            if let Some(parent_id) = metadata.parent_id.as_deref() {
                push_unique_update(&mut updates, EntityType::Project, parent_id);
            }
        }
        ProjectTopicEvent::Deleted(metadata) => {
            push_unique_delete(&mut updates, EntityType::Project, &metadata.project_id);
            for project_id in &metadata.deleted_project_ids {
                push_unique_delete(&mut updates, EntityType::Project, project_id);
            }
            for document_id in &metadata.deleted_document_ids {
                push_unique_delete(&mut updates, EntityType::Document, document_id);
            }
            for chat_id in &metadata.deleted_chat_ids {
                push_unique_delete(&mut updates, EntityType::Chat, chat_id);
            }
            if let Some(parent_id) = metadata.parent_project_id.as_deref() {
                push_unique_update(&mut updates, EntityType::Project, parent_id);
            }
        }
        ProjectTopicEvent::Restored(metadata) => {
            push_unique_update(&mut updates, EntityType::Project, &metadata.project_id);
            for project_id in &metadata.restored_project_ids {
                push_unique_update(&mut updates, EntityType::Project, project_id);
            }
        }
        ProjectTopicEvent::PermanentlyDeleted(_) => {}
        ProjectTopicEvent::Uploaded(metadata) => {
            for project_id in &metadata.project_ids {
                push_unique_update(&mut updates, EntityType::Project, project_id);
            }
        }
    }
    updates
}

fn patches_from_chat_event(event: &ChatTopicEvent) -> Vec<SoupRealtimePatch> {
    let mut updates = Vec::new();
    match event {
        ChatTopicEvent::Created(metadata) => {
            push_unique_update(&mut updates, EntityType::Chat, &metadata.chat_id);
            if let Some(project_id) = metadata.project_id.as_deref() {
                push_unique_update(&mut updates, EntityType::Project, project_id);
            }
        }
        ChatTopicEvent::Updated(metadata) => {
            push_unique_update(&mut updates, EntityType::Chat, &metadata.chat_id);
            if let Some(project_id) = metadata.project_id.as_deref() {
                push_unique_update(&mut updates, EntityType::Project, project_id);
            }
            if metadata.previous_project_id.as_deref() != metadata.project_id.as_deref()
                && let Some(previous_project_id) = metadata.previous_project_id.as_deref()
            {
                push_unique_update(&mut updates, EntityType::Project, previous_project_id);
            }
        }
        ChatTopicEvent::Deleted(metadata) => {
            push_unique_delete(&mut updates, EntityType::Chat, &metadata.chat_id);
            if let Some(project_id) = metadata.project_id.as_deref() {
                push_unique_update(&mut updates, EntityType::Project, project_id);
            }
        }
        ChatTopicEvent::PermanentlyDeleted(metadata) => {
            if let Some(project_id) = metadata.project_id.as_deref() {
                push_unique_update(&mut updates, EntityType::Project, project_id);
            }
        }
        ChatTopicEvent::Restored(metadata) => {
            push_unique_update(&mut updates, EntityType::Chat, &metadata.chat_id);
            if let Some(project_id) = metadata.project_id.as_deref() {
                push_unique_update(&mut updates, EntityType::Project, project_id);
            }
        }
        ChatTopicEvent::Copied(metadata) => {
            push_unique_update(&mut updates, EntityType::Chat, &metadata.chat_id);
        }
        ChatTopicEvent::MessageSent(_) | ChatTopicEvent::MessageDeleted(_) => {}
    }
    updates
}

fn patches_from_email_event(event: &EmailTopicEvent) -> Vec<SoupRealtimePatch> {
    let updated_thread = |thread_id| vec![update(EntityType::EmailThread, thread_id)];
    let deleted_thread = |thread_id| vec![delete(EntityType::EmailThread, thread_id)];

    match event {
        EmailTopicEvent::MessageReceived(metadata) => {
            if metadata.is_spam_or_trash {
                Vec::new()
            } else {
                updated_thread(metadata.thread_id)
            }
        }
        EmailTopicEvent::MessageDraftSynced(metadata) => {
            if metadata.is_spam_or_trash {
                Vec::new()
            } else {
                updated_thread(metadata.thread_id)
            }
        }
        EmailTopicEvent::MessageSent(metadata) => updated_thread(metadata.thread_id),
        EmailTopicEvent::MessageDeleted(metadata) => updated_thread(metadata.thread_id),
        EmailTopicEvent::MessageSendQueued(metadata) => updated_thread(metadata.thread_id),
        EmailTopicEvent::MessageSendCancelled(metadata) => updated_thread(metadata.thread_id),
        EmailTopicEvent::ThreadArchived(metadata) => updated_thread(metadata.thread_id),
        EmailTopicEvent::ThreadTrashed(metadata) => {
            if metadata.trashed {
                deleted_thread(metadata.thread_id)
            } else {
                updated_thread(metadata.thread_id)
            }
        }
        EmailTopicEvent::ThreadRead(metadata) => updated_thread(metadata.thread_id),
        EmailTopicEvent::ThreadStarred(metadata) => updated_thread(metadata.thread_id),
        EmailTopicEvent::ThreadSpamChanged(metadata) => {
            if metadata.spam {
                deleted_thread(metadata.thread_id)
            } else {
                updated_thread(metadata.thread_id)
            }
        }
        EmailTopicEvent::ThreadProjectChanged(metadata) => updated_thread(metadata.thread_id),
        EmailTopicEvent::ThreadLabelsUpdated(metadata) => updated_thread(metadata.thread_id),
        EmailTopicEvent::ThreadBackfilled(metadata) => updated_thread(metadata.thread_id),
        EmailTopicEvent::ThreadsReindexRequested(metadata) => metadata
            .thread_ids
            .iter()
            .map(|thread_id| update(EntityType::EmailThread, thread_id))
            .collect(),
        EmailTopicEvent::LinkConnected(_)
        | EmailTopicEvent::LinkDisconnected(_)
        | EmailTopicEvent::LinkReauthRequired(_) => Vec::new(),
    }
}

fn channel_and_thread_entities(
    channel_id: impl ToString,
    message_id: impl ToString,
    thread_id: Option<impl ToString>,
) -> Vec<SoupRealtimePatch> {
    let channel = entity(EntityType::Channel, channel_id);
    let thread = entity(
        EntityType::ChannelMessage,
        thread_id
            .map(|id| id.to_string())
            .unwrap_or_else(|| message_id.to_string()),
    );
    vec![
        SoupRealtimePatch::for_entity(Patch::Updated(channel.clone())),
        SoupRealtimePatch::new(Patch::Updated(thread), channel),
    ]
}

fn soup_entity_type_from_channel_reference(entity_type: &str) -> Option<EntityType> {
    match ReferencedShareItemType::from_raw(entity_type)? {
        ReferencedShareItemType::Document => Some(EntityType::Document),
        ReferencedShareItemType::Chat => Some(EntityType::Chat),
        ReferencedShareItemType::Project => Some(EntityType::Project),
        ReferencedShareItemType::EmailThread => Some(EntityType::EmailThread),
        ReferencedShareItemType::Call => Some(EntityType::Call),
    }
}

fn push_channel_reference_update(
    patches: &mut Vec<SoupRealtimePatch>,
    channel: &Entity<'static>,
    entity_type: &str,
    entity_id: &str,
) {
    let Some(entity_type) = soup_entity_type_from_channel_reference(entity_type) else {
        return;
    };
    push_unique_patch_with_access_source(
        patches,
        Patch::Updated(entity(entity_type, entity_id)),
        channel.clone(),
    );
}

fn patches_from_channel_event(event: &ChannelTopicEvent) -> Vec<SoupRealtimePatch> {
    match event {
        ChannelTopicEvent::Updated(metadata) => {
            vec![update(EntityType::Channel, metadata.channel_id)]
        }
        ChannelTopicEvent::MessagePosted(metadata) => {
            let mut patches = channel_and_thread_entities(
                metadata.channel_id,
                metadata.message_id,
                metadata.thread_id,
            );
            let channel = entity(EntityType::Channel, metadata.channel_id);
            for mention in &metadata.mentions {
                push_channel_reference_update(
                    &mut patches,
                    &channel,
                    &mention.entity_type,
                    &mention.entity_id,
                );
            }
            patches
        }
        ChannelTopicEvent::MessagePatched(metadata) => channel_and_thread_entities(
            metadata.channel_id,
            metadata.message_id,
            metadata.thread_id,
        ),
        ChannelTopicEvent::MessageDeleted(metadata) => {
            let channel = entity(EntityType::Channel, metadata.channel_id);
            let thread_patch = match metadata.thread_id {
                Some(thread_id) => Patch::Updated(entity(EntityType::ChannelMessage, thread_id)),
                None => Patch::Deleted(entity(EntityType::ChannelMessage, metadata.message_id)),
            };
            vec![
                SoupRealtimePatch::for_entity(Patch::Updated(channel.clone())),
                SoupRealtimePatch::new(thread_patch, channel),
            ]
        }
        ChannelTopicEvent::MessageAttachmentCreated(metadata) => {
            let channel = entity(EntityType::Channel, metadata.channel_id);
            let mut patches = vec![SoupRealtimePatch::for_entity(Patch::Updated(
                channel.clone(),
            ))];
            for attachment in &metadata.attachments {
                push_channel_reference_update(
                    &mut patches,
                    &channel,
                    &attachment.entity_type,
                    &attachment.entity_id,
                );
            }
            patches
        }
        ChannelTopicEvent::MessageAttachmentRemoved(metadata) => {
            vec![update(EntityType::Channel, metadata.channel_id)]
        }
        ChannelTopicEvent::ParticipantAdded(metadata) => {
            vec![update(EntityType::Channel, metadata.channel_id)]
        }
        ChannelTopicEvent::ParticipantRemoved(metadata) => {
            vec![update(EntityType::Channel, metadata.channel_id)]
        }
        ChannelTopicEvent::Created(metadata) => {
            vec![update(EntityType::Channel, metadata.channel_id)]
        }
        ChannelTopicEvent::Deleted(metadata) => {
            vec![delete(EntityType::Channel, metadata.channel_id)]
        }
        // Mentions carry no entity change beyond the message_posted event
        // emitted alongside them.
        ChannelTopicEvent::Mentioned(_) => Vec::new(),
    }
}

fn soup_entity_type_from_property(entity_type: PropertyEntityType) -> Option<EntityType> {
    match entity_type {
        PropertyEntityType::CalendarEvent => Some(EntityType::CalendarEvent),
        PropertyEntityType::CallRecord => Some(EntityType::Call),
        PropertyEntityType::Chat => Some(EntityType::Chat),
        PropertyEntityType::Company => Some(EntityType::CrmCompany),
        PropertyEntityType::Document | PropertyEntityType::Task => Some(EntityType::Document),
        PropertyEntityType::Project => Some(EntityType::Project),
        PropertyEntityType::Thread => Some(EntityType::EmailThread),
        // Soup channels do not expose properties, and users are not Soup items.
        PropertyEntityType::Channel | PropertyEntityType::User => None,
    }
}

fn property_update(entity_type: PropertyEntityType, entity_id: &str) -> Vec<SoupRealtimePatch> {
    soup_entity_type_from_property(entity_type)
        .map(|entity_type| update(entity_type, entity_id))
        .into_iter()
        .collect()
}

fn patches_from_property_event(event: &PropertyTopicEvent) -> Vec<SoupRealtimePatch> {
    match event {
        PropertyTopicEvent::EntityPropertyUpdated(metadata) => {
            property_update(metadata.entity_type, &metadata.entity_id)
        }
        PropertyTopicEvent::EntityPropertyDeleted(metadata) => {
            property_update(metadata.entity_type, &metadata.entity_id)
        }
        PropertyTopicEvent::EntityPropertiesCleared(metadata) => {
            property_update(metadata.entity_type, &metadata.entity_id)
        }
        PropertyTopicEvent::Created(_)
        | PropertyTopicEvent::Deleted(_)
        | PropertyTopicEvent::OptionCreated(_)
        | PropertyTopicEvent::OptionUpdated(_)
        | PropertyTopicEvent::OptionDeleted(_) => Vec::new(),
    }
}

fn patches_from_event(event: &DeclaredMacroEvent) -> Vec<SoupRealtimePatch> {
    match event {
        DeclaredMacroEvent::DocumentMacroEvent(event) => {
            patches_from_document_event(&event.event().event)
        }
        DeclaredMacroEvent::ProjectMacroEvent(event) => {
            patches_from_project_event(&event.event().event)
        }
        DeclaredMacroEvent::ChatMacroEvent(event) => patches_from_chat_event(&event.event().event),
        DeclaredMacroEvent::EmailMacroEvent(event) => {
            patches_from_email_event(&event.event().event)
        }
        DeclaredMacroEvent::ChannelMacroEvent(event) => {
            patches_from_channel_event(&event.event().event)
        }
        DeclaredMacroEvent::PropertyMacroEvent(event) => {
            patches_from_property_event(&event.event().event)
        }
    }
}

/// Commit-safe outcome after processing one entity event.
enum EventOutcome {
    /// Every affected item was successfully sent through the domain service.
    Notified,
    /// A recognized event does not change a Soup-visible entity.
    Ignored,
}

#[tracing::instrument(skip(service, event), err)]
fn process_event<S: SoupRealtimeService>(
    service: &S,
    event: &DeclaredMacroEvent,
) -> Result<EventOutcome, Report> {
    let patches = patches_from_event(event);
    if patches.is_empty() {
        tracing::trace!("ignoring event without a Soup patch");
        return Ok(EventOutcome::Ignored);
    }

    for patch in patches {
        service.notify_users(patch)?;
    }
    Ok(EventOutcome::Notified)
}

fn commit_logged(consumer: &SoupRealtimeKafkaConsumer, message: &BorrowedMessage<'_>) {
    let _ = consumer.inner().commit_message(message, CommitMode::Async);
}

impl SoupRealtimeServiceImpl {
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
                    let Ok(message) = result else { continue; };
                    let kafka_message = message.inner();
                    let _message_span = tracing::info_span!(
                        "realtime_soup_source_event",
                        topic = kafka_message.topic(),
                        partition = kafka_message.partition(),
                        offset = kafka_message.offset(),
                    )
                    .entered();
                    let event = match message.decode_payload() {
                        Ok(event) => event,
                        Err(_) => {
                            commit_logged(&consumer, kafka_message);
                            continue;
                        }
                    };

                    let _ = process_event(self,&event);

                    commit_logged(&consumer, kafka_message);
                }
            }
        }

        Ok(())
    }
}
