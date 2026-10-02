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
    /// Previous reminder ordering, retained when undo restores the inbox.
    pub returned_at: Option<DateTime<Utc>>,
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
    /// Resolve a bounded set of candidate threads using email-owned access and filters.
    /// Missing and inaccessible threads are omitted, including revoked shares.
    fn reminder_threads(
        &self,
        user: MacroUserIdStr<'static>,
        receipts: Vec<
            entity_access::domain::models::EntityAccessReceipt<
                entity_access::domain::models::ViewAccessLevel,
            >,
        >,
        filters: &ReminderThreadFilter,
    ) -> impl Future<Output = Result<Vec<Uuid>, EmailErr>> + Send;

    /// Read existing authorized row identities, including shared mail, without
    /// imposing Mail collection membership on another view's visible rows.
    fn reminder_summary_threads(
        &self,
        user: MacroUserIdStr<'static>,
        receipts: Vec<
            entity_access::domain::models::EntityAccessReceipt<
                entity_access::domain::models::ViewAccessLevel,
            >,
        >,
    ) -> impl Future<Output = Result<Vec<Uuid>, EmailErr>> + Send;

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

/// Email facets applied before the reminder collection's public page boundary.
#[derive(Debug, Clone, Default)]
pub struct ReminderThreadFilter {
    /// None selects every accessible inbox; an empty selection matches nothing.
    pub inbox_ids: Option<Vec<Uuid>>,
    /// Explicit email archive filter, independent of reminder completion.
    pub done: Option<bool>,
    /// Explicit email read filter.
    pub read: Option<bool>,
    /// Restrict to threads with calendar attachments.
    pub calendar: bool,
    /// Tag select options, ORed together like the ordinary email facet.
    pub tags: Vec<(Uuid, Uuid)>,
    /// Attachment categories, ORed together.
    pub attachments: Vec<ReminderAttachmentKind>,
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

    /// Read ordering metadata without widening the generic thread model.
    fn followup_returned_at(
        &self,
        thread_id: Uuid,
        link_id: Uuid,
    ) -> impl Future<Output = Result<Option<DateTime<Utc>>, EmailErr>> + Send;

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

/// The existing email attachment facets.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ReminderAttachmentKind {
    /// PDF files.
    Pdf,
    /// Supported image formats.
    Image,
    /// Office documents, text and CSV.
    Document,
}

impl ReminderAttachmentKind {
    /// Match the same MIME prefixes as the ordinary Email view.
    pub fn matches(self, mime: &str) -> bool {
        let prefixes: &[&str] = match self {
            Self::Pdf => &["application/pdf"],
            Self::Image => &[
                "image/png",
                "image/jpeg",
                "image/gif",
                "image/webp",
                "image/svg+xml",
            ],
            Self::Document => &[
                "application/msword",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                "application/vnd.ms-excel",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                "application/vnd.ms-powerpoint",
                "application/vnd.openxmlformats-officedocument.presentationml.presentation",
                "text/plain",
                "text/csv",
            ],
        };
        prefixes.iter().any(|prefix| mime.starts_with(prefix))
    }
}
