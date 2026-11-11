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

fn project(
    message: Message,
    actor: &ChannelSender<'_>,
    names: &HashMap<String, String>,
) -> GuestChatMessage {
    let name = message
        .guest_name
        .or_else(|| names.get(message.sender_id.as_ref()).cloned())
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

pub(super) fn rewrite_quote_content(
    content: &str,
    call_id: Uuid,
    senders: &HashMap<Uuid, String>,
    guest_input: bool,
) -> String {
    const OPEN: &str = "<m-reply-target>";
    const CLOSE: &str = "</m-reply-target>";
    let mut output = String::with_capacity(content.len());
    let mut remaining = content;
    while let Some(start) = remaining.find(OPEN) {
        output.push_str(&remaining[..start]);
        remaining = &remaining[start + OPEN.len()..];
        let Some(end) = remaining.find(CLOSE) else {
            if guest_input {
                output.push_str(OPEN);
                output.push_str(remaining);
            }
            return output;
        };
        let payload = &remaining[..end];
        let rewritten = serde_json::from_str::<serde_json::Value>(payload)
            .ok()
            .and_then(|mut value| {
                let id = value.get("senderId")?.as_str()?;
                let replacement = if guest_input {
                    let parent = value.get("parent")?;
                    if parent.get("type")?.as_str()? != "call"
                        || parent.get("id")?.as_str()? != call_id.to_string()
                    {
                        return None;
                    }
                    let target = Uuid::parse_str(value.get("targetMessageId")?.as_str()?).ok()?;
                    let sender = senders.get(&target)?;
                    (id == opaque_id(call_id, sender)).then_some(sender.clone())
                } else if id.starts_with("macro|") {
                    Some(opaque_id(call_id, id))
                } else {
                    Some(id.to_owned())
                }?;
                value["senderId"] = replacement.into();
                serde_json::to_string(&value).ok()
            });
        if let Some(rewritten) = rewritten.as_deref() {
            output.push_str(OPEN);
            output.push_str(rewritten);
            output.push_str(CLOSE);
        } else if guest_input {
            output.push_str(OPEN);
            output.push_str(payload);
            output.push_str(CLOSE);
        }
        remaining = &remaining[end + CLOSE.len()..];
    }
    output.push_str(remaining);
    output
}

fn redact(
    mut message: Message,
    call_id: Uuid,
    names: &HashMap<String, String>,
    senders: &HashMap<Uuid, String>,
) -> Message {
    message.content = rewrite_quote_content(&message.content, call_id, senders, false);
    if message.sender_id.as_user().is_some() {
        let original = message.sender_id.as_ref().to_owned();
        message.imported_author = Some(ImportedAuthor {
            name: names
                .get(&original)
                .cloned()
                .or_else(|| {
                    message
                        .sender_id
                        .as_user()
                        .map(|user| user.email_part().local_part().to_owned())
                })
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

impl<R: MessageRepository, E: MessageEventPublisher> GuestChatService<R, E> {
    async fn post_raw(
        &self,
        call_id: Uuid,
        token: &str,
        mut input: GuestChatPost,
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
        input.content = self.rewrite_guest_quotes(call_id, &input.content).await?;
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

    async fn thread_senders(&self, call_id: Uuid) -> Result<HashMap<Uuid, String>, MessageError> {
        let parent = MessageParent::Call(call_id);
        let root = self.messages.repo.get(&parent, call_id).await?;
        let replies = self.messages.repo.replies(&parent, call_id).await?;
        Ok(root
            .iter()
            .chain(replies.iter())
            .map(|message| (message.id, message.sender_id.as_ref().to_owned()))
            .collect())
    }

    async fn rewrite_guest_quotes(
        &self,
        call_id: Uuid,
        content: &str,
    ) -> Result<String, MessageError> {
        let senders = self.thread_senders(call_id).await?;
        Ok(rewrite_quote_content(content, call_id, &senders, true))
    }

    async fn redact_message(&self, call_id: Uuid, message: Message) -> Message {
        let senders = self
            .thread_senders(call_id)
            .await
            .inspect_err(|error| tracing::warn!(?error, %call_id, "guest quote names unavailable"))
            .unwrap_or_default();
        let ids: Vec<_> = senders.values().cloned().collect();
        let profile_names = self
            .messages
            .repo
            .account_display_names(&ids)
            .await
            .inspect_err(
                |error| tracing::warn!(?error, %call_id, "guest profile names unavailable"),
            )
            .unwrap_or_default();
        let names = senders
            .values()
            .map(|id| {
                let sender = ChannelSender::try_from(id.clone()).ok();
                let name = profile_names
                    .get(id)
                    .cloned()
                    .or_else(|| {
                        sender
                            .as_ref()
                            .and_then(|sender| sender.as_user())
                            .map(|user| user.email_part().local_part().to_owned())
                    })
                    .unwrap_or_else(|| "Participant".into());
                (id.clone(), name)
            })
            .collect();
        redact(message, call_id, &names, &senders)
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
        let messages: Vec<_> = root
            .into_iter()
            .chain(replies)
            .filter(|message| message.deleted_at.is_none())
            .collect();
        let ids: Vec<_> = messages
            .iter()
            .filter(|message| message.sender_id.as_user().is_some())
            .map(|message| message.sender_id.as_ref().to_owned())
            .collect();
        let names = self.messages.repo.account_display_names(&ids).await?;
        Ok(GuestChatPage {
            messages: messages
                .into_iter()
                .map(|message| project(message, &actor, &names))
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
        Ok(project(
            self.post_raw(call_id, token, input).await?,
            &actor,
            &HashMap::new(),
        ))
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
        let ids: Vec<_> = std::iter::once(&root)
            .chain(replies.iter())
            .filter(|message| message.sender_id.as_user().is_some())
            .map(|message| message.sender_id.as_ref().to_owned())
            .collect();
        let profile_names = self.messages.repo.account_display_names(&ids).await?;
        let names: HashMap<_, _> = std::iter::once(&root)
            .chain(replies.iter())
            .map(|message| {
                (
                    message.sender_id.as_ref().to_owned(),
                    project(message.clone(), &actor, &profile_names).name,
                )
            })
            .collect();
        let senders: HashMap<_, _> = std::iter::once(&root)
            .chain(replies.iter())
            .map(|message| (message.id, message.sender_id.as_ref().to_owned()))
            .collect();
        let root = redact(root, call_id, &names, &senders);
        let safe_replies = replies
            .into_iter()
            .map(|reply| redact(reply, call_id, &names, &senders))
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
        Ok(self
            .redact_message(call_id, self.post_raw(call_id, token, input).await?)
            .await)
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
                    content: self.rewrite_guest_quotes(call_id, &input.content).await?,
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
        Ok(self.redact_message(call_id, message).await)
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
        Ok(self.redact_message(call_id, message).await)
    }
}
