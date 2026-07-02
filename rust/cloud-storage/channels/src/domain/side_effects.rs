//! Domain policies for channel side effects.

use crate::domain::{
    events::ChannelEvent,
    models::{
        BotId, BotSenderProfile, ChannelMetadata, ChannelParticipant, ChannelType, CountedReaction,
        MutatedAttachment, MutatedMessage, PostMessageNotificationPolicy, Sender, SimpleMention,
        TypingAction,
    },
    ports::{
        ChannelContactsDispatcher, ChannelEventDispatcher, ChannelEventHandler,
        ChannelNotificationSender, ChannelRealtimePublisher, ChannelSearchIndexer,
        ChannelSideEffectContext,
    },
};
use bot_id::BotIdStr;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use std::collections::HashSet;
use tokio::sync::mpsc::UnboundedSender;
use uuid::Uuid;

/// Entity type used by message mentions that target a bot.
pub const BOT_MENTION_ENTITY_TYPE: &str = "bot";

/// A trigger derived from a channel message that mentions one or more bots.
#[derive(Debug, Clone)]
pub struct ChannelBotTrigger {
    /// Channel containing the triggering message.
    pub channel_id: Uuid,
    /// The user-authored message that mentioned the bot(s).
    pub message: MutatedMessage,
    /// Bots mentioned in the message.
    pub bot_ids: Vec<BotId>,
}

/// Sender for bot triggers derived from channel messages.
pub type ChannelBotTriggerSender = UnboundedSender<ChannelBotTrigger>;

/// Collect the bot ids mentioned in a message.
///
/// Bot mentions normally arrive tagged `bot`, but Macro AI is surfaced through
/// the user-mention UI, so a `user` mention whose id is exactly the Macro AI
/// bot is recognized as a bot mention too.
fn bot_mention_ids(mentions: &[SimpleMention]) -> Vec<BotId> {
    let mut seen = HashSet::new();
    mentions
        .iter()
        .filter_map(|mention| match mention.entity_type.as_str() {
            BOT_MENTION_ENTITY_TYPE => BotId::parse_uuid_str(&mention.entity_id).ok(),
            "user" => BotId::parse_uuid_str(&mention.entity_id)
                .ok()
                .filter(|id| *id == bot_id::MACRO_AI_BOT_ID),
            _ => None,
        })
        .filter(|id| seen.insert(*id))
        .collect()
}

/// Whether a `user`-tagged mention actually targets a bot (and so must not be
/// treated as a user recipient). Real user ids are not bare UUIDs, so this only
/// matches the Macro AI bot surfaced through the user-mention UI.
fn is_bot_user_mention(mention: &SimpleMention) -> bool {
    mention.entity_type == "user"
        && BotId::parse_uuid_str(&mention.entity_id).ok() == Some(bot_id::MACRO_AI_BOT_ID)
}

/// Realtime update requested by the channel domain.
#[derive(Debug, Clone)]
pub enum ChannelRealtimeEffect {
    /// A message was created or changed.
    Message {
        /// Recipients that should receive the update.
        recipients: Vec<MacroUserIdStr<'static>>,
        /// Persisted message payload.
        message: Box<MutatedMessage>,
        /// Public bot profile when the sender is a bot.
        bot_profile: Option<BotSenderProfile>,
        /// Client mutation nonce echoed to listeners.
        nonce: Option<String>,
    },
    /// Message attachments changed.
    Attachments {
        /// Recipients that should receive the update.
        recipients: Vec<MacroUserIdStr<'static>>,
        /// Channel containing the message.
        channel_id: Uuid,
        /// Message whose attachments changed.
        message_id: Uuid,
        /// Current attachment set.
        attachments: Vec<MutatedAttachment>,
        /// Client mutation nonce echoed to listeners.
        nonce: Option<String>,
    },
    /// Message reactions changed.
    Reaction {
        /// Recipients that should receive the update.
        recipients: Vec<MacroUserIdStr<'static>>,
        /// Channel containing the message.
        channel_id: Uuid,
        /// Message whose reactions changed.
        message_id: Uuid,
        /// Current grouped reaction state.
        reactions: Vec<CountedReaction>,
        /// Client mutation nonce echoed to listeners.
        nonce: Option<String>,
    },
    /// Typing state changed.
    Typing {
        /// Recipients that should receive the update.
        recipients: Vec<MacroUserIdStr<'static>>,
        /// Channel containing the typing update.
        channel_id: Uuid,
        /// User whose typing state changed.
        user_id: String,
        /// Typing action.
        action: TypingAction,
        /// Optional thread id for thread-scoped typing.
        thread_id: Option<Uuid>,
        /// Client mutation nonce echoed to listeners.
        nonce: Option<String>,
    },
}

