//! Public email events on the `macro.email_notifications` topic.
//!
//! `macro.email` carries every email fact, including internal sync signals
//! (backfill completion, reindex requests) that only Macro's own consumers
//! read. This topic carries the subset delivered to the inbox owner's
//! webhooks and user-scoped event stream, so the public contract lives in one
//! type, [`EmailNotificationEvent`], instead of a filter in each consumer.
//!
//! Producers never build these events directly: publish an
//! [`EmailMacroEvent`] through [`EmailEventBroker`], which sends it to
//! `macro.email` and, when [`EmailNotificationEvent::from_topic_event`]
//! admits it, its public form to `macro.email_notifications`. Both records
//! share the event id and the link-id key, so consumers deduplicate across
//! retries and keep per-inbox order on either topic.

#[cfg(test)]
mod test;

use std::future::Future;

use macro_event_broker::{Event, EventBrokerError, MacroEvent, MacroEventBroker, TopicEvent};
use macro_event_topics::MacroEmailNotificationsTopic;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::events::{
    EmailMacroEvent, EmailTopicEvent, LinkConnectedMetadata, LinkDisconnectedMetadata,
    LinkReauthRequiredMetadata, MessageDeletedMetadata, MessageDraftSyncedMetadata,
    MessageReceivedMetadata, MessageSendCancelledMetadata, MessageSendQueuedMetadata,
    MessageSentMetadata, ThreadArchivedMetadata, ThreadLabelsUpdatedMetadata,
    ThreadProjectChangedMetadata, ThreadReadMetadata, ThreadSpamChangedMetadata,
    ThreadStarredMetadata, ThreadTrashedMetadata,
};

/// Email events delivered to the inbox owner's webhooks and event stream.
///
/// Each variant has the same `event_type` tag and metadata as its
/// [`EmailTopicEvent`] counterpart. Payloads carry header-level data only.
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum EmailNotificationEvent {
    /// An inbox was connected.
    #[serde(rename = "email.link_connected")]
    LinkConnected(LinkConnectedMetadata),
    /// An inbox was disconnected.
    #[serde(rename = "email.link_disconnected")]
    LinkDisconnected(LinkDisconnectedMetadata),
    /// An inbox's OAuth grant went dead and needs re-authentication.
    #[serde(rename = "email.link_reauth_required")]
    LinkReauthRequired(LinkReauthRequiredMetadata),
    /// A new inbound message arrived outside spam and trash.
    #[serde(rename = "email.message_received")]
    MessageReceived(MessageReceivedMetadata),
    /// A draft was persisted or updated while syncing from the provider.
    #[serde(rename = "email.message_draft_synced")]
    MessageDraftSynced(MessageDraftSyncedMetadata),
    /// A message was accepted by the provider.
    #[serde(rename = "email.message_sent")]
    MessageSent(MessageSentMetadata),
    /// A message was permanently deleted.
    #[serde(rename = "email.message_deleted")]
    MessageDeleted(MessageDeletedMetadata),
    /// A send was committed and queued (undo window or scheduled send).
    #[serde(rename = "email.message_send_queued")]
    MessageSendQueued(MessageSendQueuedMetadata),
    /// A queued send was cancelled before reaching the provider.
    #[serde(rename = "email.message_send_cancelled")]
    MessageSendCancelled(MessageSendCancelledMetadata),
    /// A thread was archived or unarchived.
    #[serde(rename = "email.thread_archived")]
    ThreadArchived(ThreadArchivedMetadata),
    /// A thread was trashed or restored.
    #[serde(rename = "email.thread_trashed")]
    ThreadTrashed(ThreadTrashedMetadata),
    /// A thread was marked read or unread.
    #[serde(rename = "email.thread_read")]
    ThreadRead(ThreadReadMetadata),
    /// A thread was starred or unstarred.
    #[serde(rename = "email.thread_starred")]
    ThreadStarred(ThreadStarredMetadata),
    /// A thread was marked or unmarked spam.
    #[serde(rename = "email.thread_spam_changed")]
    ThreadSpamChanged(ThreadSpamChangedMetadata),
    /// A thread was assigned to or removed from a project.
    #[serde(rename = "email.thread_project_changed")]
    ThreadProjectChanged(ThreadProjectChangedMetadata),
    /// A thread's user labels changed.
    #[serde(rename = "email.thread_labels_updated")]
    ThreadLabelsUpdated(ThreadLabelsUpdatedMetadata),
}

/// What a public email event is about, for subscription filters.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EmailNotificationSubject {
    /// A connected inbox, by link id.
    Link(Uuid),
    /// A thread, by thread id.
    Thread(Uuid),
}

