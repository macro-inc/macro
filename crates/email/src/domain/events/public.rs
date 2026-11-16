//! The public projection of [`EmailTopicEvent`](super::EmailTopicEvent).
//!
//! Thin by design: Macro ids, the acting user, flags, labels and timestamps.
//! Never a subject, an address, a provider message body or the mailbox owner
//! (the owner routes the event and is its only audience). Clients read
//! content back through the API under normal authorization.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::Serialize;
use uuid::Uuid;

use super::{
    EmailEventOrigin, LabelRef, LinkConnectedMetadata, LinkDisconnectReason,
    LinkDisconnectedMetadata, LinkReauthRequiredMetadata, MessageDeletedMetadata,
    MessageReceivedMetadata, MessageSendCancelledMetadata, MessageSendQueuedMetadata,
    MessageSentMetadata, SendCancelReason, ThreadArchivedMetadata, ThreadLabelsUpdatedMetadata,
    ThreadProjectChangedMetadata, ThreadReadMetadata, ThreadSpamChangedMetadata,
    ThreadStarredMetadata, ThreadTrashedMetadata,
};

/// A public `macro.email` event, delivered only to the mailbox owner.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(tag = "event_type", content = "metadata")]
pub enum EmailPublicEvent {
    /// An inbox was connected.
    #[serde(rename = "email.link_connected")]
    LinkConnected(EmailLinkConnected),
    /// An inbox was disconnected.
    #[serde(rename = "email.link_disconnected")]
    LinkDisconnected(EmailLinkDisconnected),
    /// An inbox's provider grant went dead and needs re-authentication.
    #[serde(rename = "email.link_reauth_required")]
    LinkReauthRequired(EmailLinkReauthRequired),
    /// A new inbound message was stored.
    #[serde(rename = "email.message_received")]
    MessageReceived(EmailMessageReceived),
    /// The provider accepted a sent message.
    #[serde(rename = "email.message_sent")]
    MessageSent(EmailMessageSent),
    /// A message was permanently deleted.
    #[serde(rename = "email.message_deleted")]
    MessageDeleted(EmailMessageDeleted),
    /// A send was queued (undo window or scheduled send).
    #[serde(rename = "email.message_send_queued")]
    MessageSendQueued(EmailMessageSendQueued),
    /// A queued send was cancelled.
    #[serde(rename = "email.message_send_cancelled")]
    MessageSendCancelled(EmailMessageSendCancelled),
    /// A thread was archived or moved back to the inbox.
    #[serde(rename = "email.thread_archived")]
    ThreadArchived(EmailThreadArchived),
    /// A thread was trashed or restored.
    #[serde(rename = "email.thread_trashed")]
    ThreadTrashed(EmailThreadTrashed),
    /// A thread was marked read or unread.
    #[serde(rename = "email.thread_read")]
    ThreadRead(EmailThreadRead),
    /// A thread was starred or unstarred.
    #[serde(rename = "email.thread_starred")]
    ThreadStarred(EmailThreadStarred),
    /// A thread was marked or unmarked spam.
    #[serde(rename = "email.thread_spam_changed")]
    ThreadSpamChanged(EmailThreadSpamChanged),
    /// A thread was assigned to or removed from a project.
    #[serde(rename = "email.thread_project_changed")]
    ThreadProjectChanged(EmailThreadProjectChanged),
    /// A thread's user labels changed.
    #[serde(rename = "email.thread_labels_updated")]
    ThreadLabelsUpdated(EmailThreadLabelsUpdated),
}

/// Public body of `email.link_connected`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct EmailLinkConnected {
    /// The connected inbox.
    pub link_id: Uuid,
    /// Email provider, such as `GMAIL`.
    pub provider: String,
    /// Whether this is the owner's primary inbox.
    pub is_primary: bool,
    /// When the inbox was connected.
    pub connected_at: DateTime<Utc>,
}

impl From<&LinkConnectedMetadata> for EmailLinkConnected {
    fn from(metadata: &LinkConnectedMetadata) -> Self {
        Self {
            link_id: metadata.link_id,
            provider: metadata.provider.clone(),
            is_primary: metadata.is_primary,
            connected_at: metadata.connected_at,
        }
    }
}

