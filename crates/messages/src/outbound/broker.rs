//! Broker envelopes and publication for committed message facts.

use crate::domain::events::{
    MessageAttachmentCreatedMetadata, MessageAttachmentRemovedMetadata, MessageDeletedMetadata,
    MessageMentionedMetadata, MessagePatchedMetadata, MessagePostedMetadata,
};
use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroMessagesTopic;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Lifecycle events for the common message service, one per committed fact.
/// Reactions and typing never reach the topic.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum MessageTopicEvent {
    /// A user or bot posted a root or reply.
    #[serde(rename = "message.posted")]
    Posted(MessagePostedMetadata),
    /// A message's content was patched.
    #[serde(rename = "message.patched")]
    Patched(MessagePatchedMetadata),
    /// A message was tombstoned.
    #[serde(rename = "message.deleted")]
    Deleted(MessageDeletedMetadata),
    /// An entity (user, bot, document, …) was mentioned in a posted message.
    #[serde(rename = "message.mentioned")]
    Mentioned(MessageMentionedMetadata),
    /// Attachments were added to a message.
    #[serde(rename = "message.attachment_created")]
    AttachmentCreated(MessageAttachmentCreatedMetadata),
    /// Attachments were removed from a message.
    #[serde(rename = "message.attachment_removed")]
    AttachmentRemoved(MessageAttachmentRemovedMetadata),
}

impl TopicEvent for MessageTopicEvent {
    type Topic = MacroMessagesTopic;
    const SCHEMA_VERSION: u8 = 1;
}

/// Message facts keyed by thread root to preserve conversation ordering.
#[derive(Debug, Clone)]
pub struct MessageMacroEvent {
    key: String,
    event: Event<MessageTopicEvent>,
}

impl MessageMacroEvent {
    fn new(root_id: Uuid, event: MessageTopicEvent) -> Self {
        Self {
            key: root_id.to_string(),
            event: Event::new(event),
        }
    }

    /// Wrap a persisted post for publication.
    pub fn posted(metadata: MessagePostedMetadata) -> Self {
        Self::new(metadata.root_id, MessageTopicEvent::Posted(metadata))
    }

    /// Wrap a persisted content edit for publication.
    pub fn patched(metadata: MessagePatchedMetadata) -> Self {
        Self::new(metadata.root_id, MessageTopicEvent::Patched(metadata))
    }

    /// Wrap a persisted tombstone for publication.
    pub fn deleted(metadata: MessageDeletedMetadata) -> Self {
        Self::new(metadata.root_id, MessageTopicEvent::Deleted(metadata))
    }

    /// Wrap one mentioned entity for publication.
    pub fn mentioned(metadata: MessageMentionedMetadata) -> Self {
        Self::new(metadata.root_id, MessageTopicEvent::Mentioned(metadata))
    }

    /// Wrap added attachments for publication.
    pub fn attachment_created(metadata: MessageAttachmentCreatedMetadata) -> Self {
        Self::new(
            metadata.root_id,
            MessageTopicEvent::AttachmentCreated(metadata),
        )
    }

    /// Wrap removed attachments for publication.
    pub fn attachment_removed(metadata: MessageAttachmentRemovedMetadata) -> Self {
        Self::new(
            metadata.root_id,
            MessageTopicEvent::AttachmentRemoved(metadata),
        )
    }
}

impl MacroEvent for MessageMacroEvent {
    type EventPayload = MessageTopicEvent;
    fn key(&self) -> &str {
        &self.key
    }
    fn event(&self) -> &Event<Self::EventPayload> {
        &self.event
    }
    fn from_event(key: String, event: Event<Self::EventPayload>) -> Self {
        Self { key, event }
    }
}

/// Publishes committed message facts to the common event stream.
#[derive(Clone)]
pub struct BrokerMessagePublisher<Broker> {
    broker: Broker,
}

impl<Broker> BrokerMessagePublisher<Broker> {
    /// Construct a broker sink for committed message facts.
    pub fn new(broker: Broker) -> Self {
        Self { broker }
    }
}

