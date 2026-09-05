use super::{models::*, ports::*};
use channel_sender::ChannelSender;
use entity_access::domain::models::{
    AdminParticipantRole, CommentAccessLevel, EntityAccessAuth, EntityAccessReceipt,
    EntityPermission, EntityType, MemberParticipantRole, OwnerAccessLevel, RequiredPermission,
    ViewAccessLevel, ViewOnly,
};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Minimum view permission for any supported message parent.
#[derive(Debug, Clone, Copy)]
pub struct MessageView;

impl RequiredPermission for MessageView {
    fn is_satisfied_by(permission: &EntityPermission) -> bool {
        permission.satisfies::<ViewAccessLevel>() || permission.satisfies::<ViewOnly>()
    }
}

/// Minimum posting permission: channel member or document/email commenter.
#[derive(Debug, Clone, Copy)]
pub struct MessageWrite;

impl RequiredPermission for MessageWrite {
    fn is_satisfied_by(permission: &EntityPermission) -> bool {
        permission.satisfies::<CommentAccessLevel>()
            || permission.satisfies::<MemberParticipantRole>()
    }
}

/// Shared message use cases. Parent management and delivery are separate capabilities.
#[derive(Clone)]
pub struct MessageService<R, E> {
    repo: R,
    events: E,
    references: std::sync::Arc<dyn MessageReferenceAccess>,
}

impl<R: MessageRepository, E: MessageEventPublisher> MessageService<R, E> {
    /// Compose a service from persistence and delivery ports.
    pub fn new(repo: R, events: E) -> Self {
        Self {
            repo,
            events,
            references: std::sync::Arc::new(DenyMessageReferences),
        }
    }

    /// Supply the reference access boundary for attachments and entity mentions.
    pub fn with_references(mut self, references: impl MessageReferenceAccess) -> Self {
        self.references = std::sync::Arc::new(references);
        self
    }

    /// Read a parent timeline after verifying its continued existence.
    #[tracing::instrument(err, skip(self, access))]
    pub async fn list(
        &self,
        access: EntityAccessReceipt<MessageView>,
        cursor: Option<MessageCursor>,
        limit: u16,
    ) -> Result<ThreadPage, MessageError> {
        let parent = parent_from_receipt(&access)?;
        self.ensure_parent(&parent).await?;
        self.repo.list(&parent, cursor, limit.clamp(1, 100)).await
    }

    /// Read a message and its canonical root for navigation.
    #[tracing::instrument(err, skip(self, access))]
    pub async fn get(
        &self,
        access: EntityAccessReceipt<MessageView>,
        id: Uuid,
    ) -> Result<Message, MessageError> {
        let parent = parent_from_receipt(&access)?;
        self.ensure_parent(&parent).await?;
        self.active_message(&parent, id, true).await
    }

    /// Open a specific discussion, including roots outside the current timeline page.
    #[tracing::instrument(err, skip(self, access))]
    pub async fn get_thread(
        &self,
        access: EntityAccessReceipt<MessageView>,
        root_id: Uuid,
    ) -> Result<MessageThread, MessageError> {
        let parent = parent_from_receipt(&access)?;
        self.ensure_parent(&parent).await?;
        let state = self.active_thread(&parent, root_id).await?;
        let root = self.active_message(&parent, root_id, true).await?;
        let replies = self.repo.replies(&parent, root_id).await?;
        Ok(MessageThread {
            state,
            root,
            replies,
        })
    }

    /// Publish transient typing for an existing discussion.
    #[tracing::instrument(err, skip(self, access))]
    pub async fn typing(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        root_id: Uuid,
        active: bool,
        nonce: Option<String>,
    ) -> Result<(), MessageError> {
        let parent = parent_from_receipt(&access)?;
        let actor = actor_from_receipt(&access, &parent)?;
        self.ensure_parent(&parent).await?;
        self.active_thread(&parent, root_id).await?;
        self.publish(MessageEvent {
            parent,
            root_id,
            actor: actor.as_ref().to_owned(),
            nonce,
            change: MessageChange::Typing { active },
        })
        .await;
        Ok(())
    }