/// The sender of a channel message for notification purposes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NotificationSender {
    /// A user sender.
    User(MacroUserIdStr<'static>),
    /// A bot sender resolved to its public display name.
    Bot {
        /// Bot display name.
        name: String,
    },
}

impl NotificationSender {
    /// The sender's user id, when the sender is a user.
    pub fn as_user(&self) -> Option<&MacroUserIdStr<'static>> {
        match self {
            NotificationSender::User(id) => Some(id),
            NotificationSender::Bot { .. } => None,
        }
    }

    /// The sender's display name, when the sender is a bot.
    pub fn display_name(&self) -> Option<&str> {
        match self {
            NotificationSender::User(_) => None,
            NotificationSender::Bot { name } => Some(name),
        }
    }
}

/// Shared channel-message notification payload.
#[derive(Debug, Clone)]
pub struct ChannelMentionNotification {
    /// Channel containing the message.
    pub channel_id: Uuid,
    /// Message body.
    pub message_content: String,
    /// Message id.
    pub message_id: Uuid,
    /// Whether the message has attachments.
    pub has_attachments: bool,
    /// Optional thread parent id.
    pub thread_id: Option<Uuid>,
    /// Channel display metadata.
    pub metadata: ChannelMetadata,
    /// Optional sender profile picture URL.
    pub sender_profile_picture_url: Option<String>,
    /// Message sender.
    pub sender: NotificationSender,
}

/// Metadata for a mentioned document.
#[derive(Debug, Clone)]
pub struct ChannelDocumentMention {
    /// Document display name.
    pub document_name: String,
    /// Document owner.
    pub owner: MacroUserIdStr<'static>,
    /// Optional document file type.
    pub file_type: Option<String>,
    /// Optional document subtype.
    pub sub_type: Option<String>,
}

/// Thread context needed for reply notifications.
#[derive(Debug, Clone, Default)]
pub struct ThreadNotificationContext {
    /// Users participating in the thread.
    pub participants: Vec<MacroUserIdStr<'static>>,
    /// Sender of the thread parent message.
    pub parent_sender_id: Option<MacroUserIdStr<'static>>,
}

/// Notification requested by the channel domain.
#[derive(Debug, Clone)]
pub enum ChannelNotificationEffect {
    /// A user was mentioned in a channel message.
    UserMention {
        /// Common mention payload.
        mention: ChannelMentionNotification,
        /// Users that should receive the notification.
        recipient_ids: HashSet<MacroUserIdStr<'static>>,
    },
    /// A document was mentioned in a channel message.
    DocumentMention {
        /// Common mention payload.
        mention: ChannelMentionNotification,
        /// Mentioned document metadata.
        document: ChannelDocumentMention,
        /// Users that should receive the notification.
        recipient_ids: HashSet<MacroUserIdStr<'static>>,
    },
    /// A reply was posted in a thread.
    Reply {
        /// Channel containing the message.
        channel_id: Uuid,
        /// Thread parent id.
        thread_id: Uuid,
        /// Reply message id.
        message_id: Uuid,
        /// Message sender.
        sender: NotificationSender,
        /// Reply body.
        message_content: String,
        /// Whether the reply has attachments.
        has_attachments: bool,
        /// Sender of the thread parent message.
        thread_parent_sender_id: Option<MacroUserIdStr<'static>>,
        /// Channel display metadata.
        metadata: ChannelMetadata,
        /// Optional sender profile picture URL.
        sender_profile_picture_url: Option<String>,
        /// Users that should receive the notification.
        recipient_ids: HashSet<MacroUserIdStr<'static>>,
    },
    /// A normal channel message was posted.
    ChannelMessage {
        /// Channel containing the message.
        channel_id: Uuid,
        /// Message id.
        message_id: Uuid,
        /// Message sender.
        sender: NotificationSender,
        /// Message body.
        message_content: String,
        /// Whether the message has attachments.
        has_attachments: bool,
        /// Channel display metadata.
        metadata: ChannelMetadata,
        /// Optional sender profile picture URL.
        sender_profile_picture_url: Option<String>,
        /// Users that should receive the notification.
        recipient_ids: HashSet<MacroUserIdStr<'static>>,
    },
    /// Participants were invited to a channel.
    Invite {
        /// Channel receiving participants.
        channel_id: Uuid,
        /// User that invited the participants.
        invited_by_user_id: MacroUserIdStr<'static>,
        /// Existing application users.
        registered_recipient_ids: HashSet<MacroUserIdStr<'static>>,
        /// Recipients that do not yet exist as application users.
        unregistered_recipient_ids: HashSet<MacroUserIdStr<'static>>,
        /// Optional inviter profile picture URL.
        sender_profile_picture_url: Option<String>,
        /// Optional message content associated with the invite.
        message_content: Option<String>,
        /// Channel display metadata.
        metadata: ChannelMetadata,
    },
}