/// Public body of `email.link_disconnected`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct EmailLinkDisconnected {
    /// The disconnected inbox.
    pub link_id: Uuid,
    /// Why it was disconnected.
    pub reason: LinkDisconnectReason,
}

impl From<&LinkDisconnectedMetadata> for EmailLinkDisconnected {
    fn from(metadata: &LinkDisconnectedMetadata) -> Self {
        Self {
            link_id: metadata.link_id,
            reason: metadata.reason,
        }
    }
}

/// Public body of `email.link_reauth_required`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct EmailLinkReauthRequired {
    /// The inbox needing re-authentication.
    pub link_id: Uuid,
    /// When the dead grant was observed.
    pub observed_at: DateTime<Utc>,
}

impl From<&LinkReauthRequiredMetadata> for EmailLinkReauthRequired {
    fn from(metadata: &LinkReauthRequiredMetadata) -> Self {
        Self {
            link_id: metadata.link_id,
            observed_at: metadata.observed_at,
        }
    }
}

/// Public body of `email.message_received`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct EmailMessageReceived {
    /// The inbox that received the message.
    pub link_id: Uuid,
    /// The thread.
    pub thread_id: Uuid,
    /// The message.
    pub message_id: Uuid,
    /// Whether the message started a thread new to this inbox.
    pub is_new_thread: bool,
    /// Number of attachments.
    pub attachment_count: u32,
    /// Whether it arrived as spam or trash.
    pub is_spam_or_trash: bool,
    /// Provider-reported receive time.
    pub received_at: Option<DateTime<Utc>>,
}

impl From<&MessageReceivedMetadata> for EmailMessageReceived {
    fn from(metadata: &MessageReceivedMetadata) -> Self {
        Self {
            link_id: metadata.link_id,
            thread_id: metadata.thread_id,
            message_id: metadata.message_id,
            is_new_thread: metadata.is_new_thread,
            attachment_count: metadata.attachment_count,
            is_spam_or_trash: metadata.is_spam_or_trash,
            received_at: metadata.received_at,
        }
    }
}

/// Public body of `email.message_sent`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct EmailMessageSent {
    /// The inbox the message was sent from.
    pub link_id: Uuid,
    /// The thread.
    pub thread_id: Uuid,
    /// The message.
    pub message_id: Uuid,
    /// Who sent it; absent when first observed from the provider.
    pub actor: Option<MacroUserIdStr<'static>>,
    /// Whether it was sent through Macro or observed from the provider.
    pub origin: EmailEventOrigin,
    /// When the provider accepted it.
    pub sent_at: DateTime<Utc>,
}

impl From<&MessageSentMetadata> for EmailMessageSent {
    fn from(metadata: &MessageSentMetadata) -> Self {
        Self {
            link_id: metadata.link_id,
            thread_id: metadata.thread_id,
            message_id: metadata.message_id,
            actor: metadata.actor.clone(),
            origin: metadata.origin,
            sent_at: metadata.sent_at,
        }
    }
}

/// Public body of `email.message_deleted`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct EmailMessageDeleted {
    /// The inbox the message belonged to.
    pub link_id: Uuid,
    /// The thread.
    pub thread_id: Uuid,
    /// The deleted message.
    pub message_id: Uuid,
}

impl From<&MessageDeletedMetadata> for EmailMessageDeleted {
    fn from(metadata: &MessageDeletedMetadata) -> Self {
        Self {
            link_id: metadata.link_id,
            thread_id: metadata.thread_id,
            message_id: metadata.message_id,
        }
    }
}

/// Public body of `email.message_send_queued`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct EmailMessageSendQueued {
    /// The inbox the message will be sent from.
    pub link_id: Uuid,
    /// The thread.
    pub thread_id: Uuid,
    /// The message.
    pub message_id: Uuid,
    /// Who queued the send.
    pub actor: Option<MacroUserIdStr<'static>>,
    /// When the message is scheduled to leave.
    pub scheduled_send_at: DateTime<Utc>,
    /// `true` for a scheduled send, `false` for the undo window.
    pub is_scheduled: bool,
}