    /// Post a root or reply with shared thread and anchor validation.
    #[tracing::instrument(err, skip(self, access, input))]
    pub async fn post(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        input: PostMessage,
    ) -> Result<Message, MessageError> {
        let parent = parent_from_receipt(&access)?;
        let actor = actor_from_receipt(&access, &parent)?;
        self.ensure_parent(&parent).await?;
        validate_post(&parent, &input)?;
        self.validate_references(&access, &input.mentions, &input.attachments)
            .await?;
        if let Some(root) = input.thread_id {
            self.active_thread(&parent, root).await?;
        }
        let nonce = input.nonce.clone();
        let mentions = input.mentions.clone();
        let message = self
            .repo
            .create(CreateMessage {
                parent: parent.clone(),
                actor: actor.clone(),
                triggered_by: access
                    .acting_user_id()
                    .filter(|_| actor.as_bot().is_some())
                    .map(ToString::to_string),
                input,
            })
            .await?;
        self.publish(MessageEvent {
            parent,
            root_id: message.root_id(),
            actor: actor.as_ref().to_owned(),
            nonce,
            change: MessageChange::Posted {
                message: message.clone(),
                mentions,
            },
        })
        .await;
        Ok(message)
    }

    /// Edit a message owned by the caller. Imported display names confer no rights.
    #[tracing::instrument(err, skip(self, access, input))]
    pub async fn edit(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        id: Uuid,
        input: EditMessage,
    ) -> Result<Message, MessageError> {
        let parent = parent_from_receipt(&access)?;
        let actor = actor_from_receipt(&access, &parent)?;
        self.ensure_parent(&parent).await?;
        let current = self.active_message(&parent, id, false).await?;
        if current.sender_id != actor {
            return Err(MessageError::Forbidden);
        }
        let has_attachments = input
            .attachments
            .as_ref()
            .map_or(!current.attachments.is_empty(), |a| !a.is_empty());
        if input.content.trim().is_empty() && !has_attachments {
            return Err(MessageError::Invalid(
                "a message needs content or an attachment",
            ));
        }
        self.validate_references(
            &access,
            &input.mentions,
            input.attachments.as_deref().unwrap_or_default(),
        )
        .await?;
        let nonce = input.nonce.clone();
        let mentions = input.mentions.clone();
        let message = self.repo.edit(&parent, id, input).await?;
        self.publish(MessageEvent {
            parent,
            root_id: message.root_id(),
            actor: actor.as_ref().to_owned(),
            nonce,
            change: MessageChange::Edited {
                message: message.clone(),
                mentions,
                previous_attachments: current.attachments,
            },
        })
        .await;
        Ok(message)
    }

    /// Delete one message. Root deletion does not delete its discussion.
    #[tracing::instrument(err, skip(self, access))]
    pub async fn delete(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        id: Uuid,
        nonce: Option<String>,
    ) -> Result<Message, MessageError> {
        let parent = parent_from_receipt(&access)?;
        let actor = actor_from_receipt(&access, &parent)?;
        self.ensure_parent(&parent).await?;
        let current = self.active_message(&parent, id, false).await?;
        let channel_bot =
            matches!(parent, MessageParent::Channel(_)) && current.sender_id.as_bot().is_some();
        if current.sender_id != actor && !can_moderate(access.entity_permission()) && !channel_bot {
            return Err(MessageError::Forbidden);
        }
        let message = self.repo.delete(&parent, id).await?;
        self.publish_message(actor, nonce, &message).await;
        Ok(message)
    }

    /// Add or remove a reaction owned by the authenticated caller.
    #[tracing::instrument(err, skip(self, access))]
    pub async fn react(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        id: Uuid,
        emoji: String,
        add: bool,
        nonce: Option<String>,
    ) -> Result<Message, MessageError> {
        let parent = parent_from_receipt(&access)?;
        let actor = actor_from_receipt(&access, &parent)?;
        self.ensure_parent(&parent).await?;
        self.active_message(&parent, id, false).await?;
        if emoji.is_empty() || emoji.chars().count() > 32 || emoji.chars().any(char::is_control) {
            return Err(MessageError::Invalid("invalid reaction"));
        }
        let message = self
            .repo
            .react(&parent, id, actor.as_ref(), &emoji, add)
            .await?;
        self.publish_message(actor, nonce, &message).await;
        Ok(message)
    }