/// Domain service that derives and dispatches side effects for channel events.
#[derive(Clone)]
pub struct ChannelSideEffectService<C, R, N, S, K> {
    context: C,
    realtime: R,
    notifications: N,
    search: S,
    contacts: K,
    bot_triggers: Option<ChannelBotTriggerSender>,
}

struct MessagePostedSideEffects {
    channel_id: Uuid,
    metadata: ChannelMetadata,
    participants: Vec<ChannelParticipant>,
    message: MutatedMessage,
    mentions: Vec<SimpleMention>,
    has_attachments: bool,
    attachments: Vec<MutatedAttachment>,
    nonce: Option<String>,
    notification_policy: PostMessageNotificationPolicy,
}

struct InviteNotificationRequest {
    channel_id: Uuid,
    invited_by_user_id: MacroUserIdStr<'static>,
    recipient_user_ids: Vec<MacroUserIdStr<'static>>,
    existing_user_ids: HashSet<String>,
    sender_profile_picture_url: Option<String>,
    message_content: Option<String>,
    metadata: ChannelMetadata,
}

impl<C, R, N, S, K> ChannelSideEffectService<C, R, N, S, K> {
    /// Create a channel side-effect service.
    pub fn new(context: C, realtime: R, notifications: N, search: S, contacts: K) -> Self {
        Self {
            context,
            realtime,
            notifications,
            search,
            contacts,
            bot_triggers: None,
        }
    }

    /// Configure a sender for bot triggers derived from channel messages.
    pub fn with_bot_trigger_sender(mut self, bot_triggers: ChannelBotTriggerSender) -> Self {
        self.bot_triggers = Some(bot_triggers);
        self
    }

    /// Dispatch bot triggers for any bots mentioned in a user-authored message.
    fn dispatch_bot_triggers(
        &self,
        channel_id: Uuid,
        message: &MutatedMessage,
        mentions: &[SimpleMention],
    ) {
        // Only user-authored messages can trigger bots; this prevents bots
        // (including Macro AI) from triggering each other in a loop.
        if message.sender_id.as_user().is_none() {
            return;
        }
        let bot_ids = bot_mention_ids(mentions);
        if bot_ids.is_empty() {
            return;
        }

        if let Some(bot_triggers) = &self.bot_triggers
            && bot_triggers
                .send(ChannelBotTrigger {
                    channel_id,
                    message: message.clone(),
                    bot_ids,
                })
                .is_err()
        {
            tracing::warn!(
                channel_id = %channel_id,
                message_id = %message.id,
                "unable to enqueue channel bot trigger; receiver was dropped"
            );
        }
    }
}

/// Channel event dispatcher that handles events on spawned tasks.
#[derive(Clone)]
pub struct SpawnedChannelEventDispatcher<H> {
    handler: H,
}

impl<H> SpawnedChannelEventDispatcher<H> {
    /// Create a spawned event dispatcher.
    pub fn new(handler: H) -> Self {
        Self { handler }
    }
}

impl<H> ChannelEventDispatcher for SpawnedChannelEventDispatcher<H>
where
    H: ChannelEventHandler,
{
    fn dispatch(&self, event: ChannelEvent) {
        let handler = self.handler.clone();
        tokio::spawn(async move {
            handler.handle(event).await;
        });
    }
}

