//! Kafka event models for the `macro.email` topic.
//!
//! Follows the canonical pattern in `documents/src/domain/events.rs`:
//! per-variant metadata structs, a [`TopicEvent`] enum tagged by `event_type`,
//! and a [`MacroEvent`] wrapper keyed by link (inbox) id.
//!
//! Every event is keyed by `link_id` so consumers get per-inbox total order:
//! account lifecycle events are ordered against the inbox's content events,
//! and per-thread order is preserved (a thread belongs to exactly one link).
//!
//! Payloads carry RFC-822 *header* level data only (subject, from, to/cc
//! addresses) — never message bodies, snippets, bcc addresses, or attachment
//! names. Consumers needing content must read back through the API.
//!
//! Each variant documents its owning emission site: a logical change is
//! published from the point closest to the committed Macro-DB write.
//! Changes initiated in Macro are emitted with
//! [`EmailEventOrigin::UserAction`] from the mutating handler or domain
//! service; the same change echoing back through Gmail history sync finds no
//! DB diff and stays silent. Changes first observed from the provider are
//! emitted with [`EmailEventOrigin::ProviderSync`] from the inbox-sync worker.
//!
//! Delivery is best-effort, not exactly-once: publishing is log-and-drop (an
//! event can be lost if the broker is unavailable), and operation retries
//! can re-publish (a duplicate carries the same ids and state). Consumers
//! must treat events as idempotent state notifications and read back through
//! the API when exact current state matters.

#[cfg(test)]
mod test;

use chrono::{DateTime, Utc};
use macro_event_broker::{Event, MacroEvent, TopicEvent};
use macro_event_topics::MacroEmailTopic;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Whether a change was initiated by a Macro user action or first observed
/// syncing from the email provider. Lets automation ignore its own echoes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EmailEventOrigin {
    /// The change was initiated by a user action in Macro.
    UserAction,
    /// The change was first observed syncing from the provider (e.g. Gmail).
    ProviderSync,
}

/// Reference to an email label carried on wire events.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LabelRef {
    /// Macro's label row id, when the label is known locally.
    pub label_id: Option<Uuid>,
    /// Provider (Gmail) label id.
    pub provider_label_id: String,
    /// Label display name, when known.
    pub name: Option<String>,
}

/// Why an email link (connected inbox) was disconnected.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LinkDisconnectReason {
    /// The link was never meaningfully used and was reaped.
    Unused,
    /// The link went inactive and was reaped.
    Inactive,
    /// The user disconnected the inbox themselves.
    ManuallyDisabled,
    /// The Macro user account was deleted.
    UserDeleted,
    /// The provider OAuth grant was revoked.
    AccessRevoked,
}

/// Why a queued send was cancelled before reaching the provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SendCancelReason {
    /// The user undid the send (or unscheduled a scheduled send).
    Undo,
    /// The containing thread was trashed while the send was pending.
    ThreadTrashed,
}

/// Metadata for [`EmailTopicEvent::LinkConnected`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LinkConnectedMetadata {
    /// The id of the connected link (inbox).
    pub link_id: Uuid,
    /// The Macro user who owns the link.
    pub owner: MacroUserIdStr<'static>,
    /// Address of the connected inbox.
    pub email_address: String,
    /// Email provider (e.g. `GMAIL`).
    pub provider: String,
    /// Whether this is the owner's primary inbox.
    pub is_primary: bool,
    /// When the link was connected.
    pub connected_at: DateTime<Utc>,
}

/// Metadata for [`EmailTopicEvent::LinkDisconnected`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LinkDisconnectedMetadata {
    /// The id of the disconnected link.
    pub link_id: Uuid,
    /// The Macro user who owned the link.
    pub owner: MacroUserIdStr<'static>,
    /// Address of the disconnected inbox.
    pub email_address: String,
    /// Why the link was disconnected.
    pub reason: LinkDisconnectReason,
}