    /// Resolve or reopen a discussion; all commenters may do so.
    #[tracing::instrument(err, skip(self, access))]
    pub async fn resolve(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        root_id: Uuid,
        resolved: bool,
        nonce: Option<String>,
    ) -> Result<ThreadState, MessageError> {
        let parent = parent_from_receipt(&access)?;
        let actor = actor_from_receipt(&access, &parent)?;
        if !parent.is_discussion() {
            return Err(MessageError::Invalid(
                "only entity discussions can be resolved",
            ));
        }
        self.ensure_parent(&parent).await?;
        self.active_thread(&parent, root_id).await?;
        let state = self.repo.resolve(&parent, root_id, resolved).await?;
        self.publish(MessageEvent {
            parent,
            root_id,
            actor: actor.as_ref().to_owned(),
            nonce,
            change: MessageChange::ThreadUpdated {
                state: state.clone(),
            },
        })
        .await;
        Ok(state)
    }

    /// Explicitly delete a discussion, including all its replies.
    #[tracing::instrument(err, skip(self, access))]
    pub async fn delete_thread(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        root_id: Uuid,
        nonce: Option<String>,
    ) -> Result<ThreadState, MessageError> {
        let parent = parent_from_receipt(&access)?;
        let actor = actor_from_receipt(&access, &parent)?;
        if !parent.is_discussion() {
            return Err(MessageError::Invalid(
                "only entity discussions support whole-thread deletion",
            ));
        }
        self.ensure_parent(&parent).await?;
        let thread = self.active_thread(&parent, root_id).await?;
        if thread.user_id != actor.as_ref() && !can_moderate(access.entity_permission()) {
            return Err(MessageError::Forbidden);
        }
        let state = self.repo.delete_thread(&parent, root_id).await?;
        self.publish(MessageEvent {
            parent,
            root_id,
            actor: actor.as_ref().to_owned(),
            nonce,
            change: MessageChange::ThreadUpdated {
                state: state.clone(),
            },
        })
        .await;
        Ok(state)
    }

    /// Resolve an old link through the sole message store under current parent access.
    #[tracing::instrument(err, skip(self, access))]
    pub async fn resolve_legacy(
        &self,
        access: EntityAccessReceipt<MessageView>,
        id: i64,
        is_thread: bool,
    ) -> Result<Message, MessageError> {
        let parent = parent_from_receipt(&access)?;
        self.ensure_parent(&parent).await?;
        let id = self
            .repo
            .resolve_legacy(&parent, id, is_thread)
            .await?
            .ok_or(MessageError::NotFound)?;
        self.active_message(&parent, id, true).await
    }

    async fn validate_references(
        &self,
        access: &EntityAccessReceipt<MessageWrite>,
        mentions: &[SimpleMention],
        attachments: &[NewAttachment],
    ) -> Result<(), MessageError> {
        if attachments.len() > 10 || mentions.len() > 100 {
            return Err(MessageError::Invalid("too many message references"));
        }
        for attachment in attachments {
            if attachment.width.is_some_and(|n| n <= 0) || attachment.height.is_some_and(|n| n <= 0)
            {
                return Err(MessageError::Invalid("invalid attachment dimensions"));
            }
        }
        let mut checked = std::collections::HashSet::new();
        for (kind, id, mention) in mentions
            .iter()
            .map(|m| (m.entity_type.as_str(), m.entity_id.as_str(), true))
            .chain(
                attachments
                    .iter()
                    .map(|a| (a.entity_type.as_str(), a.entity_id.as_str(), false)),
            )
        {
            if !checked.insert((kind, id, mention)) {
                continue;
            }
            let entity_type = match kind {
                "user" if mention => {
                    macro_user_id::user_id::MacroUserIdStr::try_from(id)
                        .map_err(|_| MessageError::Invalid("invalid mentioned user"))?;
                    continue;
                }
                // Static media is already readable by any authenticated user who
                // has its UUID, matching static_file_service's read policy.
                "static/image" | "static/video" if !mention => {
                    Uuid::parse_str(id)
                        .map_err(|_| MessageError::Invalid("invalid media identifier"))?;
                    continue;
                }
                "document" => EntityType::Document,
                "channel" => EntityType::Channel,
                "email_thread" | "email" => EntityType::EmailThread,
                "chat" => EntityType::Chat,
                "project" => EntityType::Project,
                _ => return Err(MessageError::Invalid("unsupported message reference")),
            };
            if !self
                .references
                .can_view(access.auth(), entity_type, id)
                .await?
            {
                return Err(MessageError::Forbidden);
            }
        }
        Ok(())
    }