impl<C, R, N, S, K> ChannelEventHandler for ChannelSideEffectService<C, R, N, S, K>
where
    C: ChannelSideEffectContext + Clone,
    R: ChannelRealtimePublisher + Clone,
    N: ChannelNotificationSender + Clone,
    S: ChannelSearchIndexer + Clone,
    K: ChannelContactsDispatcher + Clone,
{
    async fn handle(&self, event: ChannelEvent) {
        let contact_sync_users = contact_sync_users_for_event(&event);

        match event {
            ChannelEvent::ChannelCreated { .. } => {}
            ChannelEvent::ChannelDeleted { channel_id, .. } => {
                self.search.remove_message(channel_id, None).await;
            }
            ChannelEvent::MessagePosted {
                channel_id,
                metadata,
                participants,
                message,
                mentions,
                has_attachments,
                attachments,
                nonce,
                notification_policy,
            } => {
                self.handle_message_posted(MessagePostedSideEffects {
                    channel_id,
                    metadata,
                    participants,
                    message,
                    mentions,
                    has_attachments,
                    attachments,
                    nonce,
                    notification_policy,
                })
                .await;
            }
            ChannelEvent::AttachmentsChanged {
                channel_id,
                message_id,
                attachments,
                recipients,
                nonce,
                ..
            } => {
                self.publish_realtime(ChannelRealtimeEffect::Attachments {
                    recipients,
                    channel_id,
                    message_id,
                    attachments,
                    nonce,
                })
                .await;
                self.search.index_message(channel_id, message_id).await;
            }
            ChannelEvent::MessageChanged {
                channel_id,
                message,
                recipients,
                nonce,
                posted_notification,
                ..
            } => {
                let message_id = message.id;
                let bot_profile = self.bot_profile_for_message(&message).await;
                self.publish_realtime(ChannelRealtimeEffect::Message {
                    recipients,
                    message: Box::new(message.clone()),
                    bot_profile: bot_profile.clone(),
                    nonce,
                })
                .await;
                self.search.index_message(channel_id, message_id).await;

                if let Some(notification) = posted_notification {
                    self.send_message_posted_notifications(PostedMessageNotificationInputs {
                        channel_id,
                        metadata: notification.metadata,
                        participants: notification.participants,
                        message,
                        mentions: notification.mentions,
                        has_attachments: notification.has_attachments,
                        bot_profile,
                    })
                    .await;
                }
            }
            ChannelEvent::MessageDeleted {
                channel_id,
                message,
                recipients,
                nonce,
                ..
            } => {
                let message_id = message.id;
                let bot_profile = self.bot_profile_for_message(&message).await;
                self.publish_realtime(ChannelRealtimeEffect::Message {
                    recipients,
                    message: Box::new(message),
                    bot_profile,
                    nonce,
                })
                .await;
                self.search
                    .remove_message(channel_id, Some(message_id))
                    .await;
            }
            ChannelEvent::ReactionChanged {
                channel_id,
                message_id,
                reactions,
                recipients,
                nonce,
                ..
            } => {
                self.publish_realtime(ChannelRealtimeEffect::Reaction {
                    recipients,
                    channel_id,
                    message_id,
                    reactions,
                    nonce,
                })
                .await;
            }
            ChannelEvent::TypingChanged {
                channel_id,
                actor,
                action,
                thread_id,
                recipients,
                nonce,
            } => {
                self.publish_realtime(ChannelRealtimeEffect::Typing {
                    recipients,
                    channel_id,
                    user_id: actor.to_storage_string(),
                    action,
                    thread_id,
                    nonce,
                })
                .await;
            }
            ChannelEvent::ParticipantsAdded {
                channel_id,
                invited_by,
                recipient_user_ids,
                metadata,
                message_content,
                ..
            } => {
                if let Some(invited_by_user_id) = invited_by.as_user().cloned() {
                    self.send_participants_added_notification(
                        channel_id,
                        invited_by_user_id,
                        recipient_user_ids,
                        metadata,
                        message_content,
                    )
                    .await;
                }
            }
            ChannelEvent::ParticipantJoined { .. } => {}
        }

        if let Some(users) = contact_sync_users
            && let Err(err) = self.contacts.enqueue_contacts(users).await
        {
            let err: anyhow::Error = err.into();
            tracing::error!(error=?err, "unable to enqueue channel contact sync");
        }
    }
}