#[cfg(feature = "ports")]
impl<Broker: macro_event_broker::MacroEventBroker> crate::domain::ports::MessageEventPublisher
    for BrokerMessagePublisher<Broker>
{
    async fn publish(
        &self,
        event: crate::domain::ports::MessageEvent,
    ) -> Result<(), rootcause::Report> {
        // Facts are published independently of notification delivery: a
        // notification failure cannot keep a committed change from consumers.
        let mut first_error = None;
        for fact in topic_events(&event) {
            if let Err(error) = self.broker.send_event(&fact) {
                tracing::error!(error=?error, key = fact.key(), "failed to publish message fact");
                first_error.get_or_insert_with(|| rootcause::report!(error).into());
            }
        }
        first_error.map_or(Ok(()), Err)
    }
}

/// The topic facts a committed change produces, in publication order.
#[cfg(feature = "ports")]
pub fn topic_events(event: &crate::domain::ports::MessageEvent) -> Vec<MessageMacroEvent> {
    use crate::domain::{events::MessageEventAttachment, ports::MessageChange};
    let Ok(actor) = channel_sender::ChannelSender::try_from(event.actor.clone()) else {
        return Vec::new();
    };
    match &event.change {
        MessageChange::Posted {
            message, mentions, ..
        } => {
            let posted = MessagePostedMetadata::from_message(message, mentions.clone());
            let mut facts = vec![MessageMacroEvent::posted(posted.clone())];
            if !posted.attachments.is_empty() {
                facts.push(MessageMacroEvent::attachment_created(
                    MessageAttachmentCreatedMetadata {
                        parent: message.parent.clone(),
                        message_id: message.id,
                        thread_id: message.thread_id,
                        root_id: message.root_id(),
                        actor: message.sender_id.clone(),
                        attachments: posted.attachments.clone(),
                    },
                ));
            }
            let mut seen = std::collections::HashSet::new();
            for mention in mentions {
                if !seen.insert((mention.entity_type.as_str(), mention.entity_id.as_str())) {
                    continue;
                }
                facts.push(MessageMacroEvent::mentioned(MessageMentionedMetadata {
                    parent: message.parent.clone(),
                    message_id: message.id,
                    thread_id: message.thread_id,
                    root_id: message.root_id(),
                    sender: message.sender_id.clone(),
                    content: message.content.clone(),
                    mentioned: mention.clone(),
                    created_at: message.created_at,
                }));
            }
            facts
        }
        MessageChange::Edited {
            message,
            previous_attachments,
            ..
        } => {
            let mut facts = vec![MessageMacroEvent::patched(MessagePatchedMetadata {
                parent: message.parent.clone(),
                message_id: message.id,
                thread_id: message.thread_id,
                root_id: message.root_id(),
                actor: actor.clone(),
                content: message.content.clone(),
                edited_at: message.edited_at,
                updated_at: message.updated_at,
            })];
            let added: Vec<_> = message
                .attachments
                .iter()
                .filter(|attachment| !previous_attachments.iter().any(|p| p.id == attachment.id))
                .map(MessageEventAttachment::from)
                .collect();
            let removed: Vec<_> = previous_attachments
                .iter()
                .filter(|previous| !message.attachments.iter().any(|a| a.id == previous.id))
                .map(MessageEventAttachment::from)
                .collect();
            if !added.is_empty() {
                facts.push(MessageMacroEvent::attachment_created(
                    MessageAttachmentCreatedMetadata {
                        parent: message.parent.clone(),
                        message_id: message.id,
                        thread_id: message.thread_id,
                        root_id: message.root_id(),
                        actor: actor.clone(),
                        attachments: added,
                    },
                ));
            }
            if !removed.is_empty() {
                facts.push(MessageMacroEvent::attachment_removed(
                    MessageAttachmentRemovedMetadata {
                        parent: message.parent.clone(),
                        message_id: message.id,
                        thread_id: message.thread_id,
                        root_id: message.root_id(),
                        actor,
                        attachments: removed,
                    },
                ));
            }
            facts
        }
        MessageChange::MessageDeleted { message } => {
            vec![MessageMacroEvent::deleted(MessageDeletedMetadata {
                parent: message.parent.clone(),
                message_id: message.id,
                thread_id: message.thread_id,
                root_id: message.root_id(),
                actor,
                deleted_at: message.deleted_at,
            })]
        }
        MessageChange::ReactionChanged { .. }
        | MessageChange::ThreadUpdated { .. }
        | MessageChange::Typing { .. } => Vec::new(),
    }
}
