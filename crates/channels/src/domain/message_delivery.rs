use super::{events::ChannelEvent, models::*, ports::*};
use messages::domain::{
    delivery::MessageRealtime,
    models::{Message, MessageParent},
    ports::{MessageChange, MessageEvent, MessageEventPublisher},
};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Preserves channel notifications, activity, sharing, indexing, and bot behavior
/// when the shared message service commits a channel message.
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

fn persisted(channel_id: Uuid, m: &Message) -> MutatedMessage {
    MutatedMessage {
        id: m.id,
        channel_id,
        thread_id: m.thread_id,
        sender_id: m.sender_id.clone(),
        triggered_by: m.triggered_by.clone(),
        content: m.content.clone(),
        created_at: m.created_at,
        updated_at: m.updated_at,
        edited_at: m.edited_at,
        deleted_at: m.deleted_at,
    }
}

fn attachments(channel_id: Uuid, m: &Message) -> Vec<MutatedAttachment> {
    attachment_rows(channel_id, m.id, &m.attachments)
}

fn attachment_rows(
    channel_id: Uuid,
    message_id: Uuid,
    values: &[messages::domain::models::MessageAttachment],
) -> Vec<MutatedAttachment> {
    values
        .iter()
        .map(|a| MutatedAttachment {
            id: a.id,
            channel_id,
            message_id,
            entity_type: a.entity_type.clone(),
            entity_id: a.entity_id.clone(),
            width: a.width,
            height: a.height,
            created_at: a.created_at,
        })
        .collect()
}

fn repo_error(error: impl Into<anyhow::Error>) -> rootcause::Report {
    rootcause::report!("channel message delivery failed: {}", error.into())
}

impl<
    R: ChannelRepo,
    E: ChannelEventDispatcher,
    P: ChannelReferenceSharePermissions,
    G: MessageRealtime,
> MessageEventPublisher for ChannelMessageDelivery<R, E, P, G>
{
    async fn publish(&self, event: MessageEvent) -> Result<(), rootcause::Report> {
        let MessageParent::Channel(channel_id) = event.parent else {
            return Err(rootcause::report!(
                "channel delivery requires channel parent"
            ));
        };
        let actor: Sender = event.actor.clone().try_into()?;
        let participants = self
            .repo
            .get_participants(channel_id)
            .await
            .map_err(repo_error)?;
        let recipients: Vec<_> = participants
            .iter()
            .filter_map(|p| p.user_id.clone().try_into().ok())
            .collect();
        let live_users = participants.iter().map(|p| p.user_id.clone()).collect();
        let mut side_effect_error = None;
        // Sharing and activity failures must not suppress events for a committed message.
        if let MessageChange::Posted { message, mentions }
        | MessageChange::Edited {
            message, mentions, ..
        } = &event.change
        {
            if let Some(user) = actor.as_user() {
                let items = message
                    .attachments
                    .iter()
                    .filter_map(|a| {
                        ReferencedShareItem::from_raw(a.entity_id.clone(), &a.entity_type)
                    })
                    .chain(mentions.iter().filter_map(|m| {
                        ReferencedShareItem::from_raw(m.entity_id.clone(), &m.entity_type)
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
            MessageChange::Posted { message, mentions } => {
                let metadata = if let Some(user) = actor.as_user() {
                    self.repo
                        .get_channel_metadata(channel_id, user.clone())
                        .await
                        .map_err(repo_error)?
                } else {
                    let info = self
                        .repo
                        .get_channel_info(channel_id)
                        .await
                        .map_err(repo_error)?;
                    ChannelMetadata {
                        channel_type: info.channel_type,
                        channel_name: info.name.unwrap_or_default(),
                    }
                };
                self.events.dispatch(ChannelEvent::MessagePosted {
                    channel_id,
                    metadata,
                    participants,
                    message: persisted(channel_id, message),
                    mentions: mentions.clone(),
                    has_attachments: !message.attachments.is_empty(),
                    attachments: attachments(channel_id, message),
                    nonce: event.nonce.clone(),
                    notification_policy: PostMessageNotificationPolicy::Default,
                });
            }
            MessageChange::Edited {
                message,
                previous_attachments,
                ..
            } => {
                self.events.dispatch(ChannelEvent::MessageChanged {
                    channel_id,
                    actor: actor.clone(),
                    message: persisted(channel_id, message),
                    recipients: recipients.clone(),
                    nonce: event.nonce.clone(),
                    posted_notification: None,
                });
                let current = attachments(channel_id, message);
                let previous = attachment_rows(channel_id, message.id, previous_attachments);
                let added = current
                    .iter()
                    .filter(|a| !previous.iter().any(|p| p.id == a.id))
                    .cloned()
                    .collect::<Vec<_>>();
                let removed = previous
                    .into_iter()
                    .filter(|p| !current.iter().any(|a| a.id == p.id))
                    .collect::<Vec<_>>();
                if !added.is_empty() || !removed.is_empty() {
                    self.events.dispatch(ChannelEvent::AttachmentsChanged {
                        channel_id,
                        actor: actor.clone(),
                        message_id: message.id,
                        attachments: current,
                        added,
                        removed,
                        recipients,
                        nonce: event.nonce.clone(),
                    });
                }
            }
            MessageChange::Updated { message } => {
                if message.deleted_at.is_some() {
                    self.events.dispatch(ChannelEvent::MessageDeleted {
                        channel_id,
                        actor: actor.clone(),
                        message: persisted(channel_id, message),
                        recipients: recipients.clone(),
                        nonce: event.nonce.clone(),
                    });
                } else {
                    self.events.dispatch(ChannelEvent::ReactionChanged {
                        channel_id,
                        actor: actor.clone(),
                        message_id: message.id,
                        reactions: message.reactions.clone(),
                        recipients: recipients.clone(),
                        nonce: event.nonce.clone(),
                    });
                }
            }
            MessageChange::Typing { active } => self.events.dispatch(ChannelEvent::TypingChanged {
                channel_id,
                actor,
                action: if *active {
                    TypingAction::Start
                } else {
                    TypingAction::Stop
                },
                thread_id: Some(event.root_id),
                recipients,
                nonce: event.nonce.clone(),
            }),
            MessageChange::ThreadUpdated { .. } => {}
        }
        self.realtime.send(&event, live_users).await?;
        if let Some(error) = side_effect_error {
            return Err(error);
        }
        Ok(())
    }
}