impl<C, R, N, S, K> ChannelSideEffectService<C, R, N, S, K>
where
    C: ChannelSideEffectContext + Clone,
    R: ChannelRealtimePublisher + Clone,
    N: ChannelNotificationSender + Clone,
    S: ChannelSearchIndexer + Clone,
    K: ChannelContactsDispatcher + Clone,
{
    async fn handle_message_posted(&self, event: MessagePostedSideEffects) {
        let MessagePostedSideEffects {
            channel_id,
            metadata,
            participants,
            message,
            mentions,
            has_attachments,
            attachments,
            nonce,
            notification_policy,
        } = event;
        let recipients = participant_ids(&participants);
        let bot_profile = self.bot_profile_for_message(&message).await;
        self.publish_realtime(ChannelRealtimeEffect::Message {
            recipients: recipients.clone(),
            message: Box::new(message.clone()),
            bot_profile: bot_profile.clone(),
            nonce: nonce.clone(),
        })
        .await;

        if !attachments.is_empty() {
            self.publish_realtime(ChannelRealtimeEffect::Attachments {
                recipients,
                channel_id,
                message_id: message.id,
                attachments,
                nonce,
            })
            .await;
        }

        self.search.index_message(channel_id, message.id).await;
        self.dispatch_bot_triggers(channel_id, &message, &mentions);
        if notification_policy == PostMessageNotificationPolicy::Default {
            self.send_message_posted_notifications(PostedMessageNotificationInputs {
                channel_id,
                metadata,
                participants,
                message,
                mentions,
                has_attachments,
                bot_profile,
            })
            .await;
        }
    }

    /// Resolve the public bot profile when the message sender is a bot.
    async fn bot_profile_for_message(&self, message: &MutatedMessage) -> Option<BotSenderProfile> {
        let bot_id = message.sender_id.as_bot()?.bot_id();
        if bot_id == bot_id::MACRO_AI_BOT_ID {
            return Some(BotSenderProfile {
                name: bot_id::MACRO_AI_NAME.to_string(),
                avatar_url: None,
            });
        }
        self.context.get_bot_sender_profile(bot_id).await
    }

    async fn publish_realtime(&self, effect: ChannelRealtimeEffect) {
        if let Err(err) = self.realtime.publish(effect).await {
            let err: anyhow::Error = err.into();
            tracing::error!(error=?err, "unable to dispatch channel realtime event");
        }
    }

    async fn send_notification(&self, effect: ChannelNotificationEffect) {
        if let Err(err) = self.notifications.send(effect).await {
            let err: anyhow::Error = err.into();
            tracing::error!(error=?err, "unable to dispatch channel notification event");
        }
    }

    async fn send_message_posted_notifications(&self, inputs: PostedMessageNotificationInputs) {
        let PostedMessageNotificationInputs {
            channel_id,
            metadata,
            participants,
            message,
            mentions,
            has_attachments,
            bot_profile,
        } = inputs;
        let resolved_sender = if let Some(user_id) = message.sender_id.as_user() {
            let user_id = user_id.clone();
            ResolvedNotificationSender {
                sender: NotificationSender::User(user_id.clone()),
                profile_picture_url: self
                    .context
                    .get_sender_profile_picture_url(user_id.clone())
                    .await,
            }
        } else if let Some(bot_id) = message.sender_id.as_bot().map(|id| id.bot_id()) {
            match bot_profile {
                Some(profile) => ResolvedNotificationSender {
                    sender: NotificationSender::Bot { name: profile.name },
                    profile_picture_url: profile.avatar_url,
                },
                None => {
                    tracing::warn!(bot_id = %bot_id, "missing bot profile, skipping message notifications");
                    return;
                }
            }
        } else {
            return;
        };
        let context = match self
            .build_posted_message_context(
                channel_id,
                metadata,
                &participants,
                &message,
                resolved_sender,
                mentions,
            )
            .await
        {
            Ok(context) => context,
            Err(err) => {
                tracing::error!(error=?err, "unable to build channel notification context");
                return;
            }
        };

        self.send_user_mention_notifications(channel_id, &message, has_attachments, &context)
            .await;
        self.send_document_mention_notifications(channel_id, &message, has_attachments, &context)
            .await;

        if let Some(thread_id) = message.thread_id {
            self.send_reply_notification(
                thread_id,
                channel_id,
                &message,
                has_attachments,
                &context,
            )
            .await;
        } else if context.is_first_top_level_message && context.sender.as_user().is_some() {
            // Bot first messages fall through to a regular channel-message
            // notification; invites (which can email unregistered users) are
            // only sent on behalf of user senders.
            self.send_first_message_invites(channel_id, &message, context)
                .await;
        } else {
            self.send_channel_message_notification(channel_id, &message, has_attachments, &context)
                .await;
        }
    }

    async fn build_posted_message_context(
        &self,
        channel_id: Uuid,
        metadata: ChannelMetadata,
        participants: &[ChannelParticipant],
        message: &MutatedMessage,
        resolved_sender: ResolvedNotificationSender,
        mentions: Vec<SimpleMention>,
    ) -> anyhow::Result<PostedMessageNotificationContext> {
        let ResolvedNotificationSender {
            sender,
            profile_picture_url: sender_profile_picture_url,
        } = resolved_sender;
        let message_count = self
            .context
            .get_channel_message_count(channel_id)
            .await
            .map_err(Into::into)?;
        let is_first_top_level_message = message_count <= 1 && message.thread_id.is_none();
        let existing_user_ids = if is_first_top_level_message && sender.as_user().is_some() {
            let participant_ids: Vec<_> = participants
                .iter()
                .filter_map(|participant| MacroUserIdStr::parse_from_str(&participant.user_id).ok())
                .map(|id| id.into_owned())
                .collect();
            self.context
                .get_existing_user_ids(participant_ids)
                .await
                .map_err(Into::into)?
        } else {
            HashSet::new()
        };

        let (user_mentions, document_mention_ids) = mentions.into_iter().fold(
            (Vec::new(), Vec::new()),
            |(mut users, mut docs), mention| {
                match mention.entity_type.as_str() {
                    // The Macro AI bot is mentioned via the user-mention UI; it
                    // is handled as a bot trigger, not a user notification.
                    "user" if !is_bot_user_mention(&mention) => users.push(mention.entity_id),
                    "document" => docs.push(mention.entity_id),
                    _ => {}
                }
                (users, docs)
            },
        );
        let document_mentions = self.load_document_mentions(document_mention_ids).await;
        let thread_context = self
            .load_thread_notification_context(message.thread_id)
            .await;
        let excluded_user_ids = sender
            .as_user()
            .map(|user_id| user_id.as_ref().to_string())
            .into_iter()
            .chain(user_mentions.iter().cloned())
            .collect::<Vec<_>>();
        let recipients_without_sender = recipients_excluding(
            participants
                .iter()
                .map(|participant| participant.user_id.as_str()),
            sender.as_user().map(|user_id| user_id.as_ref()),
        )
        .collect();
        let recipients_without_sender_and_mentions = recipients_excluding(
            participants
                .iter()
                .map(|participant| participant.user_id.as_str()),
            excluded_user_ids.iter().map(String::as_str),
        )
        .collect();

        Ok(PostedMessageNotificationContext {
            metadata,
            sender,
            sender_profile_picture_url,
            user_mentions,
            document_mentions,
            thread_context,
            excluded_user_ids,
            recipients_without_sender,
            recipients_without_sender_and_mentions,
            existing_user_ids,
            is_first_top_level_message,
        })
    }

    async fn load_document_mentions(
        &self,
        document_mention_ids: Vec<String>,
    ) -> Vec<ChannelDocumentMention> {
        if document_mention_ids.is_empty() {
            return Vec::new();
        }

        match self
            .context
            .get_document_mentions(document_mention_ids)
            .await
        {
            Ok(document_mentions) => document_mentions,
            Err(err) => {
                let err: anyhow::Error = err.into();
                tracing::error!(error=?err, "unable to get documents metadata");
                Vec::new()
            }
        }
    }

    async fn load_thread_notification_context(
        &self,
        thread_id: Option<Uuid>,
    ) -> ThreadNotificationContext {
        match thread_id {
            Some(thread_id) => self
                .context
                .get_thread_notification_context(thread_id)
                .await
                .unwrap_or_default(),
            None => ThreadNotificationContext::default(),
        }
    }

    async fn send_user_mention_notifications(
        &self,
        channel_id: Uuid,
        message: &MutatedMessage,
        has_attachments: bool,
        context: &PostedMessageNotificationContext,
    ) {
        if context.user_mentions.is_empty() {
            return;
        }

        self.send_notification(ChannelNotificationEffect::UserMention {
            mention: ChannelMentionNotification {
                channel_id,
                message_content: message.content.clone(),
                message_id: message.id,
                has_attachments,
                thread_id: message.thread_id,
                metadata: context.metadata.clone(),
                sender_profile_picture_url: context.sender_profile_picture_url.clone(),
                sender: context.sender.clone(),
            },
            recipient_ids: recipients_excluding(
                context.user_mentions.iter().map(String::as_str),
                context.sender.as_user().map(|user_id| user_id.as_ref()),
            )
            .collect(),
        })
        .await;
    }

    async fn send_document_mention_notifications(
        &self,
        channel_id: Uuid,
        message: &MutatedMessage,
        has_attachments: bool,
        context: &PostedMessageNotificationContext,
    ) {
        if context.document_mentions.is_empty() {
            return;
        }

        for document in &context.document_mentions {
            self.send_notification(ChannelNotificationEffect::DocumentMention {
                mention: ChannelMentionNotification {
                    channel_id,
                    message_content: message.content.clone(),
                    message_id: message.id,
                    has_attachments,
                    thread_id: message.thread_id,
                    metadata: context.metadata.clone(),
                    sender_profile_picture_url: context.sender_profile_picture_url.clone(),
                    sender: context.sender.clone(),
                },
                document: document.clone(),
                recipient_ids: context.recipients_without_sender.clone(),
            })
            .await;
        }
    }

    async fn send_reply_notification(
        &self,
        thread_id: Uuid,
        channel_id: Uuid,
        message: &MutatedMessage,
        has_attachments: bool,
        context: &PostedMessageNotificationContext,
    ) {
        if context.thread_context.participants.is_empty() {
            tracing::warn!(thread_id = %thread_id, "thread participants is empty, but message has thread id");
            return;
        }

        self.send_notification(ChannelNotificationEffect::Reply {
            channel_id,
            thread_id,
            message_id: message.id,
            sender: context.sender.clone(),
            message_content: message.content.clone(),
            has_attachments,
            thread_parent_sender_id: context.thread_context.parent_sender_id.clone(),
            metadata: context.metadata.clone(),
            sender_profile_picture_url: context.sender_profile_picture_url.clone(),
            recipient_ids: recipients_excluding(
                context
                    .thread_context
                    .participants
                    .iter()
                    .map(|participant| participant.as_ref()),
                context.excluded_user_ids.iter().map(String::as_str),
            )
            .collect(),
        })
        .await;
    }

    async fn send_first_message_invites(
        &self,
        channel_id: Uuid,
        message: &MutatedMessage,
        context: PostedMessageNotificationContext,
    ) {
        let Some(invited_by_user_id) = context.sender.as_user().cloned() else {
            return;
        };
        self.send_invite_notification(InviteNotificationRequest {
            channel_id,
            invited_by_user_id,
            recipient_user_ids: context
                .recipients_without_sender_and_mentions
                .into_iter()
                .collect(),
            existing_user_ids: context.existing_user_ids,
            sender_profile_picture_url: context.sender_profile_picture_url,
            message_content: Some(message.content.clone()),
            metadata: context.metadata,
        })
        .await;
    }

    async fn send_channel_message_notification(
        &self,
        channel_id: Uuid,
        message: &MutatedMessage,
        has_attachments: bool,
        context: &PostedMessageNotificationContext,
    ) {
        self.send_notification(ChannelNotificationEffect::ChannelMessage {
            channel_id,
            message_id: message.id,
            sender: context.sender.clone(),
            message_content: message.content.clone(),
            has_attachments,
            metadata: context.metadata.clone(),
            sender_profile_picture_url: context.sender_profile_picture_url.clone(),
            recipient_ids: context.recipients_without_sender_and_mentions.clone(),
        })
        .await;
    }

    async fn send_participants_added_notification(
        &self,
        channel_id: Uuid,
        invited_by_user_id: MacroUserIdStr<'static>,
        recipient_user_ids: Vec<MacroUserIdStr<'static>>,
        metadata: ChannelMetadata,
        message_content: Option<String>,
    ) {
        let sender_profile_picture_url = self
            .context
            .get_sender_profile_picture_url(invited_by_user_id.clone())
            .await;
        let existing_user_ids = match self
            .context
            .get_existing_user_ids(recipient_user_ids.clone())
            .await
        {
            Ok(existing_user_ids) => existing_user_ids,
            Err(err) => {
                let err: anyhow::Error = err.into();
                tracing::error!(error=?err, "unable to get existing users for invite");
                HashSet::new()
            }
        };

        self.send_invite_notification(InviteNotificationRequest {
            channel_id,
            invited_by_user_id,
            recipient_user_ids,
            existing_user_ids,
            sender_profile_picture_url,
            message_content,
            metadata,
        })
        .await;
    }

    async fn send_invite_notification(&self, req: InviteNotificationRequest) {
        let InviteNotificationRequest {
            channel_id,
            invited_by_user_id,
            recipient_user_ids,
            existing_user_ids,
            sender_profile_picture_url,
            message_content,
            metadata,
        } = req;
        let (registered_recipient_ids, unregistered_recipient_ids): (HashSet<_>, HashSet<_>) =
            recipient_user_ids
                .into_iter()
                .partition(|id| existing_user_ids.contains(id.as_ref()));

        self.send_notification(ChannelNotificationEffect::Invite {
            channel_id,
            invited_by_user_id,
            registered_recipient_ids,
            unregistered_recipient_ids,
            sender_profile_picture_url,
            message_content,
            metadata,
        })
        .await;
    }
}