impl From<&MessageSendQueuedMetadata> for EmailMessageSendQueued {
    fn from(metadata: &MessageSendQueuedMetadata) -> Self {
        Self {
            link_id: metadata.link_id,
            thread_id: metadata.thread_id,
            message_id: metadata.message_id,
            actor: metadata.actor.clone(),
            scheduled_send_at: metadata.scheduled_send_at,
            is_scheduled: metadata.is_scheduled,
        }
    }
}

/// Public body of `email.message_send_cancelled`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct EmailMessageSendCancelled {
    /// The inbox the message would have been sent from.
    pub link_id: Uuid,
    /// The thread.
    pub thread_id: Uuid,
    /// The message.
    pub message_id: Uuid,
    /// Who cancelled the send.
    pub actor: Option<MacroUserIdStr<'static>>,
    /// Why it was cancelled.
    pub reason: SendCancelReason,
}

impl From<&MessageSendCancelledMetadata> for EmailMessageSendCancelled {
    fn from(metadata: &MessageSendCancelledMetadata) -> Self {
        Self {
            link_id: metadata.link_id,
            thread_id: metadata.thread_id,
            message_id: metadata.message_id,
            actor: metadata.actor.clone(),
            reason: metadata.reason,
        }
    }
}

/// Public body of `email.thread_archived`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct EmailThreadArchived {
    /// The inbox holding the thread.
    pub link_id: Uuid,
    /// The thread.
    pub thread_id: Uuid,
    /// Who changed it; absent for provider-initiated changes.
    pub actor: Option<MacroUserIdStr<'static>>,
    /// `true` when archived, `false` when moved back to the inbox.
    pub archived: bool,
    /// Where the change originated.
    pub origin: EmailEventOrigin,
}

impl From<&ThreadArchivedMetadata> for EmailThreadArchived {
    fn from(metadata: &ThreadArchivedMetadata) -> Self {
        Self {
            link_id: metadata.link_id,
            thread_id: metadata.thread_id,
            actor: metadata.actor.clone(),
            archived: metadata.archived,
            origin: metadata.origin,
        }
    }
}

/// Public body of `email.thread_trashed`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct EmailThreadTrashed {
    /// The inbox holding the thread.
    pub link_id: Uuid,
    /// The thread.
    pub thread_id: Uuid,
    /// Who changed it; absent for provider-initiated changes.
    pub actor: Option<MacroUserIdStr<'static>>,
    /// `true` when trashed, `false` when restored.
    pub trashed: bool,
    /// Where the change originated.
    pub origin: EmailEventOrigin,
}

impl From<&ThreadTrashedMetadata> for EmailThreadTrashed {
    fn from(metadata: &ThreadTrashedMetadata) -> Self {
        Self {
            link_id: metadata.link_id,
            thread_id: metadata.thread_id,
            actor: metadata.actor.clone(),
            trashed: metadata.trashed,
            origin: metadata.origin,
        }
    }
}

/// Public body of `email.thread_read`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct EmailThreadRead {
    /// The inbox holding the thread.
    pub link_id: Uuid,
    /// The thread.
    pub thread_id: Uuid,
    /// Who changed it; absent for provider-initiated changes.
    pub actor: Option<MacroUserIdStr<'static>>,
    /// `true` when read, `false` when unread.
    pub is_read: bool,
    /// Where the change originated.
    pub origin: EmailEventOrigin,
}

impl From<&ThreadReadMetadata> for EmailThreadRead {
    fn from(metadata: &ThreadReadMetadata) -> Self {
        Self {
            link_id: metadata.link_id,
            thread_id: metadata.thread_id,
            actor: metadata.actor.clone(),
            is_read: metadata.is_read,
            origin: metadata.origin,
        }
    }
}

