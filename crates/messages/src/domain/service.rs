use super::{mentions::MessageReferenceKind, models::*, ports::*};
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

/// Minimum posting permission: channel member or document commenter.
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
    mentions: std::sync::Arc<dyn MessageMentionExtractor>,
    groups: std::sync::Arc<dyn MessageGroupRecipients>,
}

impl<R: MessageRepository, E: MessageEventPublisher> MessageService<R, E> {
    /// Compose a service from persistence and delivery ports.
    pub fn new(repo: R, events: E) -> Self {
        Self {
            repo,
            events,
            references: std::sync::Arc::new(DenyMessageReferences),
            mentions: std::sync::Arc::new(NoMessageMentionExtractor),
            groups: std::sync::Arc::new(NoMessageGroups),
        }
    }

    /// Supply current channel membership for authored group mentions.
    pub fn with_group_recipients(mut self, groups: impl MessageGroupRecipients) -> Self {
        self.groups = std::sync::Arc::new(groups);
        self
    }

    /// Supply the reference access boundary for attachments and entity mentions.
    pub fn with_references(mut self, references: impl MessageReferenceAccess) -> Self {
        self.references = std::sync::Arc::new(references);
        self
    }

    /// Parse raw bot Markdown through the same reference boundary as editor messages.
    pub fn with_mention_extractor(mut self, mentions: impl MessageMentionExtractor) -> Self {
        self.mentions = std::sync::Arc::new(mentions);
        self
    }

