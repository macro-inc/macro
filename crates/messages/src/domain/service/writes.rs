//! Message writes that report the channel change sequence number they took,
//! and the replay-safe forms a client's durable write queue sends.
use channel_sender::ChannelSender;
use entity_access::domain::models::{EntityAccessReceipt, EntityPermission};
use uuid::Uuid;

use super::{
    MessageService, MessageWrite, actor_from_receipt, can_moderate, parent_from_receipt,
    reject_call_root, validate_client_id, validate_event_message,
};
use crate::domain::{
    models::{Message, MessageKind, MessageParent, NewAttachment, PostMessage},
    ports::{
        AttachmentChange, EditMessage, MessageChange, MessageError, MessageEvent,
        MessageEventPublisher, MessagePatch, MessageRepository, ReactionResult, Sequenced,
    },
};

impl<R: MessageRepository, E: MessageEventPublisher> MessageService<R, E> {
    /// Post a channel message at most once per client-minted id. A replay of
    /// a committed post returns the stored message, deleted or edited since
    /// as it may be, with no sequence number and no event. An id another
    /// sender, channel or thread holds is a conflict. Without an id this posts
    /// as [`Self::post`] does, and a replay posts again.
    #[tracing::instrument(err, skip(self, access, input))]
    pub async fn post_once(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        input: PostMessage,
    ) -> Result<Sequenced<Message>, MessageError> {
        let parent = parent_from_receipt(&access)?;
        if !matches!(parent, MessageParent::Channel(_)) {
            return Err(MessageError::Invalid("only channel posts can be replayed"));
        }
        let Some(id) = input.id else {
            return self.post_validated(access, input).await;
        };
        let actor = actor_from_receipt(&access, &parent)?;
        let thread_id = input.thread_id;
        // Before the id's clock window and the thread are checked: a replay
        // can arrive days late, or after its thread was deleted.
        if let Some(message) = self.repo.get(&parent, id).await? {
            return replayed_post(message, &parent, &actor, thread_id);
        }
        validate_client_id(id, chrono::Utc::now())?;
        match self.post_validated(access, input).await {
            // The same post committed between the read and the write.
            Err(MessageError::Conflict) => {
                let message = self
                    .repo
                    .get(&parent, id)
                    .await?
                    .ok_or(MessageError::Conflict)?;
                replayed_post(message, &parent, &actor, thread_id)
            }
            result => result,
        }
    }

    /// [`Self::patch`], also reporting the write's channel sequence number;
    /// none when nothing was written.
    #[tracing::instrument(name = "patch", err, skip(self, access, patch))]
    pub async fn patch_sequenced(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        id: Uuid,
        patch: MessagePatch,
    ) -> Result<Sequenced<Message>, MessageError> {
        let parent = parent_from_receipt(&access)?;
        let actor = actor_from_receipt(&access, &parent)?;
        self.ensure_parent(&parent).await?;
        let current = self.active_message(&parent, id, false).await?;
        reject_call_root(&current)?;
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
        input.mentions = self
            .validate_references(
                &access,
                input.mentions,
                input.attachments.as_deref().unwrap_or_default(),
            )
            .await?;
        // Reconciliation may repeat a bot's final reply after a process died
        // between patching it and recording success. Identical content must
        // not produce another edit event or completion notification.
        if actor.as_bot().is_some()
            && input.content == current.content
            && input.mentions == current.mentions
            && input.attachments.is_none()
        {
            return Ok(Sequenced::unlogged(current));
        }
        let notification_policy = input.notification_policy;
        let nonce = input.nonce.clone();
        let mentions = self.resolve_mentions(&parent, &input.mentions).await?;
        let Sequenced {
            value: message,
            seq,
        } = self.repo.edit_sequenced(&parent, id, input).await?;
        self.publish(MessageEvent {
            parent,
            actor: actor.as_ref().to_owned(),
            nonce,
            seq,
            change: MessageChange::Edited {
                notification_policy,
                message: message.clone(),
                mentions,
                previous_attachments: current.attachments,
            },
        })
        .await;
        Ok(Sequenced {
            value: message,
            seq,
        })
    }