impl EmailNotificationEvent {
    /// The public form of an internal email event, or `None` when the event is
    /// not delivered: backfill and reindex signals, and mail arriving in spam
    /// or trash (the rule routines use for new mail).
    pub fn from_topic_event(event: &EmailTopicEvent) -> Option<Self> {
        let public = match event {
            EmailTopicEvent::LinkConnected(m) => Self::LinkConnected(m.clone()),
            EmailTopicEvent::LinkDisconnected(m) => Self::LinkDisconnected(m.clone()),
            EmailTopicEvent::LinkReauthRequired(m) => Self::LinkReauthRequired(m.clone()),
            EmailTopicEvent::MessageReceived(m) if m.is_spam_or_trash => return None,
            EmailTopicEvent::MessageReceived(m) => Self::MessageReceived(m.clone()),
            EmailTopicEvent::MessageDraftSynced(m) => Self::MessageDraftSynced(m.clone()),
            EmailTopicEvent::MessageSent(m) => Self::MessageSent(m.clone()),
            EmailTopicEvent::MessageDeleted(m) => Self::MessageDeleted(m.clone()),
            EmailTopicEvent::MessageSendQueued(m) => Self::MessageSendQueued(m.clone()),
            EmailTopicEvent::MessageSendCancelled(m) => Self::MessageSendCancelled(m.clone()),
            EmailTopicEvent::ThreadArchived(m) => Self::ThreadArchived(m.clone()),
            EmailTopicEvent::ThreadTrashed(m) => Self::ThreadTrashed(m.clone()),
            EmailTopicEvent::ThreadRead(m) => Self::ThreadRead(m.clone()),
            EmailTopicEvent::ThreadStarred(m) => Self::ThreadStarred(m.clone()),
            EmailTopicEvent::ThreadSpamChanged(m) => Self::ThreadSpamChanged(m.clone()),
            EmailTopicEvent::ThreadProjectChanged(m) => Self::ThreadProjectChanged(m.clone()),
            EmailTopicEvent::ThreadLabelsUpdated(m) => Self::ThreadLabelsUpdated(m.clone()),
            EmailTopicEvent::ThreadBackfilled(_) | EmailTopicEvent::ThreadsReindexRequested(_) => {
                return None;
            }
        };
        Some(public)
    }

    /// The event name carried by the wire `event_type` tag.
    pub fn name(&self) -> &'static str {
        match self {
            Self::LinkConnected(..) => "email.link_connected",
            Self::LinkDisconnected(..) => "email.link_disconnected",
            Self::LinkReauthRequired(..) => "email.link_reauth_required",
            Self::MessageReceived(..) => "email.message_received",
            Self::MessageDraftSynced(..) => "email.message_draft_synced",
            Self::MessageSent(..) => "email.message_sent",
            Self::MessageDeleted(..) => "email.message_deleted",
            Self::MessageSendQueued(..) => "email.message_send_queued",
            Self::MessageSendCancelled(..) => "email.message_send_cancelled",
            Self::ThreadArchived(..) => "email.thread_archived",
            Self::ThreadTrashed(..) => "email.thread_trashed",
            Self::ThreadRead(..) => "email.thread_read",
            Self::ThreadStarred(..) => "email.thread_starred",
            Self::ThreadSpamChanged(..) => "email.thread_spam_changed",
            Self::ThreadProjectChanged(..) => "email.thread_project_changed",
            Self::ThreadLabelsUpdated(..) => "email.thread_labels_updated",
        }
    }

    /// The user whose private inbox owns this event.
    pub fn owner(&self) -> &MacroUserIdStr<'static> {
        match self {
            Self::LinkConnected(m) => &m.owner,
            Self::LinkDisconnected(m) => &m.owner,
            Self::LinkReauthRequired(m) => &m.owner,
            Self::MessageReceived(m) => &m.owner,
            Self::MessageDraftSynced(m) => &m.owner,
            Self::MessageSent(m) => &m.owner,
            Self::MessageDeleted(m) => &m.owner,
            Self::MessageSendQueued(m) => &m.owner,
            Self::MessageSendCancelled(m) => &m.owner,
            Self::ThreadArchived(m) => &m.owner,
            Self::ThreadTrashed(m) => &m.owner,
            Self::ThreadRead(m) => &m.owner,
            Self::ThreadStarred(m) => &m.owner,
            Self::ThreadSpamChanged(m) => &m.owner,
            Self::ThreadProjectChanged(m) => &m.owner,
            Self::ThreadLabelsUpdated(m) => &m.owner,
        }
    }

    /// The connected inbox that published this event.
    pub fn link_id(&self) -> Uuid {
        match self {
            Self::LinkConnected(m) => m.link_id,
            Self::LinkDisconnected(m) => m.link_id,
            Self::LinkReauthRequired(m) => m.link_id,
            Self::MessageReceived(m) => m.link_id,
            Self::MessageDraftSynced(m) => m.link_id,
            Self::MessageSent(m) => m.link_id,
            Self::MessageDeleted(m) => m.link_id,
            Self::MessageSendQueued(m) => m.link_id,
            Self::MessageSendCancelled(m) => m.link_id,
            Self::ThreadArchived(m) => m.link_id,
            Self::ThreadTrashed(m) => m.link_id,
            Self::ThreadRead(m) => m.link_id,
            Self::ThreadStarred(m) => m.link_id,
            Self::ThreadSpamChanged(m) => m.link_id,
            Self::ThreadProjectChanged(m) => m.link_id,
            Self::ThreadLabelsUpdated(m) => m.link_id,
        }
    }

    /// The inbox for link events, otherwise the thread.
    pub fn subject(&self) -> EmailNotificationSubject {
        match self {
            Self::LinkConnected(m) => EmailNotificationSubject::Link(m.link_id),
            Self::LinkDisconnected(m) => EmailNotificationSubject::Link(m.link_id),
            Self::LinkReauthRequired(m) => EmailNotificationSubject::Link(m.link_id),
            Self::MessageReceived(m) => EmailNotificationSubject::Thread(m.thread_id),
            Self::MessageDraftSynced(m) => EmailNotificationSubject::Thread(m.thread_id),
            Self::MessageSent(m) => EmailNotificationSubject::Thread(m.thread_id),
            Self::MessageDeleted(m) => EmailNotificationSubject::Thread(m.thread_id),
            Self::MessageSendQueued(m) => EmailNotificationSubject::Thread(m.thread_id),
            Self::MessageSendCancelled(m) => EmailNotificationSubject::Thread(m.thread_id),
            Self::ThreadArchived(m) => EmailNotificationSubject::Thread(m.thread_id),
            Self::ThreadTrashed(m) => EmailNotificationSubject::Thread(m.thread_id),
            Self::ThreadRead(m) => EmailNotificationSubject::Thread(m.thread_id),
            Self::ThreadStarred(m) => EmailNotificationSubject::Thread(m.thread_id),
            Self::ThreadSpamChanged(m) => EmailNotificationSubject::Thread(m.thread_id),
            Self::ThreadProjectChanged(m) => EmailNotificationSubject::Thread(m.thread_id),
            Self::ThreadLabelsUpdated(m) => EmailNotificationSubject::Thread(m.thread_id),
        }
    }
}

