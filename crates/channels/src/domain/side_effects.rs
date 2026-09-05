//! Domain policies for channel side effects.

use crate::domain::{
    broker_events::{
        ChannelCreatedMetadata, ChannelDeletedMetadata, ChannelEventAttachment, ChannelMacroEvent,
        ChannelMentionedMetadata, ChannelMessageAttachmentCreatedMetadata,
        ChannelMessageAttachmentRemovedMetadata, ChannelMessageDeletedMetadata,
        ChannelMessagePatchedMetadata, ChannelMessagePostedMetadata,
        ChannelParticipantAddedMetadata, ChannelParticipantRemovedMetadata, ChannelUpdatedMetadata,
    },
    events::ChannelEvent,
    mention_events::{EntityRef, MentionMacroEvent, MentionMetadata},
    models::{
        BotId, BotSenderProfile, ChannelMetadata, ChannelParticipant, ChannelType, CountedReaction,
        MutatedAttachment, MutatedMessage, PostMessageNotificationPolicy, SimpleMention,
        TypingAction,
    },
    ports::{
        ChannelContactsDispatcher, ChannelEventDispatcher, ChannelEventHandler,
        ChannelNotificationSender, ChannelRealtimePublisher, ChannelSideEffectContext,
    },
};
use bot_id::BotIdStr;
use macro_event_broker::{MacroEventBroker, NoopMacroEventBroker};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use std::collections::HashSet;
use tokio::sync::mpsc::UnboundedSender;
use tracing::Instrument as _;
use uuid::Uuid;

/// Entity type used by message mentions that target a bot.
pub const BOT_MENTION_ENTITY_TYPE: &str = "bot";

/// A bot-trigger candidate derived from a user-authored channel message.
///
/// Every user-authored message is a candidate; whether it actually triggers a
/// bot (explicit mention or inferred invocation) is decided downstream by the
/// consumer.
#[derive(Debug, Clone)]
pub struct ChannelBotTrigger {
    /// Channel containing the candidate message.
    pub channel_id: Uuid,
    /// The user-authored message.
    pub message: MutatedMessage,
    /// Bots explicitly mentioned in the message that are active in the
    /// channel. Empty when the message mentions no bot.
    pub mentioned_bot_ids: Vec<BotId>,
    /// Trace active when the candidate was dispatched.
    pub span: tracing::Span,
}

/// Sender for bot-trigger candidates derived from channel messages.
pub type ChannelBotTriggerSender = UnboundedSender<ChannelBotTrigger>;

/// Collect the bot ids mentioned in a message.
///
/// Bot mentions normally arrive tagged `bot`, but Macro AI is surfaced through
/// the user-mention UI, so a `user` mention whose id is exactly the Macro AI
/// bot is recognized as a bot mention too.
///
/// Ids must be in the canonical `bot|<uuid>` principal form; bare UUIDs are
/// rejected (historical bare-UUID content is normalized by migration).
///
/// Public because out-of-process consumers have to derive the same answer: the
/// in-process path gets [`ChannelBotTrigger::bot_ids`] for free, while anything
/// reading `channel.message_posted` off Kafka only has the mention list and
/// would otherwise reimplement these rules.
pub fn bot_mention_ids(mentions: &[SimpleMention]) -> Vec<BotId> {
    let mut seen = HashSet::new();
    mentions
        .iter()
        .filter_map(|mention| match mention.entity_type.as_str() {
            BOT_MENTION_ENTITY_TYPE => mention_bot_id(&mention.entity_id),
            "user" => {
                mention_bot_id(&mention.entity_id).filter(|id| *id == bot_id::MACRO_AI_BOT_ID)
            }
            _ => None,
        })
        .filter(|id| seen.insert(*id))
        .collect()
}

/// Collect mentioned bots that are active participants in the channel.
///
/// Mention payloads are client-controlled, so a syntactically valid bot id is
/// not sufficient to dispatch a trigger or publish a bot-mention event.
fn active_bot_mention_ids(
    mentions: &[SimpleMention],
    participants: &[ChannelParticipant],
) -> Vec<BotId> {
    let mut active_bot_ids: HashSet<_> = participants
        .iter()
        .filter(|participant| participant.left_at.is_none())
        .filter_map(|participant| {
            BotIdStr::parse_from_str(&participant.user_id)
                .ok()
                .map(|id| id.bot_id())
        })
        .collect();
    // Code-defined system bots are available in every channel and have no
    // participant rows.
    active_bot_ids.insert(bot_id::MACRO_AI_BOT_ID);
    active_bot_ids.insert(bot_id::MACRO_CODER_BOT_ID);

    bot_mention_ids(mentions)
        .into_iter()
        .filter(|bot_id| active_bot_ids.contains(bot_id))
        .collect()
}