/// Metadata for [`EmailTopicEvent::LinkReauthRequired`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LinkReauthRequiredMetadata {
    /// The id of the link needing re-authentication.
    pub link_id: Uuid,
    /// The Macro user who owns the link.
    pub owner: MacroUserIdStr<'static>,
    /// Address of the inbox needing re-authentication.
    pub email_address: String,
    /// When the dead grant was observed.
    pub observed_at: DateTime<Utc>,
}

/// Metadata for [`EmailTopicEvent::MessageReceived`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageReceivedMetadata {
    /// The link (inbox) that received the message.
    pub link_id: Uuid,
    /// The Macro user who owns the link.
    pub owner: MacroUserIdStr<'static>,
    /// Macro's message row id.
    pub message_id: Uuid,
    /// Provider (Gmail) message id.
    pub provider_message_id: String,
    /// Macro's thread row id.
    pub thread_id: Uuid,
    /// Provider (Gmail) thread id.
    pub provider_thread_id: String,
    /// Whether the message started a thread new to this inbox.
    pub is_new_thread: bool,
    /// Message subject header.
    pub subject: Option<String>,
    /// Sender address.
    pub from_email: Option<String>,
    /// Sender display name.
    pub from_name: Option<String>,
    /// Recipient (`To`) addresses.
    pub to_emails: Vec<String>,
    /// Number of attachments on the message.
    pub attachment_count: u32,
    /// Whether the message arrived as spam or trash.
    pub is_spam_or_trash: bool,
    /// Provider-reported receive time.
    pub received_at: Option<DateTime<Utc>>,
}

/// Metadata for [`EmailTopicEvent::MessageSent`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageSentMetadata {
    /// The link (inbox) the message was sent from.
    pub link_id: Uuid,
    /// The Macro user who owns the link.
    pub owner: MacroUserIdStr<'static>,
    /// The authenticated user who sent the message; `None` when the send was
    /// first observed from the provider (sent from another client).
    pub actor: Option<MacroUserIdStr<'static>>,
    /// Macro's message row id.
    pub message_id: Uuid,
    /// Provider (Gmail) message id.
    pub provider_message_id: String,
    /// Macro's thread row id.
    pub thread_id: Uuid,
    /// Provider (Gmail) thread id.
    pub provider_thread_id: String,
    /// Message subject header.
    pub subject: Option<String>,
    /// Recipient (`To`) addresses.
    pub to_emails: Vec<String>,
    /// Carbon-copy (`Cc`) addresses. `Bcc` addresses are never published.
    pub cc_emails: Vec<String>,
    /// Whether the send was performed through Macro or observed from the
    /// provider.
    pub origin: EmailEventOrigin,
    /// When the provider accepted the message.
    pub sent_at: DateTime<Utc>,
}

/// Metadata for [`EmailTopicEvent::MessageDeleted`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageDeletedMetadata {
    /// The link (inbox) the message belonged to.
    pub link_id: Uuid,
    /// The Macro user who owns the link.
    pub owner: MacroUserIdStr<'static>,
    /// Macro's message row id.
    pub message_id: Uuid,
    /// Provider (Gmail) message id.
    pub provider_message_id: String,
    /// Macro's thread row id.
    pub thread_id: Uuid,
}

/// Metadata for [`EmailTopicEvent::MessageSendQueued`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageSendQueuedMetadata {
    /// The link (inbox) the message will be sent from.
    pub link_id: Uuid,
    /// The Macro user who owns the link.
    pub owner: MacroUserIdStr<'static>,
    /// The authenticated user who queued the send.
    pub actor: Option<MacroUserIdStr<'static>>,
    /// Macro's message row id.
    pub message_id: Uuid,
    /// Macro's thread row id.
    pub thread_id: Uuid,
    /// When the message is scheduled to leave.
    pub scheduled_send_at: DateTime<Utc>,
    /// `true` for an explicit scheduled send; `false` for the undo-window
    /// delay on an immediate send.
    pub is_scheduled: bool,
}