/// Inputs for deriving notifications from a posted message.
struct PostedMessageNotificationInputs {
    channel_id: Uuid,
    metadata: ChannelMetadata,
    participants: Vec<ChannelParticipant>,
    message: MutatedMessage,
    mentions: Vec<SimpleMention>,
    has_attachments: bool,
    bot_profile: Option<BotSenderProfile>,
}

/// Sender identity and avatar resolved for notification delivery.
struct ResolvedNotificationSender {
    sender: NotificationSender,
    profile_picture_url: Option<String>,
}

struct PostedMessageNotificationContext {
    metadata: ChannelMetadata,
    sender: NotificationSender,
    sender_profile_picture_url: Option<String>,
    user_mentions: Vec<String>,
    document_mentions: Vec<ChannelDocumentMention>,
    thread_context: ThreadNotificationContext,
    excluded_user_ids: Vec<String>,
    recipients_without_sender: HashSet<MacroUserIdStr<'static>>,
    recipients_without_sender_and_mentions: HashSet<MacroUserIdStr<'static>>,
    existing_user_ids: HashSet<String>,
    is_first_top_level_message: bool,
}

/// Whether a participant principal id refers to a bot (e.g. `bot|<uuid>`).
/// Bots are not user recipients and are not valid `MacroUserIdStr`s, so they are
/// skipped before parsing to avoid spurious parse warnings.
fn is_bot_principal(id: &str) -> bool {
    BotIdStr::parse_from_str(id).is_ok()
}

