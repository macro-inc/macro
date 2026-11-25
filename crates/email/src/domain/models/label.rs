use super::SimpleMessage;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MessageListVisibility {
    Show,
    Hide,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LabelListVisibility {
    LabelShow,
    LabelShowIfUnread,
    LabelHide,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LabelType {
    System,
    User,
}

#[derive(Debug, Clone)]
pub struct Label {
    pub id: Uuid,
    #[allow(unused)]
    pub(crate) thread_id: Uuid,
    pub link_id: Uuid,
    pub provider_label_id: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub message_list_visibility: MessageListVisibility,
    pub label_list_visibility: LabelListVisibility,
    pub type_: LabelType,
}

/// A label on a message.
#[derive(Debug, Clone)]
pub struct MessageLabel {
    /// Database ID of the label.
    pub id: Option<uuid::Uuid>,
    /// Link ID the label belongs to.
    pub link_id: uuid::Uuid,
    /// Provider label ID (e.g. "INBOX", "SENT").
    pub provider_label_id: String,
    /// Human-readable label name.
    pub name: Option<String>,
    /// When the label was created.
    pub created_at: DateTime<Utc>,
    /// Message list visibility setting.
    pub message_list_visibility: Option<MessageListVisibility>,
    /// Label list visibility setting.
    pub label_list_visibility: Option<LabelListVisibility>,
    /// Label type (system or user).
    pub type_: Option<LabelType>,
}

/// A label looked up by ID, used for thread label operations.
#[derive(Debug, Clone)]
pub struct LinkLabel {
    pub id: Uuid,
    pub link_id: Uuid,
    pub provider_label_id: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub message_list_visibility: MessageListVisibility,
    pub label_list_visibility: LabelListVisibility,
    pub type_: LabelType,
}

impl LinkLabel {
    /// The label called `name` among one inbox's labels: a system label by
    /// its provider id (INBOX, UNREAD, STARRED, ...), otherwise any label by
    /// its display name. Case and surrounding whitespace are ignored.
    pub fn find<'a>(labels: &'a [LinkLabel], name: &str) -> Option<&'a LinkLabel> {
        let name = name.trim().to_lowercase();
        labels
            .iter()
            .find(|label| {
                label.type_ == LabelType::System && label.provider_label_id.to_lowercase() == name
            })
            .or_else(|| {
                labels
                    .iter()
                    .find(|label| label.name.trim().to_lowercase() == name)
            })
    }
}

/// Result of updating labels on a thread's messages.
#[derive(Debug, Clone)]
pub struct UpdateThreadLabelsResult {
    pub successful_ids: Vec<Uuid>,
    pub failed_ids: Vec<Uuid>,
}

/// A label change staged on a thread for Gmail, read in the same transaction
/// that applied it.
#[derive(Debug, Clone)]
pub struct StagedLabelChange {
    /// Every message of the thread.
    pub messages: Vec<SimpleMessage>,
    /// The messages that gained or lost the label.
    pub changed_ids: Vec<Uuid>,
    /// Whether the thread gained the label: it is one someone made, and no
    /// message of the thread, drafts aside, carried it before.
    pub thread_gained: bool,
}

/// User labels a thread gained in one write, kept with the write until it is
/// published.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct LabelsGained {
    /// Published as the event's id, so a retried projection repeats it.
    pub event_id: Uuid,
    /// Label row ids.
    pub label_ids: Vec<Uuid>,
    /// The message the labels were seen on; `None` for a whole thread.
    #[serde(default)]
    pub message_id: Option<Uuid>,
    /// Whether an agent or a routine added them.
    #[serde(default)]
    pub automated: bool,
}

impl LabelsGained {
    /// Labels first seen on a message read from the provider.
    pub fn from_provider(label_ids: Vec<Uuid>, message_id: Uuid) -> Option<Self> {
        (!label_ids.is_empty()).then(|| Self {
            event_id: macro_uuid::generate_uuid_v7(),
            label_ids,
            message_id: Some(message_id),
            automated: false,
        })
    }
}

/// The most threads one bulk archive request may change.
pub const MAX_BULK_ARCHIVE_THREADS: usize = 100;

/// Result of archiving or unarchiving many threads.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SetThreadsArchivedResult {
    /// Threads whose archive state now matches the request.
    pub updated_thread_ids: Vec<Uuid>,
    /// Threads left unchanged because they could not be updated.
    pub failed_thread_ids: Vec<Uuid>,
}

/// Well-known system label identifiers.
pub mod system_labels {
    /// The UNREAD label.
    pub const UNREAD: &str = "UNREAD";
    /// The STARRED label.
    pub const STARRED: &str = "STARRED";
    /// The TRASH label.
    pub const TRASH: &str = "TRASH";
    /// The INBOX label.
    pub const INBOX: &str = "INBOX";
    /// The SPAM label.
    pub const SPAM: &str = "SPAM";
    /// The IMPORTANT label.
    pub const IMPORTANT: &str = "IMPORTANT";
    /// The SENT label.
    pub const SENT: &str = "SENT";
    /// The DRAFT label.
    pub const DRAFT: &str = "DRAFT";
}