impl TopicEvent for EmailNotificationEvent {
    type Topic = MacroEmailNotificationsTopic;

    const SCHEMA_VERSION: u8 = 1;
}

/// Publishable event for [`MacroEmailNotificationsTopic`], keyed by link id.
pub struct EmailNotificationMacroEvent {
    key: String,
    event: Event<EmailNotificationEvent>,
}

impl EmailNotificationMacroEvent {
    /// The public counterpart of an internal email event, keeping its key and
    /// envelope (event id, correlation, routine and verb), or `None` when the
    /// event is not delivered publicly.
    pub fn from_email_event(source: &EmailMacroEvent) -> Option<Self> {
        let envelope = source.event();
        let payload = EmailNotificationEvent::from_topic_event(&envelope.event)?;
        Some(Self {
            key: source.key().to_string(),
            event: Event {
                event_id: envelope.event_id,
                agent_correlation_id: envelope.agent_correlation_id,
                routine_id: envelope.routine_id,
                agent_verb: envelope.agent_verb.clone(),
                schema_version: EmailNotificationEvent::SCHEMA_VERSION,
                event: payload,
            },
        })
    }
}

impl MacroEvent for EmailNotificationMacroEvent {
    type EventPayload = EmailNotificationEvent;

    fn key(&self) -> &str {
        &self.key
    }

    fn event(&self) -> &Event<Self::EventPayload> {
        &self.event
    }

    fn from_event(key: String, event: Event<Self::EventPayload>) -> Self {
        Self { key, event }
    }
}

/// Publishes email events to both email topics. Implemented for every
/// [`MacroEventBroker`]; send every [`EmailMacroEvent`] through it, never
/// through `send_event`, or webhooks and streams miss the event.
pub trait EmailEventBroker: MacroEventBroker {
    /// Send `event` to `macro.email` and its public form, if any, to
    /// `macro.email_notifications`. Both sends start before this returns;
    /// await the future to wait for the broker's acknowledgement of each.
    fn send_email_event(
        &self,
        event: &EmailMacroEvent,
    ) -> Result<impl Future<Output = Result<(), EventBrokerError>> + Send + 'static, EventBrokerError>
    {
        let internal = self.send_event(event)?;
        let public = EmailNotificationMacroEvent::from_email_event(event)
            .map(|public| self.send_event(&public))
            .transpose()?;
        Ok(async move {
            for handle in std::iter::once(internal).chain(public) {
                handle
                    .await
                    .map_err(|error| EventBrokerError::Publish(error.to_string()))??;
            }
            Ok(())
        })
    }

    /// Send `event` like [`Self::send_email_event`], logging and dropping
    /// failures: event emission must never fail the email operation.
    fn publish_email_event(&self, event: &EmailMacroEvent) {
        let _ = self
            .send_email_event(event)
            .inspect_err(|e| tracing::error!(error=?e, "failed to publish email macro event"));
    }
}

impl<B: MacroEventBroker + ?Sized> EmailEventBroker for B {}
