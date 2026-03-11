use chrono::{DateTime, Utc};
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

/// Result of updating labels on a thread's messages.
#[derive(Debug, Clone)]
pub struct UpdateThreadLabelsResult {
    pub successful_ids: Vec<Uuid>,
    pub failed_ids: Vec<Uuid>,
}

/// Well-known system label identifiers.
pub mod system_labels {
    /// The UNREAD label.
    pub const UNREAD: &str = "UNREAD";
    /// The STARRED label.
    pub const STARRED: &str = "STARRED";
}
