//! Channel side effects for messages committed by the shared message service.
use super::{
    events::{ChannelEvent, MessageChangedNotificationContext},
    models::{
        ChannelMetadata, CountedReaction, MutatedAttachment, MutatedMessage, ReferencedShareItem,
        Sender, TypingAction,
    },
    ports::{ChannelEventDispatcher, ChannelReferenceSharePermissions, ChannelRepo},
};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{
    delivery::MessageRealtime,
    models::{Message, MessageAttachment, MessageParent, PatchMessageNotificationPolicy},
    ports::{MessageChange, MessageEvent, MessageEventPublisher},
};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Preserves channel notifications, activity, sharing, indexing, bot triggers, and
/// the realtime payloads the deployed channel client listens to when the shared
/// message service commits a channel message, and adds the common
/// `message_update` payload beside them.
#[derive(Clone)]
pub struct ChannelMessageDelivery<R, E, P, G> {
    repo: R,
    events: E,
    permissions: P,
    realtime: G,
}

impl<R, E, P, G> ChannelMessageDelivery<R, E, P, G> {
    /// Compose existing channel policies with the shared realtime transport.
    pub fn new(repo: R, events: E, permissions: P, realtime: G) -> Self {
        Self {
            repo,
            events,
            permissions,
            realtime,
        }
    }
}

fn persisted(channel_id: Uuid, message: &Message) -> MutatedMessage {
    MutatedMessage {
        id: message.id,
        channel_id,
        thread_id: message.thread_id,
        sender_id: message.sender_id.clone(),
        triggered_by: message.triggered_by.clone(),
        content: message.content.clone(),
        created_at: message.created_at,
        updated_at: message.updated_at,
        edited_at: message.edited_at,
        deleted_at: message.deleted_at,
    }
}

fn attachment_rows(
    channel_id: Uuid,
    message_id: Uuid,
    values: &[MessageAttachment],
) -> Vec<MutatedAttachment> {
    values
        .iter()
        .map(|attachment| MutatedAttachment {
            id: attachment.id,
            channel_id,
            message_id,
            entity_type: attachment.entity_type.clone(),
            entity_id: attachment.entity_id.clone(),
            width: attachment.width,
            height: attachment.height,
            created_at: attachment.created_at,
        })
        .collect()
}

fn repo_error(error: impl Into<anyhow::Error>) -> rootcause::Report {
    rootcause::report!("channel message delivery failed: {}", error.into())
}

impl<R, E, P, G> ChannelMessageDelivery<R, E, P, G>
where
    R: ChannelRepo,
    E: ChannelEventDispatcher,
    P: ChannelReferenceSharePermissions,
    G: MessageRealtime,
{
    async fn channel_metadata(
        &self,
        channel_id: Uuid,
        actor: &Sender,
    ) -> Result<ChannelMetadata, rootcause::Report> {
        if let Some(user) = actor.as_user() {
            return self
                .repo
                .get_channel_metadata(channel_id, user.clone())
                .await
                .map_err(repo_error);
        }
        let info = self
            .repo
            .get_channel_info(channel_id)
            .await
            .map_err(repo_error)?;
        Ok(ChannelMetadata {
            channel_type: info.channel_type,
            channel_name: info.name.unwrap_or_default(),
        })
    }
}

