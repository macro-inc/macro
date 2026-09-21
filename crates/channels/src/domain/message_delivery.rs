//! Channel side effects for messages committed by the shared message service.
use super::{
    events::ChannelEvent,
    models::{ChannelMetadata, MutatedMessage, ReferencedShareItem, Sender},
    ports::{ChannelEventDispatcher, ChannelReferenceSharePermissions, ChannelRepo},
};
use messages::domain::{
    delivery::MessageRealtime,
    models::{Message, MessageParent, PatchMessageNotificationPolicy, PostMessageNotificationPolicy},
    ports::{MessageChange, MessageEvent, MessageEventPublisher},
};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Preserves channel notifications, activity, sharing of referenced items,
/// contact sync, and the channel lifecycle broker events when the shared
/// message service commits a channel message, and sends the common
/// `message_update` payload to the channel's participants.
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
        // Notifications derive from a post, or from an edit that must notify like one.
        let posted = match &event.change {
            MessageChange::Posted {
                message,
                mentions,
                notification_policy,
            } => Some((message, mentions, *notification_policy)),
            MessageChange::Edited {
                message,
                mentions,
                notification_policy: PatchMessageNotificationPolicy::NotifyAsPostedMessage,
                ..
            } => Some((message, mentions, PostMessageNotificationPolicy::Default)),
            MessageChange::ReactionChanged { .. } => {
                if actor.as_user().is_some()
                    && let Err(error) = self.repo.upsert_activity(actor.clone(), channel_id).await
                {
                    side_effect_error = Some(repo_error(error));
                }
                None
            }
            MessageChange::Edited { .. }
            | MessageChange::MessageDeleted { .. }
            | MessageChange::Typing { .. }
            | MessageChange::ThreadUpdated { .. } => None,
        };
        if let Some((message, mentions, notification_policy)) = posted {
            let metadata = self.channel_metadata(channel_id, &actor).await?;
            self.events.dispatch(ChannelEvent::MessagePosted {
                channel_id,
                metadata,
                participants,
                message: persisted(channel_id, message),
                mentions: mentions.clone(),
                has_attachments: !message.attachments.is_empty(),
                notification_policy,
            });
        }
        if let Err(error) = self.realtime.send(&event, live_users).await {
            side_effect_error = Some(error);
        }
        side_effect_error.map_or(Ok(()), Err)
    }
}