/// Metadata for [`EmailTopicEvent::MessageSendCancelled`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MessageSendCancelledMetadata {
    /// The link (inbox) the message would have been sent from.
    pub link_id: Uuid,
    /// The Macro user who owns the link.
    pub owner: MacroUserIdStr<'static>,
    /// The authenticated user who cancelled the send.
    pub actor: Option<MacroUserIdStr<'static>>,
    /// Macro's message row id.
    pub message_id: Uuid,
    /// Macro's thread row id.
    pub thread_id: Uuid,
    /// Why the queued send was cancelled.
    pub reason: SendCancelReason,
}

/// Metadata for [`EmailTopicEvent::ThreadArchived`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThreadArchivedMetadata {
    /// The link (inbox) containing the thread.
    pub link_id: Uuid,
    /// The Macro user who owns the link.
    pub owner: MacroUserIdStr<'static>,
    /// The authenticated user who changed the state; `None` for
    /// provider-initiated changes.
    pub actor: Option<MacroUserIdStr<'static>>,
    /// Macro's thread row id.
    pub thread_id: Uuid,
    /// New state: `true` = archived, `false` = moved back to the inbox.
    pub archived: bool,
    /// Where the change originated.
    pub origin: EmailEventOrigin,
}

/// Metadata for [`EmailTopicEvent::ThreadTrashed`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThreadTrashedMetadata {
    /// The link (inbox) containing the thread.
    pub link_id: Uuid,
    /// The Macro user who owns the link.
    pub owner: MacroUserIdStr<'static>,
    /// The authenticated user who changed the state; `None` for
    /// provider-initiated changes.
    pub actor: Option<MacroUserIdStr<'static>>,
    /// Macro's thread row id.
    pub thread_id: Uuid,
    /// New state: `true` = trashed, `false` = restored.
    pub trashed: bool,
    /// Where the change originated.
    pub origin: EmailEventOrigin,
}

/// Metadata for [`EmailTopicEvent::ThreadRead`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThreadReadMetadata {
    /// The link (inbox) containing the thread.
    pub link_id: Uuid,
    /// The Macro user who owns the link.
    pub owner: MacroUserIdStr<'static>,
    /// The authenticated user who changed the state; `None` for
    /// provider-initiated changes.
    pub actor: Option<MacroUserIdStr<'static>>,
    /// Macro's thread row id.
    pub thread_id: Uuid,
    /// New state: `true` = read, `false` = unread.
    pub is_read: bool,
    /// Where the change originated.
    pub origin: EmailEventOrigin,
}

/// Metadata for [`EmailTopicEvent::ThreadStarred`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThreadStarredMetadata {
    /// The link (inbox) containing the thread.
    pub link_id: Uuid,
    /// The Macro user who owns the link.
    pub owner: MacroUserIdStr<'static>,
    /// The authenticated user who changed the state; `None` for
    /// provider-initiated changes.
    pub actor: Option<MacroUserIdStr<'static>>,
    /// Macro's thread row id.
    pub thread_id: Uuid,
    /// New state: `true` = starred, `false` = unstarred.
    pub starred: bool,
    /// Where the change originated.
    pub origin: EmailEventOrigin,
}

/// Metadata for [`EmailTopicEvent::ThreadProjectChanged`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThreadProjectChangedMetadata {
    /// The link (inbox) containing the thread.
    pub link_id: Uuid,
    /// The Macro user who owns the link.
    pub owner: MacroUserIdStr<'static>,
    /// The authenticated user who changed the project.
    pub actor: MacroUserIdStr<'static>,
    /// Macro's thread row id.
    pub thread_id: Uuid,
    /// Project id before the change, when any.
    pub previous_project_id: Option<String>,
    /// New project id; `None` when the thread was removed from its project.
    pub project_id: Option<String>,
}