impl<R, E, P, G> MessageEventPublisher for ChannelMessageDelivery<R, E, P, G>
where
    R: ChannelRepo,
    E: ChannelEventDispatcher,
    P: ChannelReferenceSharePermissions,
    G: MessageRealtime,
{
    async fn publish(&self, event: MessageEvent) -> Result<(), rootcause::Report> {
        let MessageParent::Channel(channel_id) = event.parent else {
            return Err(rootcause::report!(
                "channel delivery requires a channel parent"
            ));
        };
        let actor: Sender = event.actor.clone().try_into()?;
        let participants = self
            .repo
            .get_participants(channel_id)
            .await
            .map_err(repo_error)?;
        let recipients: Vec<MacroUserIdStr<'static>> = participants
            .iter()
            .filter_map(|participant| MacroUserIdStr::try_from(participant.user_id.clone()).ok())
            .collect();
        let live_users = participants
            .iter()
            .map(|participant| participant.user_id.clone())
            .collect();
        let mut side_effect_error = None;
        // Sharing and activity failures must not suppress events for a committed message.
        if let MessageChange::Posted {
            message, mentions, ..
        }
        | MessageChange::Edited {
            message, mentions, ..
        } = &event.change
        {
            if let Some(user) = actor.as_user() {
                let items = message
                    .attachments
                    .iter()
                    .filter_map(|attachment| {
                        ReferencedShareItem::from_raw(
                            attachment.entity_id.clone(),
                            &attachment.entity_type,
                        )
                    })
                    .chain(mentions.iter().filter_map(|mention| {
                        ReferencedShareItem::from_raw(
                            mention.entity_id.clone(),
                            &mention.entity_type,
                        )
                    }))
                    .collect::<Vec<_>>();
                if !items.is_empty()
                    && let Err(error) = self
                        .permissions
                        .update_channel_share_permissions_for_referenced_items(
                            user.clone(),
                            channel_id,
                            items,
                        )
                        .await
                {
                    side_effect_error = Some(repo_error(error));
                }
                if let Err(error) = self.repo.upsert_activity(actor.clone(), channel_id).await {
                    side_effect_error = Some(repo_error(error));
                }
            }
            if let Err(error) = self.repo.touch_channel_updated_at(channel_id).await {
                side_effect_error = Some(repo_error(error));
            }
        }
        match &event.change {
            MessageChange::Posted {
                message,
                mentions,
                notification_policy,
            } => {
                let metadata = self.channel_metadata(channel_id, &actor).await?;
                self.events.dispatch(ChannelEvent::MessagePosted {
                    channel_id,
                    metadata,
                    participants: participants.clone(),
                    message: persisted(channel_id, message),
                    mentions: mentions.clone(),
                    has_attachments: !message.attachments.is_empty(),
                    attachments: attachment_rows(channel_id, message.id, &message.attachments),
                    nonce: event.nonce.clone(),
                    notification_policy: *notification_policy,
                });
            }
            MessageChange::Edited {
                message,
                mentions,
                notification_policy,
                previous_attachments,
            } => {
                let posted_notification = if *notification_policy
                    == PatchMessageNotificationPolicy::NotifyAsPostedMessage
                {
                    Some(MessageChangedNotificationContext {
                        metadata: self.channel_metadata(channel_id, &actor).await?,
                        participants: participants.clone(),
                        mentions: mentions.clone(),
                        has_attachments: !message.attachments.is_empty(),
                    })
                } else {
                    None
                };
                let current = attachment_rows(channel_id, message.id, &message.attachments);
                let previous = attachment_rows(channel_id, message.id, previous_attachments);
                let added: Vec<_> = current
                    .iter()
                    .filter(|attachment| !previous.iter().any(|p| p.id == attachment.id))
                    .cloned()
                    .collect();
                let removed: Vec<_> = previous
                    .into_iter()
                    .filter(|attachment| !current.iter().any(|c| c.id == attachment.id))
                    .collect();
                if !added.is_empty() || !removed.is_empty() {
                    self.events.dispatch(ChannelEvent::AttachmentsChanged {
                        channel_id,
                        actor: actor.clone(),
                        message_id: message.id,
                        attachments: current,
                        added,
                        removed,
                        recipients: recipients.clone(),
                        nonce: event.nonce.clone(),
                    });
                }
                self.events.dispatch(ChannelEvent::MessageChanged {
                    channel_id,
                    actor: actor.clone(),
                    message: persisted(channel_id, message),
                    recipients: recipients.clone(),
                    nonce: event.nonce.clone(),
                    posted_notification,
                });
            }
            MessageChange::MessageDeleted { message } => {
                self.events.dispatch(ChannelEvent::MessageDeleted {
                    channel_id,
                    actor: actor.clone(),
                    message: persisted(channel_id, message),
                    recipients: recipients.clone(),
                    nonce: event.nonce.clone(),
                });
            }
            MessageChange::ReactionChanged { message } => {
                if actor.as_user().is_some()
                    && let Err(error) = self.repo.upsert_activity(actor.clone(), channel_id).await
                {
                    side_effect_error = Some(repo_error(error));
                }
                self.events.dispatch(ChannelEvent::ReactionChanged {
                    channel_id,
                    actor: actor.clone(),
                    message_id: message.id,
                    reactions: message
                        .reactions
                        .iter()
                        .map(|reaction| CountedReaction {
                            emoji: reaction.emoji.clone(),
                            users: reaction.users.clone(),
                        })
                        .collect(),
                    recipients: recipients.clone(),
                    nonce: event.nonce.clone(),
                });
            }
            MessageChange::Typing { thread_id, active } => {
                self.events.dispatch(ChannelEvent::TypingChanged {
                    channel_id,
                    actor: actor.clone(),
                    action: if *active {
                        TypingAction::Start
                    } else {
                        TypingAction::Stop
                    },
                    thread_id: *thread_id,
                    recipients: recipients.clone(),
                    nonce: event.nonce.clone(),
                });
            }
            MessageChange::ThreadUpdated { .. } => {}
        }
        if let Err(error) = self.realtime.send(&event, live_users).await {
            side_effect_error = Some(error);
        }
        side_effect_error.map_or(Ok(()), Err)
    }
}
