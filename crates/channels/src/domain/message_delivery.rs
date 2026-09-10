use super::{events::ChannelEvent, models::*, ports::*};
use messages::domain::{
    delivery::MessageRealtime,
    models::MessageParent,
    ports::{MessageChange, MessageEvent, MessageEventPublisher},
};

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
        let live_users = participants.iter().map(|p| p.user_id.clone()).collect();
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
        if matches!(&event.change, MessageChange::ReactionChanged { .. })
            && actor.as_user().is_some()
            && let Err(error) = self.repo.upsert_activity(actor.clone(), channel_id).await
        {
            side_effect_error = Some(repo_error(error));
        }
        if let Err(error) = self.realtime.send(&event, live_users).await {
            side_effect_error = Some(error);
        }
        if matches!(
            &event.change,
            MessageChange::Posted { .. }
                | MessageChange::Edited { .. }
                | MessageChange::MessageDeleted { .. }
        ) {
            let metadata = if matches!(
                &event.change,
                MessageChange::Posted { .. } | MessageChange::Edited { .. }
            ) {
                Some(if let Some(user) = actor.as_user() {
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
                })
            } else {
                None
            };
            self.events.dispatch(ChannelEvent::MessageCommitted {
                event: Box::new(event),
                metadata,
                participants,
            });
        }
        if let Some(error) = side_effect_error {
            return Err(error);
        }
        Ok(())
    }
}
