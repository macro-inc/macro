//! Email-owned capabilities used by conditional reminders.
//!
//! A reminder never edits message dates or infers replies from thread updates.
//! The inbox identity is resolved again for every operation, including dispatch.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::models::EmailErr;

/// Persisted boundary between existing mail and a genuinely new reply.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReplyBaseline {
    /// Capture time, independent of mutable thread timestamps.
    pub captured_at: DateTime<Utc>,
    /// Provider messages already present when the reminder was set.
    pub message_ids: Vec<Uuid>,
}

/// Small message facts needed to classify a reply, without loading bodies.
#[derive(Debug, Clone)]
pub struct FollowupMessage {
    /// Stable database identity (provider replays upsert the same identity).
    pub id: Uuid,
    /// Provider's immutable arrival time, not the ingestion time.
    pub received_at: Option<DateTime<Utc>>,
    /// Drafts and SENT messages, including provider send-as aliases, are outgoing.
    pub outgoing: bool,
    /// Whether the sender is one of the viewer's accessible inbox identities.
    pub from_self: bool,
}

/// Authorized thread facts; inaccessible/deleted threads produce no snapshot.
#[derive(Debug, Clone)]
pub struct FollowupThread {
    /// Canonical inbox, resolved from the thread rather than the primary inbox.
    pub link_id: Uuid,
    /// Subject used as the reminder description.
    pub subject: String,
    /// Current visibility, retained for coherent undo.
    pub inbox_visible: bool,
    /// Trashed/spam threads must never be resurrected by a follow-up.
    pub unavailable: bool,
    /// Persisted messages, excluding bodies and recipient lists.
    pub messages: Vec<FollowupMessage>,
}

impl FollowupThread {
    /// Capture stable identities and the server clock before archiving.
    pub fn baseline(&self, now: DateTime<Utc>) -> ReplyBaseline {
        ReplyBaseline {
            captured_at: now,
            message_ids: self.messages.iter().map(|message| message.id).collect(),
        }
    }

    /// Label changes, outgoing mail, drafts, replays and historical backfill
    /// cannot satisfy this predicate. A delayed live arrival can, provided its
    /// provider arrival time is after the reminder's boundary.
    pub fn has_reply(&self, baseline: &ReplyBaseline) -> bool {
        self.messages.iter().any(|message| {
            !message.outgoing
                && !message.from_self
                && message
                    .received_at
                    .is_some_and(|at| at > baseline.captured_at)
                && !baseline.message_ids.contains(&message.id)
        })
    }
}

/// Email facts and mutations exposed to the reminder domain.
pub trait EmailFollowupMailbox: Send + Sync + 'static {
    /// Resolve owned/delegated access and inspect this conversation.
    fn followup_thread(
        &self,
        user: MacroUserIdStr<'static>,
        thread_id: Uuid,
    ) -> impl Future<Output = Result<Option<FollowupThread>, EmailErr>> + Send;

    /// Apply a reminder's inbox state, checking the same inbox and access again.
    /// `returned_at` is honest inbox ordering metadata, never a message date.
    /// Unlike ordinary unarchive, this explicitly permits sent-only threads.
    fn set_followup_inbox(
        &self,
        user: MacroUserIdStr<'static>,
        thread_id: Uuid,
        link_id: Uuid,
        visible: bool,
        returned_at: Option<DateTime<Utc>>,
    ) -> impl Future<Output = Result<(), EmailErr>> + Send;
}

/// Persistence capabilities specific to the email side of follow-ups.
pub trait EmailFollowupRepo: Send + Sync + 'static {
    /// Load message identity/classification facts for an authorized thread.
    fn followup_messages(
        &self,
        user: MacroUserIdStr<'static>,
        thread_id: Uuid,
        link_id: Uuid,
    ) -> impl Future<Output = Result<Vec<FollowupMessage>, EmailErr>> + Send;

    /// Store a return timestamp separately from immutable mail activity.
    fn set_followup_returned_at(
        &self,
        thread_id: Uuid,
        link_id: Uuid,
        returned_at: Option<DateTime<Utc>>,
    ) -> impl Future<Output = Result<(), EmailErr>> + Send;
}

#[cfg(test)]
mod test;
