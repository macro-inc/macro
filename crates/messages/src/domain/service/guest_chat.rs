//! Guests share the persisted call thread through a narrowly scoped session capability.
use super::*;
use chrono::{DateTime, Utc};
use macro_user_id::email::ReadEmailParts;
use std::collections::HashMap;
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

/// Text-only update to a guest-authored message.
#[derive(serde::Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(deny_unknown_fields)]
pub struct GuestChatPatch {
    /// Replacement message body.
    pub content: String,
}

/// A call thread and the verified viewer's sender identity.
#[derive(serde::Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct GuestChatThread {
    /// Guest sender ID used for own-message controls.
    pub viewer_id: String,
    /// None until the first message is posted.
    pub thread: Option<MessageThread>,
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
    /// Read the shared call thread with account identities removed.
    async fn read_thread(
        &self,
        call_id: Uuid,
        token: &str,
    ) -> Result<GuestChatThread, MessageError>;
    /// Post text to the shared call thread.
    async fn post_message(
        &self,
        call_id: Uuid,
        token: &str,
        input: GuestChatPost,
    ) -> Result<Message, MessageError>;
    /// Edit a message authored by this guest.
    async fn patch_message(
        &self,
        call_id: Uuid,
        token: &str,
        id: Uuid,
        input: GuestChatPatch,
    ) -> Result<Message, MessageError>;
    /// Delete a message authored by this guest.
    async fn delete_message(
        &self,
        call_id: Uuid,
        token: &str,
        id: Uuid,
    ) -> Result<(), MessageError>;
    /// Change this guest's reaction on any live call message.
    async fn react_message(
        &self,
        call_id: Uuid,
        token: &str,
        id: Uuid,
        emoji: String,
        add: bool,
        nonce: Option<String>,
    ) -> Result<Message, MessageError>;
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

fn opaque_id(call_id: Uuid, sender_id: &str) -> String {
    format!(
        "participant:{}",
        Uuid::new_v5(&call_id, sender_id.as_bytes())
    )
}

fn redact(mut message: Message, call_id: Uuid, names: &HashMap<String, String>) -> Message {
    if message.sender_id.as_user().is_some() {
        let original = message.sender_id.as_ref().to_owned();
        message.imported_author = Some(ImportedAuthor {
            name: names
                .get(&original)
                .cloned()
                .unwrap_or_else(|| "Participant".into()),
        });
        message.guest_name = None;
        message.bot_profile = None;
        message.sender_id =
            ChannelSender::new_from_participant(Uuid::new_v5(&call_id, original.as_bytes()));
    }
    message.mentions.clear();
    message.attachments.clear();
    message.triggered_by = None;
    message.triggered_via = None;
    for reaction in &mut message.reactions {
        let mut display_names = HashMap::new();
        for id in &mut reaction.users {
            let sender = ChannelSender::try_from(id.as_str()).ok();
            if sender
                .as_ref()
                .is_none_or(|sender| sender.as_user().is_some())
            {
                let old = id.clone();
                let name = names
                    .get(&old)
                    .cloned()
                    .or_else(|| {
                        sender
                            .as_ref()
                            .and_then(|sender| sender.as_user())
                            .map(|user| user.email_part().local_part().to_owned())
                    })
                    .unwrap_or_else(|| "Participant".into());
                *id = opaque_id(call_id, &old);
                display_names.insert(id.clone(), name);
            }
        }
        reaction.names = (!display_names.is_empty()).then_some(display_names);
    }
    message
}

fn redact_mutation(message: Message, call_id: Uuid) -> Message {
    let name = project(message.clone(), &ChannelSender::new_from_guest(Uuid::nil())).name;
    let names = HashMap::from([(message.sender_id.as_ref().to_owned(), name)]);
    redact(message, call_id, &names)
}

impl<R: MessageRepository, E: MessageEventPublisher> GuestChatService<R, E> {
    async fn post_raw(
        &self,
        call_id: Uuid,
        token: &str,
        input: GuestChatPost,
    ) -> Result<Message, MessageError> {
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
            return Ok(message);
        }
        let result = self
            .messages
            .repo
            .create(CreateMessage {
                canonical_root_id: Some(call_id),
                parent: parent.clone(),
                actor: actor.clone(),
                guest_name: Some(access.name),
                kind: MessageKind::Message,
                triggered_via: None,
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
        Ok(message)
    }

    async fn guest_actor(
        &self,
        call_id: Uuid,
        token: &str,
    ) -> Result<ChannelSender<'static>, MessageError> {
        let access = self.access.authorize(call_id, token).await?;
        if self
            .messages
            .repo
            .call_thread_facts(call_id)
            .await?
            .is_some()
        {
            return Err(MessageError::Invalid(
                "this call's discussion is in its channel",
            ));
        }
        Ok(ChannelSender::new_from_guest(access.guest_id))
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
        let actor =
            ChannelSender::new_from_guest(self.access.authorize(call_id, token).await?.guest_id);
        Ok(project(self.post_raw(call_id, token, input).await?, &actor))
    }

