//! Channel side effects for messages committed by the shared message service.
use super::{
    events::{ChannelEvent, ReactionNotificationContext},
    models::{
        ChannelMetadata, MutatedMessage, ReferenceShareOutcome, ReferenceShareResult,
        ReferencedShareItem, Sender,
    },
    ports::{
        AgentCreations, ChannelEventDispatcher, ChannelReferenceSharePermissions, ChannelRepo,
    },
};
use bot_id::BotId;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::{
    delivery::MessageRealtime,
    models::{
        Message, MessageParent, PatchMessageNotificationPolicy, PostMessageNotificationPolicy,
    },
    ports::{MessageChange, MessageEvent, MessageEventPublisher},
};
use std::time::Duration;
use tracing::Instrument;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Preserves channel notifications, activity, sharing of referenced items,
/// contact sync, and the channel lifecycle broker events when the shared
/// message service commits a channel message, and sends the common
/// `message_update` payload to the channel's participants.
#[derive(Clone)]
pub struct ChannelMessageDelivery<R, E, P, G, C> {
    repo: R,
    events: E,
    permissions: P,
    realtime: G,
    creations: C,
}

impl<R, E, P, G, C> ChannelMessageDelivery<R, E, P, G, C> {
    /// Compose existing channel policies with the shared realtime transport.
    pub fn new(repo: R, events: E, permissions: P, realtime: G, creations: C) -> Self {
        Self {
            repo,
            events,
            permissions,
            realtime,
            creations,
        }
    }
}

/// Activity is ingested asynchronously, so a creation the agent just made may
/// not be recorded yet when its reply is delivered.
const CREATION_RECHECK_DELAYS: [Duration; 2] = [Duration::from_secs(5), Duration::from_secs(30)];

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

/// The person a bot message was posted for.
fn triggering_person(message: &Message) -> Option<MacroUserIdStr<'static>> {
    let id = message.triggered_by.clone()?;
    MacroUserIdStr::try_from(id)
        .inspect_err(|error| tracing::warn!(?error, "unparseable triggered_by"))
        .ok()
}

/// Record on the current span how many items were shared and how many the person could not share.
fn record_share_outcomes(results: &[ReferenceShareResult]) {
    let shared = results
        .iter()
        .filter(|result| result.outcome == ReferenceShareOutcome::Shared)
        .count();
    let span = tracing::Span::current();
    span.record("shared", shared);
    span.record("not_permitted", results.len() - shared);
}

/// Share the `pending` items once their creation by `bot` is recorded, giving
/// up on any still unrecorded after the last re-check.
async fn recheck_agent_creations<C, P>(
    creations: C,
    permissions: P,
    bot: BotId,
    requested_at: DateTime<Utc>,
    person: MacroUserIdStr<'static>,
    channel_id: Uuid,
    mut pending: Vec<ReferencedShareItem>,
) where
    C: AgentCreations,
    P: ChannelReferenceSharePermissions,
{
    for (attempt, delay) in CREATION_RECHECK_DELAYS.into_iter().enumerate() {
        tokio::time::sleep(delay).await;
        let created = match creations
            .created_since(bot, &person, requested_at, pending.clone())
            .await
        {
            Ok(created) => created,
            Err(error) => {
                tracing::warn!(error = ?error.into(), attempt, "agent creation re-check failed");
                continue;
            }
        };
        if created.is_empty() {
            continue;
        }
        pending.retain(|item| !created.contains(item));
        match permissions
            .update_channel_share_permissions_for_referenced_items(
                person.clone(),
                channel_id,
                created,
            )
            .await
        {
            Ok(results) => record_share_outcomes(&results),
            Err(error) => {
                tracing::warn!(error = ?error.into(), attempt, "sharing agent creations failed");
            }
        }
        if pending.is_empty() {
            return;
        }
    }
    tracing::info!(
        unshared = pending.len(),
        "linked items the bot did not create for this request stay unshared"
    );
}

fn repo_error(error: impl Into<anyhow::Error>) -> rootcause::Report {
    rootcause::report!("channel message delivery failed: {}", error.into())
}