/// Metadata for [`EmailTopicEvent::ThreadLabelsUpdated`].
///
/// Carries **user label** changes only; system-label changes (INBOX, TRASH,
/// UNREAD, STARRED) are published as the semantic
/// [`EmailTopicEvent::ThreadArchived`] / [`EmailTopicEvent::ThreadTrashed`] /
/// [`EmailTopicEvent::ThreadRead`] / [`EmailTopicEvent::ThreadStarred`]
/// events instead.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ThreadLabelsUpdatedMetadata {
    /// The link (inbox) containing the thread.
    pub link_id: Uuid,
    /// The Macro user who owns the link.
    pub owner: MacroUserIdStr<'static>,
    /// The authenticated user who changed the labels; `None` for
    /// provider-initiated changes.
    pub actor: Option<MacroUserIdStr<'static>>,
    /// Macro's thread row id.
    pub thread_id: Uuid,
    /// Labels added to the thread's messages.
    pub added: Vec<LabelRef>,
    /// Labels removed from the thread's messages.
    pub removed: Vec<LabelRef>,
    /// Where the change originated.
    pub origin: EmailEventOrigin,
}

/// Events that can be published to [`MacroEmailTopic`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum EmailTopicEvent {
    /// An inbox was connected. Emitted from the email-service init handler
    /// after the link row is upserted.
    #[serde(rename = "email.link_connected")]
    LinkConnected(LinkConnectedMetadata),
    /// An inbox was disconnected. Emitted from the link-manager worker's
    /// delete cascade after the link row is deleted.
    #[serde(rename = "email.link_disconnected")]
    LinkDisconnected(LinkDisconnectedMetadata),
    /// An inbox's OAuth grant went dead. Emitted only on the false→true
    /// `needs_reauth` transition (edge-triggered).
    #[serde(rename = "email.link_reauth_required")]
    LinkReauthRequired(LinkReauthRequiredMetadata),
    /// A new inbound message was persisted. Emitted from the inbox-sync
    /// worker for messages not seen before; never from the backfill worker.
    /// When a previously-unsynced thread is pulled in whole, only the
    /// message that triggered the sync is published — its historical
    /// siblings are persisted silently (they were not just received).
    #[serde(rename = "email.message_received")]
    MessageReceived(MessageReceivedMetadata),
    /// A message was accepted by the provider. Emitted from the scheduled
    /// send worker after the provider accepts (`origin = user_action`), or
    /// from the inbox-sync worker when a message sent from another client is
    /// first synced (`origin = provider_sync`).
    #[serde(rename = "email.message_sent")]
    MessageSent(MessageSentMetadata),
    /// A message was permanently deleted. Emitted from the inbox-sync worker
    /// after the delete transaction commits.
    #[serde(rename = "email.message_deleted")]
    MessageDeleted(MessageDeletedMetadata),
    /// A send was committed and queued (undo window or scheduled send).
    /// Emitted from the email domain service and the schedule handler.
    /// Always resolved by exactly one later `message_sent` or
    /// `message_send_cancelled` for the same message.
    #[serde(rename = "email.message_send_queued")]
    MessageSendQueued(MessageSendQueuedMetadata),
    /// A queued send was cancelled before reaching the provider. Emitted
    /// from the unschedule/undo handler and the trash path.
    #[serde(rename = "email.message_send_cancelled")]
    MessageSendCancelled(MessageSendCancelledMetadata),
    /// A thread was archived or unarchived. Emitted from the archive handler
    /// (`origin = user_action`) or the inbox-sync INBOX-label diff
    /// (`origin = provider_sync`).
    #[serde(rename = "email.thread_archived")]
    ThreadArchived(ThreadArchivedMetadata),
    /// A thread was trashed or restored. Emitted from the email domain
    /// service's TRASH label path (`origin = user_action`) or the inbox-sync
    /// TRASH-label diff (`origin = provider_sync`).
    #[serde(rename = "email.thread_trashed")]
    ThreadTrashed(ThreadTrashedMetadata),
    /// A thread was marked read or unread. Emitted from the seen handler and
    /// the email domain service's UNREAD label path (`origin = user_action`)
    /// or the inbox-sync UNREAD-label diff (`origin = provider_sync`).
    #[serde(rename = "email.thread_read")]
    ThreadRead(ThreadReadMetadata),
    /// A thread was starred or unstarred. Emitted from the email domain
    /// service's STARRED label path (`origin = user_action`) or the
    /// inbox-sync STARRED-label diff (`origin = provider_sync`).
    #[serde(rename = "email.thread_starred")]
    ThreadStarred(ThreadStarredMetadata),
    /// A thread was assigned to or removed from a project. Emitted from the
    /// email domain service's thread-project update.
    #[serde(rename = "email.thread_project_changed")]
    ThreadProjectChanged(ThreadProjectChangedMetadata),
    /// A thread's user labels changed. Emitted from the email domain
    /// service's label path (`origin = user_action`) or the inbox-sync label
    /// diff (`origin = provider_sync`). System labels are published as the
    /// semantic thread events instead.
    #[serde(rename = "email.thread_labels_updated")]
    ThreadLabelsUpdated(ThreadLabelsUpdatedMetadata),
}