    #[tracing::instrument(err, skip_all, fields(%call_id))]
    async fn read_thread(
        &self,
        call_id: Uuid,
        token: &str,
    ) -> Result<GuestChatThread, MessageError> {
        let actor = self.guest_actor(call_id, token).await?;
        let parent = MessageParent::Call(call_id);
        let Some(mut state) = self.messages.repo.thread(&parent, call_id).await? else {
            return Ok(GuestChatThread {
                viewer_id: actor.as_ref().to_owned(),
                thread: None,
            });
        };
        if state.deleted_at.is_some() {
            return Err(MessageError::NotFound);
        }
        let root = self
            .messages
            .repo
            .get(&parent, call_id)
            .await?
            .ok_or(MessageError::NotFound)?;
        let replies = self.messages.repo.replies(&parent, call_id).await?;
        state.user_id = if root.sender_id.as_user().is_some() {
            opaque_id(call_id, root.sender_id.as_ref())
        } else {
            root.sender_id.as_ref().to_owned()
        };
        state.anchor = None;
        let names: HashMap<_, _> = std::iter::once(&root)
            .chain(replies.iter())
            .map(|message| {
                (
                    message.sender_id.as_ref().to_owned(),
                    project(message.clone(), &actor).name,
                )
            })
            .collect();
        let root = redact(root, call_id, &names);
        let safe_replies = replies
            .into_iter()
            .map(|reply| redact(reply, call_id, &names))
            .collect();
        Ok(GuestChatThread {
            viewer_id: actor.as_ref().to_owned(),
            thread: Some(MessageThread {
                state,
                root,
                replies: safe_replies,
            }),
        })
    }

    #[tracing::instrument(err, skip_all, fields(%call_id))]
    async fn post_message(
        &self,
        call_id: Uuid,
        token: &str,
        input: GuestChatPost,
    ) -> Result<Message, MessageError> {
        self.guest_actor(call_id, token).await?;
        Ok(redact_mutation(
            self.post_raw(call_id, token, input).await?,
            call_id,
        ))
    }

    #[tracing::instrument(err, skip_all, fields(%call_id, %id))]
    async fn patch_message(
        &self,
        call_id: Uuid,
        token: &str,
        id: Uuid,
        input: GuestChatPatch,
    ) -> Result<Message, MessageError> {
        let actor = self.guest_actor(call_id, token).await?;
        let parent = MessageParent::Call(call_id);
        let current = self.messages.active_message(&parent, id, false).await?;
        reject_call_root(&current)?;
        if current.sender_id != actor {
            return Err(MessageError::Forbidden);
        }
        if input.content.trim().is_empty() {
            return Err(MessageError::Invalid(
                "a message needs content or an attachment",
            ));
        }
        let message = self
            .messages
            .repo
            .edit(
                &parent,
                id,
                EditMessage {
                    content: input.content,
                    mentions: vec![],
                    attachments: Some(vec![]),
                    nonce: None,
                    notification_policy: PatchMessageNotificationPolicy::default(),
                },
            )
            .await?;
        self.messages
            .publish(MessageEvent {
                parent,
                actor: actor.as_ref().to_owned(),
                nonce: None,
                change: MessageChange::Edited {
                    notification_policy: PatchMessageNotificationPolicy::default(),
                    message: message.clone(),
                    mentions: vec![],
                    previous_attachments: current.attachments,
                },
            })
            .await;
        Ok(redact_mutation(message, call_id))
    }

    #[tracing::instrument(err, skip_all, fields(%call_id, %id))]
    async fn delete_message(
        &self,
        call_id: Uuid,
        token: &str,
        id: Uuid,
    ) -> Result<(), MessageError> {
        let actor = self.guest_actor(call_id, token).await?;
        let parent = MessageParent::Call(call_id);
        let current = self.messages.active_message(&parent, id, false).await?;
        reject_call_root(&current)?;
        if current.sender_id != actor {
            return Err(MessageError::Forbidden);
        }
        if current.thread_id.is_none() {
            let state = self.messages.repo.delete_thread(&parent, id).await?;
            self.messages
                .publish(MessageEvent {
                    parent,
                    actor: actor.as_ref().to_owned(),
                    nonce: None,
                    change: MessageChange::ThreadUpdated { state },
                })
                .await;
        } else {
            let message = self.messages.repo.delete(&parent, id).await?;
            self.messages
                .publish_message(
                    actor,
                    None,
                    &message,
                    MessageChange::MessageDeleted {
                        message: message.clone(),
                    },
                )
                .await;
        }
        Ok(())
    }

    #[tracing::instrument(err, skip_all, fields(%call_id, %id))]
    async fn react_message(
        &self,
        call_id: Uuid,
        token: &str,
        id: Uuid,
        emoji: String,
        add: bool,
        nonce: Option<String>,
    ) -> Result<Message, MessageError> {
        let actor = self.guest_actor(call_id, token).await?;
        let parent = MessageParent::Call(call_id);
        let current = self.messages.active_message(&parent, id, false).await?;
        reject_call_root(&current)?;
        if emoji.is_empty() || emoji.chars().count() > 32 || emoji.chars().any(char::is_control) {
            return Err(MessageError::Invalid("invalid reaction"));
        }
        let ReactionResult { message, changed } = self
            .messages
            .repo
            .react(&parent, id, actor.as_ref(), &emoji, add)
            .await?;
        if changed {
            self.messages
                .publish_message(
                    actor,
                    nonce,
                    &message,
                    MessageChange::ReactionChanged {
                        message: message.clone(),
                        emoji,
                        added: add,
                    },
                )
                .await;
        }
        Ok(redact_mutation(message, call_id))
    }
}
