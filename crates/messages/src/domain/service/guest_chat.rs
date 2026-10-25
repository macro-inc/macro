//! Guests share the persisted call thread through a narrowly scoped session capability.
use super::*;
use chrono::{DateTime, Utc};
use macro_user_id::email::ReadEmailParts;
use std::sync::Arc;

/// Identity returned only after verifying an active guest's call session.
pub struct GuestCallAccess {
    /// Server-minted guest identity, distinct from account and bot principals.
    pub guest_id: Uuid,
    /// Verified room display name.
    pub name: String,
}

/// The call domain owns token validation and current membership policy.
#[async_trait::async_trait]
pub trait GuestCallAuthorizer: Send + Sync + 'static {
    /// Reject invalid/expired credentials, other rooms, and departed guests.
    async fn authorize(&self, call_id: Uuid, token: &str) -> Result<GuestCallAccess, MessageError>;
}

/// Guest-safe message projection: no account identities, attachments, or entity grants.
#[derive(serde::Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct GuestChatMessage {
    /// Persisted message identity.
    pub id: Uuid,
    /// Display-only author name.
    pub name: String,
    /// Whether the author is a guest.
    pub guest: bool,
    /// Whether this session authored the message.
    pub is_you: bool,
    /// Message body.
    pub content: String,
    /// Creation time.
    pub created_at: DateTime<Utc>,
}

/// Messages in the call's one discussion, oldest first.
#[derive(serde::Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct GuestChatPage {
    /// Visible, nondeleted messages.
    pub messages: Vec<GuestChatMessage>,
}

/// Guests may send text only; attribution and parent are server-owned.
#[derive(serde::Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(deny_unknown_fields)]
pub struct GuestChatPost {
    /// UUIDv7 used to deduplicate retries, including the first message.
    pub id: Uuid,
    /// Text to append to the call discussion.
    pub content: String,
}

/// Guest conversation boundary for HTTP adapters.
#[async_trait::async_trait]
pub trait GuestChatApi: Send + Sync + 'static {
    /// Read the current call discussion under a live guest credential.
    async fn read(&self, call_id: Uuid, token: &str) -> Result<GuestChatPage, MessageError>;
    /// Persist and deliver a guest message under the same credential.
    async fn post(
        &self,
        call_id: Uuid,
        token: &str,
        input: GuestChatPost,
    ) -> Result<GuestChatMessage, MessageError>;
}

/// Reuses the same message store and delivery pipeline as signed-in participants.
pub struct GuestChatService<R, E> {
    messages: Arc<MessageService<R, E>>,
    access: Arc<dyn GuestCallAuthorizer>,
}

impl<R, E> GuestChatService<R, E> {
    /// Compose with the owning call service and existing message service.
    pub fn new(messages: Arc<MessageService<R, E>>, access: Arc<dyn GuestCallAuthorizer>) -> Self {
        Self { messages, access }
    }
}

fn project(message: Message, actor: &ChannelSender<'_>) -> GuestChatMessage {
    let name = message
        .guest_name
        .or_else(|| message.imported_author.map(|author| author.name))
        .or_else(|| message.bot_profile.map(|bot| bot.name))
        .or_else(|| {
            message
                .sender_id
                .as_user()
                .map(|user| user.email_part().local_part().to_owned())
        })
        .unwrap_or_else(|| "Participant".to_owned());
    GuestChatMessage {
        id: message.id,
        name,
        guest: message.sender_id.is_guest(),
        is_you: message.sender_id == *actor,
        content: message.content,
        created_at: message.created_at,
    }
}

#[async_trait::async_trait]
impl<R: MessageRepository, E: MessageEventPublisher> GuestChatApi for GuestChatService<R, E> {
    #[tracing::instrument(err, skip_all, fields(%call_id))]
    async fn read(&self, call_id: Uuid, token: &str) -> Result<GuestChatPage, MessageError> {
        let access = self.access.authorize(call_id, token).await?;
        let actor = ChannelSender::new_from_guest(access.guest_id);
        let parent = MessageParent::Call(call_id);
        let Some(state) = self.messages.repo.thread(&parent, call_id).await? else {
            return Ok(GuestChatPage { messages: vec![] });
        };
        if state.deleted_at.is_some() {
            return Err(MessageError::NotFound);
        }
        let root = self.messages.repo.get(&parent, call_id).await?;
        let replies = self.messages.repo.replies(&parent, call_id).await?;
        Ok(GuestChatPage {
            messages: root
                .into_iter()
                .chain(replies)
                .filter(|message| message.deleted_at.is_none())
                .map(|message| project(message, &actor))
                .collect(),
        })
    }

    #[tracing::instrument(err, skip_all, fields(%call_id))]
    async fn post(
        &self,
        call_id: Uuid,
        token: &str,
        input: GuestChatPost,
    ) -> Result<GuestChatMessage, MessageError> {
        let access = self.access.authorize(call_id, token).await?;
        validate_client_id(input.id, Utc::now())?;
        if input.content.trim().is_empty() || input.content.chars().count() > 16_000 {
            return Err(MessageError::Invalid(
                "Enter a message of at most 16000 characters",
            ));
        }
        let parent = MessageParent::Call(call_id);
        let actor = ChannelSender::new_from_guest(access.guest_id);
        if let Some(message) = self
            .messages
            .repo
            .get_by_client_message_id(&parent, &actor, input.id)
            .await?
        {
            return Ok(project(message, &actor));
        }
        let result = self
            .messages
            .repo
            .create(CreateMessage {
                canonical_root_id: Some(call_id),
                parent: parent.clone(),
                actor: actor.clone(),
                guest_name: Some(access.name),
                triggered_by: None,
                input: PostMessage {
                    id: Some(input.id),
                    content: input.content,
                    thread_id: None,
                    anchor: None,
                    mentions: vec![],
                    attachments: vec![],
                    nonce: None,
                    attribution: MessageAttribution::default(),
                    notification_policy: PostMessageNotificationPolicy::default(),
                },
            })
            .await;
        let message = match result {
            Err(MessageError::Conflict) => {
                return self
                    .messages
                    .repo
                    .get_by_client_message_id(&parent, &actor, input.id)
                    .await?
                    .map(|message| project(message, &actor))
                    .ok_or(MessageError::Conflict);
            }
            result => result?,
        };
        self.messages
            .publish(MessageEvent {
                parent,
                actor: actor.as_ref().to_owned(),
                nonce: None,
                change: MessageChange::Posted {
                    notification_policy: PostMessageNotificationPolicy::default(),
                    message: message.clone(),
                    mentions: vec![],
                },
            })
            .await;
        Ok(project(message, &actor))
    }
}