impl TopicEvent for EmailTopicEvent {
    type Topic = MacroEmailTopic;

    fn schema_version(&self) -> u8 {
        1
    }
}

/// Publishable event for [`MacroEmailTopic`], keyed by link (inbox) id.
pub struct EmailMacroEvent {
    key: String,
    event: Event<EmailTopicEvent>,
}

impl EmailMacroEvent {
    /// Build a link-connected event keyed by the link id.
    pub fn link_connected(metadata: LinkConnectedMetadata) -> Self {
        Self::new(
            metadata.link_id.to_string(),
            EmailTopicEvent::LinkConnected(metadata),
        )
    }

    /// Build a link-disconnected event keyed by the link id.
    pub fn link_disconnected(metadata: LinkDisconnectedMetadata) -> Self {
        Self::new(
            metadata.link_id.to_string(),
            EmailTopicEvent::LinkDisconnected(metadata),
        )
    }

    /// Build a link-reauth-required event keyed by the link id.
    pub fn link_reauth_required(metadata: LinkReauthRequiredMetadata) -> Self {
        Self::new(
            metadata.link_id.to_string(),
            EmailTopicEvent::LinkReauthRequired(metadata),
        )
    }

    /// Build a message-received event keyed by the link id.
    pub fn message_received(metadata: MessageReceivedMetadata) -> Self {
        Self::new(
            metadata.link_id.to_string(),
            EmailTopicEvent::MessageReceived(metadata),
        )
    }

    /// Build a message-sent event keyed by the link id.
    pub fn message_sent(metadata: MessageSentMetadata) -> Self {
        Self::new(
            metadata.link_id.to_string(),
            EmailTopicEvent::MessageSent(metadata),
        )
    }

    /// Build a message-deleted event keyed by the link id.
    pub fn message_deleted(metadata: MessageDeletedMetadata) -> Self {
        Self::new(
            metadata.link_id.to_string(),
            EmailTopicEvent::MessageDeleted(metadata),
        )
    }

    /// Build a message-send-queued event keyed by the link id.
    pub fn message_send_queued(metadata: MessageSendQueuedMetadata) -> Self {
        Self::new(
            metadata.link_id.to_string(),
            EmailTopicEvent::MessageSendQueued(metadata),
        )
    }

    /// Build a message-send-cancelled event keyed by the link id.
    pub fn message_send_cancelled(metadata: MessageSendCancelledMetadata) -> Self {
        Self::new(
            metadata.link_id.to_string(),
            EmailTopicEvent::MessageSendCancelled(metadata),
        )
    }

    /// Build a thread-archived event keyed by the link id.
    pub fn thread_archived(metadata: ThreadArchivedMetadata) -> Self {
        Self::new(
            metadata.link_id.to_string(),
            EmailTopicEvent::ThreadArchived(metadata),
        )
    }

    /// Build a thread-trashed event keyed by the link id.
    pub fn thread_trashed(metadata: ThreadTrashedMetadata) -> Self {
        Self::new(
            metadata.link_id.to_string(),
            EmailTopicEvent::ThreadTrashed(metadata),
        )
    }

