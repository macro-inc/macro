//! Domain policies for channel side effects.

use crate::domain::{
    events::ChannelEvent,
    models::{
        ChannelMetadata, ChannelParticipant, ChannelType, CountedReaction, MutatedAttachment,
        MutatedMessage, Sender, SimpleMention, TypingAction,
    },
    ports::{
        ChannelContactsDispatcher, ChannelEventDispatcher, ChannelEventHandler,
        ChannelNotificationSender, ChannelRealtimePublisher, ChannelSearchIndexer,
        ChannelSideEffectContext,
    },
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use std::collections::HashSet;
use uuid::Uuid;

/// Realtime update requested by the channel domain.
#[derive(Debug, Clone)]
pub enum ChannelRealtimeEffect {
    /// A message was created or changed.
    Message {
        /// Recipients that should receive the update.
        recipients: Vec<MacroUserIdStr<'static>>,
        /// Persisted message payload.
        message: MutatedMessage,
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
    /// Sender user id.
    pub sender_id: MacroUserIdStr<'static>,
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
        /// Sender user id.
        sender_id: MacroUserIdStr<'static>,
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
        /// Sender user id.
        sender_id: MacroUserIdStr<'static>,
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
                ..
            } => {
                let message_id = message.id;
                self.publish_realtime(ChannelRealtimeEffect::Message {
                    recipients,
                    message,
                    nonce,
                })
                .await;
                self.search.index_message(channel_id, message_id).await;
            }
            ChannelEvent::MessageDeleted {
                channel_id,
                message,
                recipients,
                nonce,
                ..
            } => {
                let message_id = message.id;
                self.publish_realtime(ChannelRealtimeEffect::Message {
                    recipients,
                    message,
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
        } = event;
        let recipients = participant_ids(&participants);
        self.publish_realtime(ChannelRealtimeEffect::Message {
            recipients: recipients.clone(),
            message: message.clone(),
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
        if message.sender_id.is_bot() {
            return;
        }
        self.send_message_posted_notifications(
            channel_id,
            metadata,
            participants,
            message,
            mentions,
            has_attachments,
        )
        .await;
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

    async fn send_message_posted_notifications(
        &self,
        channel_id: Uuid,
        metadata: ChannelMetadata,
        participants: Vec<ChannelParticipant>,
        message: MutatedMessage,
        mentions: Vec<SimpleMention>,
        has_attachments: bool,
    ) {
        let Some(sender_id) = message.sender_id.as_user().cloned() else {
            return;
        };
        let context = match self
            .build_posted_message_context(
                channel_id,
                metadata,
                &participants,
                &message,
                sender_id,
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
        } else if context.is_first_top_level_message {
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
        sender_id: MacroUserIdStr<'static>,
        mentions: Vec<SimpleMention>,
    ) -> anyhow::Result<PostedMessageNotificationContext> {
        let message_count = self
            .context
            .get_channel_message_count(channel_id)
            .await
            .map_err(Into::into)?;
        let is_first_top_level_message = message_count <= 1 && message.thread_id.is_none();
        let existing_user_ids = if is_first_top_level_message {
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
                    "user" => users.push(mention.entity_id),
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
        let sender_profile_picture_url = self
            .context
            .get_sender_profile_picture_url(sender_id.clone())
            .await;

        let excluded_user_ids = std::iter::once(sender_id.as_ref().to_string())
            .chain(user_mentions.iter().cloned())
            .collect::<Vec<_>>();
        let recipients_without_sender = recipients_excluding(
            participants
                .iter()
                .map(|participant| participant.user_id.as_str()),
            std::iter::once(sender_id.as_ref()),
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
            sender_id,
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
                sender_id: context.sender_id.clone(),
            },
            recipient_ids: recipients_excluding(
                context.user_mentions.iter().map(String::as_str),
                std::iter::once(context.sender_id.as_ref()),
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
                    sender_id: context.sender_id.clone(),
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
            sender_id: context.sender_id.clone(),
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
        self.send_invite_notification(InviteNotificationRequest {
            channel_id,
            invited_by_user_id: context.sender_id.clone(),
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
            sender_id: context.sender_id.clone(),
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

struct PostedMessageNotificationContext {
    metadata: ChannelMetadata,
    sender_id: MacroUserIdStr<'static>,
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

fn participant_ids(participants: &[ChannelParticipant]) -> Vec<MacroUserIdStr<'static>> {
    participants
        .iter()
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
mod tests {
    use super::*;
    use crate::domain::{
        models::{BotId, ParticipantRole, Sender},
        ports::{
            ChannelEventHandler, ChannelNotificationSender, ChannelRealtimePublisher,
            ChannelSearchIndexer, ChannelSideEffectContext,
        },
    };
    use chrono::Utc;
    use std::sync::{Arc, Mutex};

    type IndexedMessages = Arc<Mutex<Vec<(Uuid, Uuid)>>>;
    type RemovedMessages = Arc<Mutex<Vec<(Uuid, Option<Uuid>)>>>;

    #[derive(Clone)]
    struct FakeContext {
        message_count: i64,
        document_mentions: Vec<ChannelDocumentMention>,
    }

    impl ChannelSideEffectContext for FakeContext {
        type Err = anyhow::Error;

        async fn get_channel_message_count(&self, _channel_id: Uuid) -> Result<i64, Self::Err> {
            Ok(self.message_count)
        }

        async fn get_existing_user_ids(
            &self,
            user_ids: Vec<MacroUserIdStr<'static>>,
        ) -> Result<HashSet<String>, Self::Err> {
            Ok(user_ids
                .into_iter()
                .map(|user_id| user_id.as_ref().to_string())
                .collect())
        }

        async fn get_document_mentions(
            &self,
            _document_ids: Vec<String>,
        ) -> Result<Vec<ChannelDocumentMention>, Self::Err> {
            Ok(self.document_mentions.clone())
        }

        async fn get_thread_notification_context(
            &self,
            _thread_id: Uuid,
        ) -> Result<ThreadNotificationContext, Self::Err> {
            Ok(ThreadNotificationContext::default())
        }

        async fn get_sender_profile_picture_url(
            &self,
            _sender_id: MacroUserIdStr<'static>,
        ) -> Option<String> {
            Some("https://example.com/avatar.png".to_string())
        }
    }

    #[derive(Clone, Default)]
    struct FakeRealtime {
        effects: Arc<Mutex<Vec<ChannelRealtimeEffect>>>,
    }

    impl ChannelRealtimePublisher for FakeRealtime {
        type Err = anyhow::Error;

        async fn publish(&self, effect: ChannelRealtimeEffect) -> Result<(), Self::Err> {
            self.effects.lock().unwrap().push(effect);
            Ok(())
        }
    }

    #[derive(Clone, Default)]
    struct FakeNotifications {
        effects: Arc<Mutex<Vec<ChannelNotificationEffect>>>,
    }

    impl ChannelNotificationSender for FakeNotifications {
        type Err = anyhow::Error;

        async fn send(&self, notification: ChannelNotificationEffect) -> Result<(), Self::Err> {
            self.effects.lock().unwrap().push(notification);
            Ok(())
        }
    }

    #[derive(Clone, Default)]
    struct FakeSearch {
        indexed: IndexedMessages,
        removed: RemovedMessages,
    }

    impl ChannelSearchIndexer for FakeSearch {
        async fn index_message(&self, channel_id: Uuid, message_id: Uuid) {
            self.indexed.lock().unwrap().push((channel_id, message_id));
        }

        async fn remove_message(&self, channel_id: Uuid, message_id: Option<Uuid>) {
            self.removed.lock().unwrap().push((channel_id, message_id));
        }
    }

    #[derive(Clone, Default)]
    struct FakeContacts {
        users: Arc<Mutex<Vec<HashSet<MacroUserIdStr<'static>>>>>,
    }

    impl ChannelContactsDispatcher for FakeContacts {
        type Err = anyhow::Error;

        async fn enqueue_contacts(
            &self,
            users: HashSet<MacroUserIdStr<'static>>,
        ) -> Result<(), Self::Err> {
            self.users.lock().unwrap().push(users);
            Ok(())
        }
    }

    fn user(email: &str) -> MacroUserIdStr<'static> {
        MacroUserIdStr::try_from_email(email).unwrap()
    }

    fn users(emails: &[&str]) -> Vec<MacroUserIdStr<'static>> {
        emails.iter().map(|email| user(email)).collect()
    }

    #[tokio::test]
    async fn message_posted_derives_realtime_search_and_notification_effects() {
        let channel_id = Uuid::new_v4();
        let message_id = Uuid::new_v4();
        let sender = user("sender@example.com");
        let recipient = user("recipient@example.com");
        let realtime = FakeRealtime::default();
        let notifications = FakeNotifications::default();
        let search = FakeSearch::default();
        let contacts = FakeContacts::default();
        let service = ChannelSideEffectService::new(
            FakeContext {
                message_count: 2,
                document_mentions: Vec::new(),
            },
            realtime.clone(),
            notifications.clone(),
            search.clone(),
            contacts,
        );
        let now = Utc::now();

        service
            .handle(ChannelEvent::MessagePosted {
                channel_id,
                metadata: ChannelMetadata {
                    channel_type: ChannelType::Private,
                    channel_name: "Project".to_string(),
                },
                participants: vec![
                    ChannelParticipant {
                        channel_id,
                        user_id: sender.as_ref().to_string(),
                        role: ParticipantRole::Member,
                        joined_at: now,
                        left_at: None,
                    },
                    ChannelParticipant {
                        channel_id,
                        user_id: recipient.as_ref().to_string(),
                        role: ParticipantRole::Member,
                        joined_at: now,
                        left_at: None,
                    },
                ],
                message: MutatedMessage {
                    id: message_id,
                    channel_id,
                    thread_id: None,
                    sender_id: Sender::User(sender.clone()),
                    content: "hello".to_string(),
                    created_at: now,
                    updated_at: now,
                    edited_at: None,
                    deleted_at: None,
                },
                mentions: Vec::new(),
                has_attachments: false,
                attachments: Vec::new(),
                nonce: Some("nonce-1".to_string()),
            })
            .await;

        let realtime_effects = realtime.effects.lock().unwrap();
        assert_eq!(realtime_effects.len(), 1);
        let ChannelRealtimeEffect::Message {
            recipients,
            message,
            nonce,
        } = &realtime_effects[0]
        else {
            panic!("expected message realtime effect");
        };
        assert_eq!(message.id, message_id);
        assert_eq!(nonce.as_deref(), Some("nonce-1"));
        assert_eq!(recipients.len(), 2);
        drop(realtime_effects);

        assert_eq!(
            *search.indexed.lock().unwrap(),
            vec![(channel_id, message_id)]
        );

        let notification_effects = notifications.effects.lock().unwrap();
        assert_eq!(notification_effects.len(), 1);
        let ChannelNotificationEffect::ChannelMessage {
            message_id: notified_message_id,
            recipient_ids,
            metadata,
            ..
        } = &notification_effects[0]
        else {
            panic!("expected channel message notification effect");
        };
        assert_eq!(*notified_message_id, message_id);
        assert_eq!(metadata.channel_name, "Project");
        assert_eq!(recipient_ids.len(), 1);
        assert!(recipient_ids.contains(&recipient));
    }

    #[tokio::test]
    async fn bot_message_posted_keeps_realtime_and_search_but_skips_notifications() {
        let channel_id = Uuid::new_v4();
        let message_id = Uuid::new_v4();
        let recipient = user("recipient@example.com");
        let realtime = FakeRealtime::default();
        let notifications = FakeNotifications::default();
        let search = FakeSearch::default();
        let service = ChannelSideEffectService::new(
            FakeContext {
                message_count: 2,
                document_mentions: Vec::new(),
            },
            realtime.clone(),
            notifications.clone(),
            search.clone(),
            FakeContacts::default(),
        );
        let now = Utc::now();

        service
            .handle(ChannelEvent::MessagePosted {
                channel_id,
                metadata: ChannelMetadata {
                    channel_type: ChannelType::Private,
                    channel_name: "Project".to_string(),
                },
                participants: vec![ChannelParticipant {
                    channel_id,
                    user_id: recipient.as_ref().to_string(),
                    role: ParticipantRole::Member,
                    joined_at: now,
                    left_at: None,
                }],
                message: MutatedMessage {
                    id: message_id,
                    channel_id,
                    thread_id: None,
                    sender_id: Sender::Bot(BotId::from_uuid(Uuid::new_v4())),
                    content: "hello".to_string(),
                    created_at: now,
                    updated_at: now,
                    edited_at: None,
                    deleted_at: None,
                },
                mentions: Vec::new(),
                has_attachments: false,
                attachments: Vec::new(),
                nonce: None,
            })
            .await;

        assert_eq!(realtime.effects.lock().unwrap().len(), 1);
        assert_eq!(
            *search.indexed.lock().unwrap(),
            vec![(channel_id, message_id)]
        );
        assert!(notifications.effects.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn document_mentions_notify_participants_except_sender() {
        let channel_id = Uuid::new_v4();
        let message_id = Uuid::new_v4();
        let sender = user("sender@example.com");
        let mentioned = user("mentioned@example.com");
        let other = user("other@example.com");
        let notifications = FakeNotifications::default();
        let service = ChannelSideEffectService::new(
            FakeContext {
                message_count: 2,
                document_mentions: vec![ChannelDocumentMention {
                    document_name: "Spec".to_string(),
                    owner: sender.clone(),
                    file_type: None,
                    sub_type: None,
                }],
            },
            FakeRealtime::default(),
            notifications.clone(),
            FakeSearch::default(),
            FakeContacts::default(),
        );
        let now = Utc::now();

        service
            .handle(ChannelEvent::MessagePosted {
                channel_id,
                metadata: ChannelMetadata {
                    channel_type: ChannelType::Private,
                    channel_name: "Project".to_string(),
                },
                participants: vec![
                    ChannelParticipant {
                        channel_id,
                        user_id: sender.as_ref().to_string(),
                        role: ParticipantRole::Member,
                        joined_at: now,
                        left_at: None,
                    },
                    ChannelParticipant {
                        channel_id,
                        user_id: mentioned.as_ref().to_string(),
                        role: ParticipantRole::Member,
                        joined_at: now,
                        left_at: None,
                    },
                    ChannelParticipant {
                        channel_id,
                        user_id: other.as_ref().to_string(),
                        role: ParticipantRole::Member,
                        joined_at: now,
                        left_at: None,
                    },
                ],
                message: MutatedMessage {
                    id: message_id,
                    channel_id,
                    thread_id: None,
                    sender_id: Sender::User(sender.clone()),
                    content: "hello".to_string(),
                    created_at: now,
                    updated_at: now,
                    edited_at: None,
                    deleted_at: None,
                },
                mentions: vec![
                    SimpleMention {
                        entity_type: "user".to_string(),
                        entity_id: mentioned.as_ref().to_string(),
                    },
                    SimpleMention {
                        entity_type: "document".to_string(),
                        entity_id: "doc-1".to_string(),
                    },
                ],
                has_attachments: false,
                attachments: Vec::new(),
                nonce: None,
            })
            .await;

        let notification_effects = notifications.effects.lock().unwrap();
        let document_recipients = notification_effects
            .iter()
            .find_map(|effect| match effect {
                ChannelNotificationEffect::DocumentMention { recipient_ids, .. } => {
                    Some(recipient_ids)
                }
                _ => None,
            })
            .expect("expected document mention notification");
        assert!(document_recipients.contains(&mentioned));
        assert!(document_recipients.contains(&other));
        assert!(!document_recipients.contains(&sender));
    }

    #[test]
    fn contact_sync_is_derived_from_private_channel_created() {
        let event = ChannelEvent::ChannelCreated {
            channel_id: Uuid::nil(),
            actor: Sender::User(user("alice@example.com")),
            channel_type: ChannelType::Private,
            participant_user_ids: users(&["alice@example.com", "bob@example.com"]),
        };

        let contact_users = contact_sync_users_for_event(&event).unwrap();

        assert_eq!(contact_users.len(), 2);
        assert!(contact_users.contains(&user("alice@example.com")));
        assert!(contact_users.contains(&user("bob@example.com")));
    }

    #[test]
    fn contact_sync_ignores_public_channel_created() {
        let event = ChannelEvent::ChannelCreated {
            channel_id: Uuid::nil(),
            actor: Sender::User(user("alice@example.com")),
            channel_type: ChannelType::Public,
            participant_user_ids: users(&["alice@example.com", "bob@example.com"]),
        };

        assert!(contact_sync_users_for_event(&event).is_none());
    }

    #[test]
    fn contact_sync_ignores_bot_actor() {
        let event = ChannelEvent::ParticipantsAdded {
            channel_id: Uuid::nil(),
            channel_type: ChannelType::Team,
            active_participant_user_ids: users(&["alice@example.com", "bob@example.com"]),
            invited_by: Sender::Bot(BotId::from_uuid(Uuid::new_v4())),
            recipient_user_ids: users(&["bob@example.com"]),
            metadata: ChannelMetadata {
                channel_type: ChannelType::Team,
                channel_name: "team".to_string(),
            },
            message_content: None,
        };

        assert!(contact_sync_users_for_event(&event).is_none());
    }

    #[test]
    fn contact_sync_is_derived_from_team_participants_added() {
        let event = ChannelEvent::ParticipantsAdded {
            channel_id: Uuid::nil(),
            channel_type: ChannelType::Team,
            active_participant_user_ids: users(&["alice@example.com", "bob@example.com"]),
            invited_by: Sender::User(user("alice@example.com")),
            recipient_user_ids: users(&["bob@example.com"]),
            metadata: ChannelMetadata {
                channel_type: ChannelType::Team,
                channel_name: "team".to_string(),
            },
            message_content: None,
        };

        assert_eq!(contact_sync_users_for_event(&event).unwrap().len(), 2);
    }

    #[test]
    fn contact_sync_ignores_single_user_join() {
        let event = ChannelEvent::ParticipantJoined {
            channel_id: Uuid::nil(),
            channel_type: ChannelType::Public,
            user_id: Sender::User(user("alice@example.com")),
            active_participant_user_ids: users(&["alice@example.com"]),
        };

        assert!(contact_sync_users_for_event(&event).is_none());
    }
}