fn participant_ids(participants: &[ChannelParticipant]) -> Vec<MacroUserIdStr<'static>> {
    participants
        .iter()
        .filter(|p| !is_bot_principal(&p.user_id))
        .filter_map(|p| MacroUserIdStr::parse_from_str(&p.user_id).ok())
        .map(|id| id.into_owned())
        .collect()
}

fn recipients_excluding<'a>(
    recipients: impl IntoIterator<Item = &'a str>,
    exclude: impl IntoIterator<Item = &'a str>,
) -> impl Iterator<Item = MacroUserIdStr<'static>> {
    let exclude_set: HashSet<&str> = exclude.into_iter().collect();
    recipients
        .into_iter()
        .filter(move |id| !exclude_set.contains(id))
        .filter(|id| !is_bot_principal(id))
        .filter_map(|id| MacroUserIdStr::parse_from_str(id).ok())
        .map(|u| u.into_owned())
}

fn contact_sync_users_for_event(event: &ChannelEvent) -> Option<HashSet<MacroUserIdStr<'static>>> {
    match event {
        ChannelEvent::ChannelCreated {
            channel_type: ChannelType::Private | ChannelType::DirectMessage,
            actor: Sender::User(_),
            participant_user_ids,
            ..
        } => Some(participant_user_ids.iter().cloned().collect()),
        ChannelEvent::ParticipantsAdded {
            channel_type: ChannelType::Private | ChannelType::Team,
            invited_by: Sender::User(_),
            active_participant_user_ids,
            ..
        } => Some(active_participant_user_ids.iter().cloned().collect()),
        ChannelEvent::ParticipantJoined {
            channel_type: ChannelType::Public | ChannelType::Private | ChannelType::Team,
            user_id: Sender::User(_),
            active_participant_user_ids,
            ..
        } if active_participant_user_ids.len() > 1 => {
            Some(active_participant_user_ids.iter().cloned().collect())
        }
        _ => None,
    }
}

#[cfg(test)]
mod test;