/// Public body of `email.thread_starred`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct EmailThreadStarred {
    /// The inbox holding the thread.
    pub link_id: Uuid,
    /// The thread.
    pub thread_id: Uuid,
    /// Who changed it; absent for provider-initiated changes.
    pub actor: Option<MacroUserIdStr<'static>>,
    /// `true` when starred, `false` when unstarred.
    pub starred: bool,
    /// Where the change originated.
    pub origin: EmailEventOrigin,
}

impl From<&ThreadStarredMetadata> for EmailThreadStarred {
    fn from(metadata: &ThreadStarredMetadata) -> Self {
        Self {
            link_id: metadata.link_id,
            thread_id: metadata.thread_id,
            actor: metadata.actor.clone(),
            starred: metadata.starred,
            origin: metadata.origin,
        }
    }
}

/// Public body of `email.thread_spam_changed`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct EmailThreadSpamChanged {
    /// The inbox holding the thread.
    pub link_id: Uuid,
    /// The thread.
    pub thread_id: Uuid,
    /// Who changed it; absent for provider-initiated changes.
    pub actor: Option<MacroUserIdStr<'static>>,
    /// `true` when marked spam, `false` when unmarked.
    pub spam: bool,
    /// Where the change originated.
    pub origin: EmailEventOrigin,
}

impl From<&ThreadSpamChangedMetadata> for EmailThreadSpamChanged {
    fn from(metadata: &ThreadSpamChangedMetadata) -> Self {
        Self {
            link_id: metadata.link_id,
            thread_id: metadata.thread_id,
            actor: metadata.actor.clone(),
            spam: metadata.spam,
            origin: metadata.origin,
        }
    }
}

/// Public body of `email.thread_project_changed`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct EmailThreadProjectChanged {
    /// The inbox holding the thread.
    pub link_id: Uuid,
    /// The thread.
    pub thread_id: Uuid,
    /// Who changed the project.
    pub actor: MacroUserIdStr<'static>,
    /// Project before the change, when any.
    pub previous_project_id: Option<String>,
    /// Project after the change; absent when removed from its project.
    pub project_id: Option<String>,
}

impl From<&ThreadProjectChangedMetadata> for EmailThreadProjectChanged {
    fn from(metadata: &ThreadProjectChangedMetadata) -> Self {
        Self {
            link_id: metadata.link_id,
            thread_id: metadata.thread_id,
            actor: metadata.actor.clone(),
            previous_project_id: metadata.previous_project_id.clone(),
            project_id: metadata.project_id.clone(),
        }
    }
}

/// Public body of `email.thread_labels_updated`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct EmailThreadLabelsUpdated {
    /// The inbox holding the thread.
    pub link_id: Uuid,
    /// The thread.
    pub thread_id: Uuid,
    /// Who changed the labels; absent for provider-initiated changes.
    pub actor: Option<MacroUserIdStr<'static>>,
    /// User labels added.
    pub added: Vec<EmailLabel>,
    /// User labels removed.
    pub removed: Vec<EmailLabel>,
    /// Where the change originated.
    pub origin: EmailEventOrigin,
}

impl From<&ThreadLabelsUpdatedMetadata> for EmailThreadLabelsUpdated {
    fn from(metadata: &ThreadLabelsUpdatedMetadata) -> Self {
        Self {
            link_id: metadata.link_id,
            thread_id: metadata.thread_id,
            actor: metadata.actor.clone(),
            added: metadata.added.iter().map(EmailLabel::from).collect(),
            removed: metadata.removed.iter().map(EmailLabel::from).collect(),
            origin: metadata.origin,
        }
    }
}

/// A user label in a public email event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct EmailLabel {
    /// Macro's label id, when the label is known locally.
    pub label_id: Option<Uuid>,
    /// Provider label id.
    pub provider_label_id: String,
    /// Label name, when known.
    pub name: Option<String>,
}

impl From<&LabelRef> for EmailLabel {
    fn from(label: &LabelRef) -> Self {
        Self {
            label_id: label.label_id,
            provider_label_id: label.provider_label_id.clone(),
            name: label.name.clone(),
        }
    }
}