    /// Join accessible source discussions without copying or reparenting their messages.
    #[tracing::instrument(err, skip(self, access))]
    pub async fn referenced_threads(
        &self,
        access: EntityAccessReceipt<MessageView>,
        mut cursor: Option<MessageCursor>,
        limit: u16,
    ) -> Result<ReferencedThreadPage, MessageError> {
        let document = parent_from_receipt(&access)?;
        if !matches!(document, MessageParent::Document(_)) {
            return Err(MessageError::Invalid(
                "channel references require a document",
            ));
        }
        self.ensure_parent(&document).await?;
        let limit = usize::from(limit.clamp(1, 100));
        let mut threads = Vec::new();
        let mut visible_cursor = None;
        loop {
            let candidates = self
                .repo
                .referenced_threads(&document.entity_id(), cursor.clone(), 100)
                .await?;
            let exhausted = candidates.len() < 100;
            for candidate in candidates {
                cursor = Some(MessageCursor {
                    created_at: candidate.created_at,
                    id: candidate.root_id,
                });
                let parent = MessageParent::Channel(candidate.channel_id);
                let id = parent.entity_id();
                if !self
                    .references
                    .can_view(access.auth(), EntityType::Channel, &id)
                    .await?
                {
                    continue;
                }
                if threads.len() == limit {
                    return Ok(ReferencedThreadPage {
                        threads,
                        next_cursor: visible_cursor,
                    });
                }
                let state = match self.active_thread(&parent, candidate.root_id).await {
                    Ok(state) => state,
                    Err(MessageError::NotFound) => continue,
                    Err(error) => return Err(error),
                };
                let root = self
                    .active_message(&parent, candidate.root_id, true)
                    .await?;
                let replies = self.repo.replies(&parent, candidate.root_id).await?;
                let can_reply = self
                    .references
                    .can_write(access.auth(), EntityType::Channel, &id)
                    .await?;
                threads.push(ReferencedThread {
                    channel_name: candidate.channel_name,
                    can_reply,
                    thread: MessageThread {
                        state,
                        root,
                        replies,
                    },
                });
                visible_cursor = cursor.clone();
            }
            if exhausted {
                return Ok(ReferencedThreadPage {
                    threads,
                    next_cursor: None,
                });
            }
        }
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

    /// Load authorized history preceding a live prompt in this conversation.
    #[tracing::instrument(err, skip(self, access))]
    pub async fn preceding(
        &self,
        access: EntityAccessReceipt<MessageView>,
        id: Uuid,
        limit: u16,
    ) -> Result<Vec<Message>, MessageError> {
        let parent = parent_from_receipt(&access)?;
        self.ensure_parent(&parent).await?;
        self.active_message(&parent, id, false).await?;
        self.repo.preceding(&parent, id, limit.clamp(1, 100)).await
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
        mut input: PostMessage,
    ) -> Result<Message, MessageError> {
        let parent = parent_from_receipt(&access)?;
        let actor = actor_from_receipt(&access, &parent)?;
        self.ensure_parent(&parent).await?;
        if actor.as_bot().is_some() && input.mentions.is_empty() {
            input.mentions = self.mentions.extract(&input.content).await?;
        }
        validate_post(&parent, &input)?;
        self.validate_references(&access, &input.mentions, &input.attachments)
            .await?;
        if let Some(root) = input.thread_id {
            self.active_thread(&parent, root).await?;
        }
        let notification_policy = input.notification_policy;
        let nonce = input.nonce.clone();
        let mentions = self.resolve_mentions(&parent, &input.mentions).await?;
        let message = self
            .repo
            .create(CreateMessage {
                parent: parent.clone(),
                actor: actor.clone(),
                triggered_by: access
                    .acting_user_id()
                    .filter(|_| {
                        actor.as_bot().is_some()
                            && input.attribution == MessageAttribution::ActingUser
                    })
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
                notification_policy,
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
        self.patch(access, id, input.into()).await
    }

    /// Apply partial updates without requiring callers to reconstruct a message.
    #[tracing::instrument(err, skip(self, access, patch))]
    pub async fn patch(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        id: Uuid,
        patch: MessagePatch,
    ) -> Result<Message, MessageError> {
        let parent = parent_from_receipt(&access)?;
        let actor = actor_from_receipt(&access, &parent)?;
        self.ensure_parent(&parent).await?;
        let current = self.active_message(&parent, id, false).await?;
        if current.sender_id != actor
            && !(matches!(parent, MessageParent::Channel(_))
                && can_moderate(access.entity_permission()))
        {
            return Err(MessageError::Forbidden);
        }
        let attachments = match patch.attachments {
            AttachmentChange::Preserve => None,
            AttachmentChange::Replace(attachments) => Some(attachments),
            AttachmentChange::Delta { remove, add } => {
                let mut retained: Vec<_> = current
                    .attachments
                    .iter()
                    .filter(|attachment| !remove.contains(&attachment.id))
                    .map(|attachment| NewAttachment {
                        entity_type: attachment.entity_type.clone(),
                        entity_id: attachment.entity_id.clone(),
                        width: attachment.width,
                        height: attachment.height,
                    })
                    .collect();
                retained.extend(add);
                Some(retained)
            }
        };
        let mentions = patch.mentions.unwrap_or_else(|| {
            if patch.content.is_some() && actor.as_bot().is_some() {
                Vec::new()
            } else {
                current.mentions.clone()
            }
        });
        let mut input = EditMessage {
            content: patch.content.unwrap_or_else(|| current.content.clone()),
            mentions,
            attachments,
            nonce: patch.nonce,
            notification_policy: patch.notification_policy,
        };
        if actor.as_bot().is_some() && input.mentions.is_empty() {
            input.mentions = self.mentions.extract(&input.content).await?;
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
        let notification_policy = input.notification_policy;
        let nonce = input.nonce.clone();
        let mentions = self.resolve_mentions(&parent, &input.mentions).await?;
        let message = self.repo.edit(&parent, id, input).await?;
        self.publish(MessageEvent {
            parent,
            root_id: message.root_id(),
            actor: actor.as_ref().to_owned(),
            nonce,
            change: MessageChange::Edited {
                notification_policy,
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
        self.publish_message(
            actor,
            nonce,
            &message,
            MessageChange::MessageDeleted {
                message: message.clone(),
            },
        )
        .await;
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
        self.publish_message(
            actor,
            nonce,
            &message,
            MessageChange::ReactionChanged {
                message: message.clone(),
            },
        )
        .await;
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

    async fn resolve_mentions(
        &self,
        parent: &MessageParent,
        authored: &[SimpleMention],
    ) -> Result<Vec<SimpleMention>, MessageError> {
        let mut seen = std::collections::HashSet::new();
        let mut resolved = Vec::new();
        let mut group_members = None;
        for mention in authored {
            if MessageReferenceKind::parse(&mention.entity_type)
                == Some(MessageReferenceKind::Group)
            {
                let MessageParent::Channel(channel) = parent else {
                    return Err(MessageError::Invalid("group mentions require a channel"));
                };
                if group_members.is_none() {
                    group_members = Some(self.groups.channel_members(*channel).await?);
                }
                for user in group_members.as_ref().unwrap() {
                    let user = SimpleMention::user(user);
                    if seen.insert((user.entity_type.clone(), user.entity_id.clone())) {
                        resolved.push(user);
                    }
                }
            } else if seen.insert((mention.entity_type.clone(), mention.entity_id.clone())) {
                resolved.push(mention.clone());
            }
        }
        Ok(resolved)
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
            let kind = MessageReferenceKind::parse(kind)
                .ok_or(MessageError::Invalid("unsupported message reference"))?;
            let entity_type = match kind {
                MessageReferenceKind::User if mention => {
                    // Macro AI is surfaced through the user mention UI. Other bots
                    // use the explicit bot tag, which the trigger service authorizes.
                    let sender = ChannelSender::try_from(id)
                        .map_err(|_| MessageError::Invalid("invalid mentioned user"))?;
                    if sender
                        .as_bot()
                        .is_some_and(|bot| bot.bot_id() != bot_id::MACRO_AI_BOT_ID)
                    {
                        return Err(MessageError::Invalid("bot mentions require the bot tag"));
                    }
                    continue;
                }
                MessageReferenceKind::Bot if mention => {
                    bot_id::BotIdStr::try_from(id)
                        .map_err(|_| MessageError::Invalid("invalid mentioned bot"))?;
                    continue;
                }
                // Static media is already readable by any authenticated user who
                // has its UUID, matching static_file_service's read policy.
                MessageReferenceKind::StaticImage | MessageReferenceKind::StaticVideo
                    if !mention =>
                {
                    Uuid::parse_str(id)
                        .map_err(|_| MessageError::Invalid("invalid media identifier"))?;
                    continue;
                }
                MessageReferenceKind::Group
                    if mention
                        && id == "here"
                        && access.entity().entity_type == EntityType::Channel =>
                {
                    continue;
                }
                MessageReferenceKind::Document => EntityType::Document,
                MessageReferenceKind::Channel => EntityType::Channel,
                MessageReferenceKind::EmailThread => EntityType::EmailThread,
                MessageReferenceKind::Call => EntityType::Call,
                MessageReferenceKind::CalendarEvent => EntityType::CalendarEvent,
                MessageReferenceKind::Chat => EntityType::Chat,
                MessageReferenceKind::Project => EntityType::Project,
                MessageReferenceKind::CrmCompany => EntityType::CrmCompany,
                MessageReferenceKind::CrmContact => EntityType::CrmContact,
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
        change: MessageChange,
    ) {
        self.publish(MessageEvent {
            parent: message.parent.clone(),
            root_id: message.root_id(),
            actor: actor.as_ref().to_owned(),
            nonce,
            change,
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
        _ => return Err(MessageError::Forbidden),
    };
    MessageParent::parse(kind, &entity.entity_id)
        .map_err(|_| MessageError::Invalid("invalid message parent"))
}

fn actor_from_receipt<P: RequiredPermission>(
    access: &EntityAccessReceipt<P>,
    _parent: &MessageParent,
) -> Result<ChannelSender<'static>, MessageError> {
    let id = match access.auth() {
        EntityAccessAuth::Authenticated(user) => user.as_ref(),
        EntityAccessAuth::Bot(bot) => bot.bot_id_str().as_ref(),
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