    /// [`Self::delete`], also reporting the write's channel sequence number.
    /// A discussion has no change log, so deleting one reports none.
    #[tracing::instrument(name = "delete", err, skip(self, access))]
    pub async fn delete_sequenced(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        id: Uuid,
        nonce: Option<String>,
    ) -> Result<Sequenced<Message>, MessageError> {
        let parent = parent_from_receipt(&access)?;
        let actor = actor_from_receipt(&access, &parent)?;
        self.ensure_parent(&parent).await?;
        let current = self.active_message(&parent, id, false).await?;
        reject_call_root(&current)?;
        // A comment's replies and its place in the document belong to the comment,
        // not to its first message, so the root carries the whole discussion with
        // it. Channel roots are one message in a conversation that continues
        // without them, and keep the tombstone the channel timeline renders.
        if parent.is_discussion() && current.thread_id.is_none() {
            self.delete_discussion(&access, &parent, &actor, id, nonce)
                .await?;
            return self
                .repo
                .get(&parent, id)
                .await?
                .ok_or(MessageError::NotFound)
                .map(Sequenced::unlogged);
        }
        if !may_delete(access.entity_permission(), &parent, &actor, &current) {
            return Err(MessageError::Forbidden);
        }
        let Sequenced {
            value: message,
            seq,
        } = self.repo.delete_sequenced(&parent, id).await?;
        self.publish_message(
            actor,
            nonce,
            seq,
            &message,
            MessageChange::MessageDeleted {
                message: message.clone(),
            },
        )
        .await;
        Ok(Sequenced {
            value: message,
            seq,
        })
    }

    /// [`Self::delete_sequenced`] for a channel client that may send the same
    /// delete again: a message already deleted returns its tombstone with no
    /// sequence number, when the caller may delete it.
    #[tracing::instrument(err, skip(self, access))]
    pub async fn delete_once(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        id: Uuid,
        nonce: Option<String>,
    ) -> Result<Sequenced<Message>, MessageError> {
        let parent = parent_from_receipt(&access)?;
        if !matches!(parent, MessageParent::Channel(_)) {
            return Err(MessageError::Invalid(
                "only channel deletes can be replayed",
            ));
        }
        match self.delete_sequenced(access.clone(), id, nonce).await {
            Err(MessageError::NotFound) => {
                let actor = actor_from_receipt(&access, &parent)?;
                let message = self.active_message(&parent, id, true).await?;
                if message.deleted_at.is_none() {
                    return Err(MessageError::NotFound);
                }
                reject_call_root(&message)?;
                if !may_delete(access.entity_permission(), &parent, &actor, &message) {
                    return Err(MessageError::Forbidden);
                }
                Ok(Sequenced::unlogged(message))
            }
            result => result,
        }
    }

    /// [`Self::react`], also reporting the write's channel sequence number;
    /// none when the reaction was already as asked.
    #[tracing::instrument(name = "react", err, skip(self, access))]
    pub async fn react_sequenced(
        &self,
        access: EntityAccessReceipt<MessageWrite>,
        id: Uuid,
        emoji: String,
        add: bool,
        nonce: Option<String>,
    ) -> Result<Sequenced<Message>, MessageError> {
        let parent = parent_from_receipt(&access)?;
        let actor = actor_from_receipt(&access, &parent)?;
        self.ensure_parent(&parent).await?;
        let current = self.active_message(&parent, id, false).await?;
        reject_call_root(&current)?;
        if emoji.is_empty() || emoji.chars().count() > 32 || emoji.chars().any(char::is_control) {
            return Err(MessageError::Invalid("invalid reaction"));
        }
        let ReactionResult {
            message,
            changed,
            seq,
        } = self
            .repo
            .react(&parent, id, actor.as_ref(), &emoji, add)
            .await?;
        // Idempotent retries still return the current message to the caller,
        // but must not publish another change or notify the author again.
        if !changed {
            return Ok(Sequenced::unlogged(message));
        }
        self.publish_message(
            actor,
            nonce,
            seq,
            &message,
            MessageChange::ReactionChanged {
                message: message.clone(),
                emoji,
                added: add,
            },
        )
        .await;
        Ok(Sequenced {
            value: message,
            seq,
        })
    }
}

/// Whether `actor` may delete `message`: its author, a moderator of the
/// parent, or anyone in a channel for a bot's message.
fn may_delete(
    permission: &EntityPermission,
    parent: &MessageParent,
    actor: &ChannelSender<'static>,
    message: &Message,
) -> bool {
    let channel_bot =
        matches!(parent, MessageParent::Channel(_)) && message.sender_id.as_bot().is_some();
    message.sender_id == *actor || can_moderate(permission) || channel_bot
}

/// What a replayed post returns: the stored message, when the same sender
/// posted it in the same channel and thread. Nothing was written.
fn replayed_post(
    message: Message,
    parent: &MessageParent,
    actor: &ChannelSender<'static>,
    thread_id: Option<Uuid>,
) -> Result<Sequenced<Message>, MessageError> {
    // A call's root carries the call's id; no post can claim it.
    if message.kind != MessageKind::Message {
        return Err(MessageError::Conflict);
    }
    validate_event_message(message, parent, actor, thread_id).map(Sequenced::unlogged)
}