    /// Build a thread-read event keyed by the link id.
    pub fn thread_read(metadata: ThreadReadMetadata) -> Self {
        Self::new(
            metadata.link_id.to_string(),
            EmailTopicEvent::ThreadRead(metadata),
        )
    }

    /// Build a thread-starred event keyed by the link id.
    pub fn thread_starred(metadata: ThreadStarredMetadata) -> Self {
        Self::new(
            metadata.link_id.to_string(),
            EmailTopicEvent::ThreadStarred(metadata),
        )
    }

    /// Build a thread-project-changed event keyed by the link id.
    pub fn thread_project_changed(metadata: ThreadProjectChangedMetadata) -> Self {
        Self::new(
            metadata.link_id.to_string(),
            EmailTopicEvent::ThreadProjectChanged(metadata),
        )
    }

    /// Build a thread-labels-updated event keyed by the link id.
    pub fn thread_labels_updated(metadata: ThreadLabelsUpdatedMetadata) -> Self {
        Self::new(
            metadata.link_id.to_string(),
            EmailTopicEvent::ThreadLabelsUpdated(metadata),
        )
    }

    /// Map a thread-scoped label change onto the semantic event for that
    /// label: INBOX/TRASH/UNREAD/STARRED become the dedicated thread-state
    /// events, SPAM/IMPORTANT/SENT/DRAFT publish nothing (`None`), and any
    /// other (user) label becomes a `thread_labels_updated` diff.
    pub fn thread_label_change(
        link_id: Uuid,
        owner: MacroUserIdStr<'static>,
        actor: Option<MacroUserIdStr<'static>>,
        thread_id: Uuid,
        label: LabelRef,
        added: bool,
        origin: EmailEventOrigin,
    ) -> Option<Self> {
        use crate::domain::models::label::system_labels;

        let event = match label.provider_label_id.as_str() {
            system_labels::UNREAD => Self::thread_read(ThreadReadMetadata {
                link_id,
                owner,
                actor,
                thread_id,
                is_read: !added,
                origin,
            }),
            system_labels::STARRED => Self::thread_starred(ThreadStarredMetadata {
                link_id,
                owner,
                actor,
                thread_id,
                starred: added,
                origin,
            }),
            system_labels::TRASH => Self::thread_trashed(ThreadTrashedMetadata {
                link_id,
                owner,
                actor,
                thread_id,
                trashed: added,
                origin,
            }),
            system_labels::INBOX => Self::thread_archived(ThreadArchivedMetadata {
                link_id,
                owner,
                actor,
                thread_id,
                archived: !added,
                origin,
            }),
            system_labels::SPAM
            | system_labels::IMPORTANT
            | system_labels::SENT
            | system_labels::DRAFT => return None,
            // Gmail category tabs (CATEGORY_PERSONAL/SOCIAL/...) are
            // provider system labels, not user labels.
            l if l.starts_with("CATEGORY_") => return None,
            _ => {
                let (added, removed) = if added {
                    (vec![label], vec![])
                } else {
                    (vec![], vec![label])
                };
                Self::thread_labels_updated(ThreadLabelsUpdatedMetadata {
                    link_id,
                    owner,
                    actor,
                    thread_id,
                    added,
                    removed,
                    origin,
                })
            }
        };
        Some(event)
    }

    /// Build an event from a topic-specific event variant.
    pub fn new(key: impl Into<String>, event: EmailTopicEvent) -> Self {
        Self::with_event(key, Event::new(event))
    }

    /// Build an event from a pre-built envelope.
    pub fn with_event(key: impl Into<String>, event: Event<EmailTopicEvent>) -> Self {
        Self {
            key: key.into(),
            event,
        }
    }
}

impl MacroEvent for EmailMacroEvent {
    type EventPayload = EmailTopicEvent;

    fn key(&self) -> &str {
        &self.key
    }

    fn event(&self) -> &Event<Self::EventPayload> {
        &self.event
    }

    fn from_event(key: String, event: Event<Self::EventPayload>) -> Self {
        Self::with_event(key, event)
    }
}