impl<R, E, P, G, C> ChannelMessageDelivery<R, E, P, G, C>
where
    R: ChannelRepo,
    E: ChannelEventDispatcher,
    P: ChannelReferenceSharePermissions + Clone,
    G: MessageRealtime,
    C: AgentCreations,
{
    /// Share, as `person`, the linked items that `bot` created for them since
    /// their latest message in this thread before `replied_at`, the request
    /// the reply answers. One bound covers classic bot replies and agent
    /// session turns alike. Items without a creation record yet are
    /// re-checked in the background; the rest, including anything that
    /// existed before the request, stay unshared.
    #[tracing::instrument(
        skip(self, person, items),
        fields(
            items = items.len(),
            created = tracing::field::Empty,
            shared = tracing::field::Empty,
            not_permitted = tracing::field::Empty,
        ),
        err
    )]
    async fn share_agent_creations(
        &self,
        bot: BotId,
        person: MacroUserIdStr<'static>,
        channel_id: Uuid,
        thread_root: Uuid,
        replied_at: DateTime<Utc>,
        items: Vec<ReferencedShareItem>,
    ) -> anyhow::Result<()> {
        let Some(requested_at) = self
            .creations
            .request_sent_at(thread_root, &person, replied_at)
            .await
            .map_err(Into::into)?
        else {
            return Ok(());
        };
        let created = self
            .creations
            .created_since(bot, &person, requested_at, items.clone())
            .await
            .map_err(Into::into)?;
        tracing::Span::current().record("created", created.len());
        let pending: Vec<_> = items
            .into_iter()
            .filter(|item| !created.contains(item))
            .collect();
        if !pending.is_empty() {
            let pending_count = pending.len();
            tokio::spawn(
                recheck_agent_creations(
                    self.creations.clone(),
                    self.permissions.clone(),
                    bot,
                    requested_at,
                    person.clone(),
                    channel_id,
                    pending,
                )
                .instrument(tracing::info_span!(
                    "channels.recheck_agent_creations",
                    %channel_id,
                    %bot,
                    %thread_root,
                    pending = pending_count,
                    shared = tracing::field::Empty,
                    not_permitted = tracing::field::Empty,
                )),
            );
        }
        if !created.is_empty() {
            let results = self
                .permissions
                .update_channel_share_permissions_for_referenced_items(person, channel_id, created)
                .await
                .map_err(Into::into)?;
            record_share_outcomes(&results);
        }
        Ok(())
    }

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

impl<R, E, P, G, C> MessageEventPublisher for ChannelMessageDelivery<R, E, P, G, C>
where
    R: ChannelRepo,
    E: ChannelEventDispatcher,
    P: ChannelReferenceSharePermissions + Clone,
    G: MessageRealtime,
    C: AgentCreations,
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
                    ReferencedShareItem::from_raw(mention.entity_id.clone(), &mention.entity_type)
                }))
                .collect::<Vec<_>>();
            if !items.is_empty() {
                // A person shares what they link. A bot shares, as the person
                // it posted for, only what it created for their request.
                let shared = if let Some(user) = actor.as_user() {
                    self.permissions
                        .update_channel_share_permissions_for_referenced_items(
                            user.clone(),
                            channel_id,
                            items,
                        )
                        .await
                        .map(drop)
                        .map_err(Into::into)
                } else if let Some(bot) = actor.as_bot()
                    && let Some(person) = triggering_person(message)
                {
                    self.share_agent_creations(
                        bot.bot_id(),
                        person,
                        channel_id,
                        message.thread_id.unwrap_or(message.id),
                        message.created_at,
                        items,
                    )
                    .await
                } else {
                    Ok(())
                };
                if let Err(error) = shared {
                    side_effect_error = Some(repo_error(error));
                }
            }
            if actor.as_user().is_some()
                && let Err(error) = self.repo.upsert_activity(actor.clone(), channel_id).await
            {
                side_effect_error = Some(repo_error(error));
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
            MessageChange::ReactionChanged {
                message,
                emoji,
                added,
            } => {
                if actor.as_user().is_some()
                    && let Err(error) = self.repo.upsert_activity(actor.clone(), channel_id).await
                {
                    side_effect_error = Some(repo_error(error));
                }
                if *added
                    && let Some(message_sender_id) = message.sender_id.as_user()
                    && actor
                        .as_user()
                        .is_some_and(|reactor| reactor != message_sender_id)
                {
                    match self
                        .repo
                        .get_channel_metadata(channel_id, message_sender_id.clone())
                        .await
                    {
                        Ok(metadata) => self.events.dispatch(ChannelEvent::ReactionAdded {
                            channel_id,
                            actor: actor.clone(),
                            message_id: message.id,
                            notification: ReactionNotificationContext {
                                emoji: emoji.clone(),
                                message_sender: message.sender_id.clone(),
                                thread_id: message.thread_id,
                                message_content: message.content.clone(),
                                metadata,
                            },
                        }),
                        Err(_) => tracing::warn!(
                            %channel_id,
                            message_id = %message.id,
                            "unable to build reaction notification context"
                        ),
                    }
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