/// Parse a mention entity id in the canonical `bot|<uuid>` principal form.
fn mention_bot_id(entity_id: &str) -> Option<BotId> {
    BotIdStr::parse_from_str(entity_id)
        .ok()
        .map(|id| id.bot_id())
}

/// Whether a `user`-tagged mention actually targets a bot (and so must not be
/// treated as a user recipient). Real user ids are `macro|<email>` strings,
/// never `bot|<uuid>` principals, so this only matches the Macro AI bot
/// surfaced through the user-mention UI.
fn is_bot_user_mention(mention: &SimpleMention) -> bool {
    mention.entity_type == "user"
        && mention_bot_id(&mention.entity_id) == Some(bot_id::MACRO_AI_BOT_ID)
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
pub struct ChannelSideEffectService<C, R, N, K, B = NoopMacroEventBroker> {
    context: C,
    realtime: R,
    notifications: N,
    contacts: K,
    bot_triggers: Option<ChannelBotTriggerSender>,
    macro_event_broker: B,
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

impl<C, R, N, K> ChannelSideEffectService<C, R, N, K> {
    /// Create a channel side-effect service that drops broker events.
    ///
    /// Use [`Self::with_macro_event_broker`] to publish channel events to the
    /// macro event broker.
    pub fn new(context: C, realtime: R, notifications: N, contacts: K) -> Self {
        Self {
            context,
            realtime,
            notifications,
            contacts,
            bot_triggers: None,
            macro_event_broker: NoopMacroEventBroker,
        }
    }
}

impl<C, R, N, K, B> ChannelSideEffectService<C, R, N, K, B> {
    /// Configure a sender for bot triggers derived from channel messages.
    pub fn with_bot_trigger_sender(mut self, bot_triggers: ChannelBotTriggerSender) -> Self {
        self.bot_triggers = Some(bot_triggers);
        self
    }

    /// Configure a macro event broker to publish channel events to.
    pub fn with_macro_event_broker<B2: MacroEventBroker>(
        self,
        macro_event_broker: B2,
    ) -> ChannelSideEffectService<C, R, N, K, B2> {
        ChannelSideEffectService {
            context: self.context,
            realtime: self.realtime,
            notifications: self.notifications,
            contacts: self.contacts,
            bot_triggers: self.bot_triggers,
            macro_event_broker,
        }
    }

    /// Dispatch a bot-trigger candidate for a user-authored message.
    fn dispatch_bot_triggers(
        &self,
        channel_id: Uuid,
        message: &MutatedMessage,
        mentions: &[SimpleMention],
        participants: &[ChannelParticipant],
    ) {
        // Only user-authored messages can trigger bots; this prevents bots
        // (including Macro AI) from triggering each other in a loop.
        if message.sender_id.as_user().is_none() {
            return;
        }

        if let Some(bot_triggers) = &self.bot_triggers
            && bot_triggers
                .send(ChannelBotTrigger {
                    channel_id,
                    message: message.clone(),
                    mentioned_bot_ids: active_bot_mention_ids(mentions, participants),
                    span: tracing::info_span!(
                        "channel.bot_trigger",
                        channel.id = %channel_id,
                        channel.message.id = %message.id,
                    ),
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
        tokio::spawn(
            async move {
                handler.handle(event).await;
            }
            .instrument(tracing::info_span!("channel.side_effects")),
        );
    }
}

impl<C, R, N, K, B> ChannelEventHandler for ChannelSideEffectService<C, R, N, K, B>
where
    C: ChannelSideEffectContext + Clone,
    R: ChannelRealtimePublisher + Clone,
    N: ChannelNotificationSender + Clone,
    K: ChannelContactsDispatcher + Clone,
    B: MacroEventBroker + Clone,
{
    async fn handle(&self, event: ChannelEvent) {
        let contact_sync_users = contact_sync_users_for_event(&event);
        let broker_events = broker_events_for_event(&event);
        let mention_broker_events = mention_broker_events_for_event(&event);

        match event {
            ChannelEvent::ChannelCreated { .. } => {}
            ChannelEvent::ChannelUpdated { .. } => {}
            ChannelEvent::ParticipantsRemoved { .. } => {}
            ChannelEvent::EntityMentionCreated { .. } => {}
            ChannelEvent::EntityMentionDeleted { .. } => {}
            ChannelEvent::ChannelDeleted { .. } => {}
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
            }
            ChannelEvent::MessageChanged {
                channel_id,
                message,
                recipients,
                nonce,
                posted_notification,
                ..
            } => {
                let bot_profile = self.bot_profile_for_message(&message).await;
                self.publish_realtime(ChannelRealtimeEffect::Message {
                    recipients,
                    message: Box::new(message.clone()),
                    bot_profile: bot_profile.clone(),
                    nonce,
                })
                .await;

                if let Some(notification) = posted_notification {
                    self.send_message_posted_notifications(PostedMessageNotificationInputs {
                        channel_id,
                        metadata: notification.metadata,
                        participants: notification.participants,
                        message,
                        mentions: notification.mentions,
                        has_attachments: notification.has_attachments,
                        bot_profile,
                        notification_policy: PostMessageNotificationPolicy::Default,
                    })
                    .await;
                }
            }
            ChannelEvent::MessageDeleted {
                message,
                recipients,
                nonce,
                ..
            } => {
                let bot_profile = self.bot_profile_for_message(&message).await;
                self.publish_realtime(ChannelRealtimeEffect::Message {
                    recipients,
                    message: Box::new(message),
                    bot_profile,
                    nonce,
                })
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
                    user_id: actor.as_ref().to_string(),
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

        // Published after the other side effects so broker latency never
        // delays realtime updates or notifications; failures are logged and
        // dropped.
        for broker_event in broker_events {
            let _ = self
                .macro_event_broker
                .send_event(&broker_event)
                .inspect_err(|e| {
                    tracing::error!(error=?e, "failed to publish channel event");
                });
        }
        for mention_event in mention_broker_events {
            let _ = self
                .macro_event_broker
                .send_event(&mention_event)
                .inspect_err(|e| {
                    tracing::error!(error=?e, "failed to publish mention event");
                });
        }
    }
}

impl<C, R, N, K, B> ChannelSideEffectService<C, R, N, K, B>
where
    C: ChannelSideEffectContext + Clone,
    R: ChannelRealtimePublisher + Clone,
    N: ChannelNotificationSender + Clone,
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

        self.dispatch_bot_triggers(channel_id, &message, &mentions, &participants);
        if notification_policy != PostMessageNotificationPolicy::Silent {
            self.send_message_posted_notifications(PostedMessageNotificationInputs {
                channel_id,
                metadata,
                participants,
                message,
                mentions,
                has_attachments,
                bot_profile,
                notification_policy,
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
            notification_policy,
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

        if notification_policy == PostMessageNotificationPolicy::MentionsOnly {
            return;
        }

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
        let recipient_user_ids: Vec<_> = context
            .recipients_without_sender_and_mentions
            .into_iter()
            .collect();
        let existing_user_ids = match self
            .context
            .get_existing_user_ids(recipient_user_ids.clone())
            .await
        {
            Ok(existing_user_ids) => existing_user_ids,
            Err(err) => {
                let err: anyhow::Error = err.into();
                tracing::error!(error=?err, "unable to get existing users for first-message invite");
                return;
            }
        };
        self.send_invite_notification(InviteNotificationRequest {
            channel_id,
            invited_by_user_id,
            recipient_user_ids,
            existing_user_ids,
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
    notification_policy: PostMessageNotificationPolicy,
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
            actor,
            on_behalf_of,
            participant_user_ids,
            ..
        } if actor.as_user().is_some() || on_behalf_of.is_some() => {
            Some(participant_user_ids.iter().cloned().collect())
        }
        ChannelEvent::ParticipantsAdded {
            channel_type: ChannelType::Private | ChannelType::Team,
            invited_by,
            active_participant_user_ids,
            ..
        } if invited_by.as_user().is_some() => {
            Some(active_participant_user_ids.iter().cloned().collect())
        }
        ChannelEvent::ParticipantJoined {
            channel_type: ChannelType::Public | ChannelType::Private | ChannelType::Team,
            user_id,
            active_participant_user_ids,
            ..
        } if user_id.as_user().is_some() && active_participant_user_ids.len() > 1 => {
            Some(active_participant_user_ids.iter().cloned().collect())
        }
        _ => None,
    }
}

/// Map an internal channel event to the wire events published to the
/// `macro.channels` topic.
///
/// Ephemeral events (typing) and reaction changes publish nothing.
fn broker_events_for_event(event: &ChannelEvent) -> Vec<ChannelMacroEvent> {
    match event {
        ChannelEvent::ChannelCreated {
            channel_id,
            actor,
            on_behalf_of,
            channel_type,
            channel_name,
            participant_user_ids,
        } => vec![ChannelMacroEvent::created(ChannelCreatedMetadata {
            channel_id: *channel_id,
            actor: actor.clone(),
            on_behalf_of: on_behalf_of.clone(),
            channel_type: *channel_type,
            channel_name: channel_name.clone(),
            participant_user_ids: participant_user_ids.clone(),
        })],
        ChannelEvent::ChannelUpdated {
            channel_id,
            actor,
            previous_name,
            channel_name,
        } => vec![ChannelMacroEvent::updated(ChannelUpdatedMetadata {
            channel_id: *channel_id,
            actor: actor.clone(),
            previous_name: previous_name.clone(),
            channel_name: channel_name.clone(),
        })],
        ChannelEvent::ChannelDeleted { channel_id, actor } => {
            vec![ChannelMacroEvent::deleted(ChannelDeletedMetadata {
                channel_id: *channel_id,
                actor: actor.clone(),
            })]
        }
        ChannelEvent::MessagePosted {
            channel_id,
            metadata,
            participants,
            message,
            mentions,
            attachments,
            ..
        } => {
            let mut events = vec![ChannelMacroEvent::message_posted(
                ChannelMessagePostedMetadata {
                    channel_id: *channel_id,
                    message_id: message.id,
                    thread_id: message.thread_id,
                    sender: message.sender_id.clone(),
                    triggered_by: message.triggered_by.clone(),
                    channel_type: metadata.channel_type,
                    content: message.content.clone(),
                    mentions: mentions.clone(),
                    attachments: attachments
                        .iter()
                        .map(ChannelEventAttachment::from)
                        .collect(),
                    created_at: message.created_at,
                },
            )];
            if !attachments.is_empty() {
                events.push(ChannelMacroEvent::message_attachment_created(
                    ChannelMessageAttachmentCreatedMetadata {
                        channel_id: *channel_id,
                        message_id: message.id,
                        actor: message.sender_id.clone(),
                        attachments: attachments
                            .iter()
                            .map(ChannelEventAttachment::from)
                            .collect(),
                    },
                ));
            }
            // One mentioned event per distinct mentioned entity. Bot mentions
            // are invocations, so they only emit for bots that are active
            // channel participants (mention payloads are client-controlled).
            // Mentions of other entity kinds — including an author mentioning
            // themselves — pass through; delivery is already scoped to
            // channel access and consumers filter on the payload.
            let active_bots = active_bot_mention_ids(mentions, participants);
            let emits = |mention: &SimpleMention| match mention_bot_id(&mention.entity_id) {
                Some(bot_id) => active_bots.contains(&bot_id),
                // A bot-tagged mention that isn't a canonical bot principal
                // is malformed; other kinds pass through.
                None => mention.entity_type != BOT_MENTION_ENTITY_TYPE,
            };
            let mut seen_mentions = HashSet::new();
            for mention in mentions {
                if !emits(mention) {
                    continue;
                }
                if !seen_mentions.insert((mention.entity_type.as_str(), mention.entity_id.as_str()))
                {
                    continue;
                }
                events.push(ChannelMacroEvent::mentioned(ChannelMentionedMetadata {
                    channel_id: *channel_id,
                    message_id: message.id,
                    thread_id: message.thread_id,
                    sender: message.sender_id.clone(),
                    channel_type: metadata.channel_type,
                    content: message.content.clone(),
                    mentioned: mention.clone(),
                    created_at: message.created_at,
                }));
            }
            events
        }
        ChannelEvent::MessageChanged {
            channel_id,
            actor,
            message,
            ..
        } => vec![ChannelMacroEvent::message_patched(
            ChannelMessagePatchedMetadata {
                channel_id: *channel_id,
                message_id: message.id,
                thread_id: message.thread_id,
                actor: actor.clone(),
                content: message.content.clone(),
                edited_at: message.edited_at,
                updated_at: message.updated_at,
            },
        )],
        ChannelEvent::MessageDeleted {
            channel_id,
            actor,
            message,
            ..
        } => vec![ChannelMacroEvent::message_deleted(
            ChannelMessageDeletedMetadata {
                channel_id: *channel_id,
                message_id: message.id,
                thread_id: message.thread_id,
                actor: actor.clone(),
                deleted_at: message.deleted_at,
            },
        )],
        ChannelEvent::AttachmentsChanged {
            channel_id,
            actor,
            message_id,
            added,
            removed,
            ..
        } => {
            let mut events = Vec::new();
            if !added.is_empty() {
                events.push(ChannelMacroEvent::message_attachment_created(
                    ChannelMessageAttachmentCreatedMetadata {
                        channel_id: *channel_id,
                        message_id: *message_id,
                        actor: actor.clone(),
                        attachments: added.iter().map(ChannelEventAttachment::from).collect(),
                    },
                ));
            }
            if !removed.is_empty() {
                events.push(ChannelMacroEvent::message_attachment_removed(
                    ChannelMessageAttachmentRemovedMetadata {
                        channel_id: *channel_id,
                        message_id: *message_id,
                        actor: actor.clone(),
                        attachments: removed.iter().map(ChannelEventAttachment::from).collect(),
                    },
                ));
            }
            events
        }
        ChannelEvent::ParticipantsAdded {
            channel_id,
            channel_type,
            invited_by,
            recipient_user_ids,
            ..
        } => vec![ChannelMacroEvent::participant_added(
            ChannelParticipantAddedMetadata {
                channel_id: *channel_id,
                channel_type: *channel_type,
                added_by: invited_by.clone(),
                added_user_ids: recipient_user_ids.clone(),
            },
        )],
        ChannelEvent::ParticipantJoined {
            channel_id,
            channel_type,
            user_id,
            ..
        } => user_id
            .as_user()
            .map(|joined| {
                vec![ChannelMacroEvent::participant_added(
                    ChannelParticipantAddedMetadata {
                        channel_id: *channel_id,
                        channel_type: *channel_type,
                        added_by: user_id.clone(),
                        added_user_ids: vec![joined.clone()],
                    },
                )]
            })
            .unwrap_or_default(),
        ChannelEvent::ParticipantsRemoved {
            channel_id,
            channel_type,
            actor,
            removed_user_ids,
        } => vec![ChannelMacroEvent::participant_removed(
            ChannelParticipantRemovedMetadata {
                channel_id: *channel_id,
                channel_type: *channel_type,
                removed_by: actor.clone(),
                removed_user_ids: removed_user_ids.clone(),
            },
        )],
        ChannelEvent::ReactionChanged { .. } | ChannelEvent::TypingChanged { .. } => Vec::new(),
        ChannelEvent::EntityMentionCreated { .. } | ChannelEvent::EntityMentionDeleted { .. } => {
            Vec::new()
        }
    }
}

/// Map an internal channel event to the wire events published to the
/// `macro.mentions` topic.
///
/// Channel messages publish on-send only (`message.sent`, no on-delete for
/// message mentions); generic entity mentions (e.g. docs) publish on-create
/// and on-delete (`mention.created`/`mention.deleted`).
fn mention_broker_events_for_event(event: &ChannelEvent) -> Vec<MentionMacroEvent> {
    match event {
        ChannelEvent::MessagePosted {
            message, mentions, ..
        } => mentions
            .iter()
            .map(|mention| {
                MentionMacroEvent::message_sent(MentionMetadata {
                    source: EntityRef {
                        id: message.id.to_string(),
                        kind: "message".to_string(),
                    },
                    mentioned: EntityRef {
                        id: mention.entity_id.clone(),
                        kind: mention.entity_type.clone(),
                    },
                })
            })
            .collect(),
        ChannelEvent::EntityMentionCreated { mention } => {
            vec![MentionMacroEvent::created(mention.into())]
        }
        ChannelEvent::EntityMentionDeleted { mention } => {
            vec![MentionMacroEvent::deleted(mention.into())]
        }
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod test;