    async fn ensure_parent(&self, parent: &MessageParent) -> Result<(), MessageError> {
        if !self.repo.parent_exists(parent).await? {
            return Err(MessageError::NotFound);
        }
        Ok(())
    }

    async fn active_thread(
        &self,
        parent: &MessageParent,
        root: Uuid,
    ) -> Result<ThreadState, MessageError> {
        let thread = self
            .repo
            .thread(parent, root)
            .await?
            .ok_or(MessageError::NotFound)?;
        if thread.deleted_at.is_some() {
            return Err(MessageError::NotFound);
        }
        Ok(thread)
    }

    async fn active_message(
        &self,
        parent: &MessageParent,
        id: Uuid,
        tombstone: bool,
    ) -> Result<Message, MessageError> {
        let message = self
            .repo
            .get(parent, id)
            .await?
            .ok_or(MessageError::NotFound)?;
        if message.parent != *parent || (!tombstone && message.deleted_at.is_some()) {
            return Err(MessageError::NotFound);
        }
        self.active_thread(parent, message.root_id()).await?;
        Ok(message)
    }

    async fn publish_message(
        &self,
        actor: ChannelSender<'static>,
        nonce: Option<String>,
        message: &Message,
    ) {
        self.publish(MessageEvent {
            parent: message.parent.clone(),
            root_id: message.root_id(),
            actor: actor.as_ref().to_owned(),
            nonce,
            change: MessageChange::Updated {
                message: message.clone(),
            },
        })
        .await;
    }

    async fn publish(&self, event: MessageEvent) {
        // The transaction has committed. Reporting failure to the caller would encourage
        // duplicate posts; reconnect/refetch also reconciles a missed transient update.
        let _ = self.events.publish(event).await.inspect_err(|e| {
            tracing::error!(error=?e, "failed to deliver committed message event");
        });
    }
}

fn can_moderate(permission: &EntityPermission) -> bool {
    permission.satisfies::<OwnerAccessLevel>() || permission.satisfies::<AdminParticipantRole>()
}

fn parent_from_receipt<P: RequiredPermission>(
    access: &EntityAccessReceipt<P>,
) -> Result<MessageParent, MessageError> {
    let entity = access.entity();
    let kind = match entity.entity_type {
        EntityType::Channel => "channel",
        EntityType::Document => "document",
        EntityType::EmailThread => "email_thread",
        _ => return Err(MessageError::Forbidden),
    };
    MessageParent::parse(kind, &entity.entity_id)
        .map_err(|_| MessageError::Invalid("invalid message parent"))
}

fn actor_from_receipt<P: RequiredPermission>(
    access: &EntityAccessReceipt<P>,
    parent: &MessageParent,
) -> Result<ChannelSender<'static>, MessageError> {
    let id = match access.auth() {
        EntityAccessAuth::Authenticated(user) => user.as_ref(),
        EntityAccessAuth::Bot(bot) if matches!(parent, MessageParent::Channel(_)) => {
            bot.bot_id_str().as_ref()
        }
        _ => return Err(MessageError::Forbidden),
    };
    ChannelSender::try_from(id.to_owned()).map_err(|_| MessageError::Forbidden)
}

fn validate_post(parent: &MessageParent, input: &PostMessage) -> Result<(), MessageError> {
    if input.content.trim().is_empty() && input.attachments.is_empty() {
        return Err(MessageError::Invalid(
            "a message needs content or an attachment",
        ));
    }
    if input.anchor.is_some()
        && (input.thread_id.is_some() || !matches!(parent, MessageParent::Document(_)))
    {
        return Err(MessageError::Invalid(
            "only root document messages may have anchors",
        ));
    }
    if let Some(NewThreadAnchor::PdfPlaceable {
        page,
        x_pct,
        y_pct,
        width_pct,
        height_pct,
        ..
    }) = input.anchor
        && (page < 0
            || ![x_pct, y_pct, width_pct, height_pct]
                .iter()
                .all(|x| x.is_finite())
            || width_pct <= 0.0
            || height_pct <= 0.0)
    {
        return Err(MessageError::Invalid("invalid PDF comment geometry"));
    }
    Ok(())
}
