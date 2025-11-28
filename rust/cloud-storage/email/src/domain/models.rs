use chrono::{DateTime, Utc};
use frecency::domain::models::{AggregateFrecency, FrecencyQueryErr};
use macro_user_id::{email::EmailStr, user_id::MacroUserIdStr};
use models_pagination::{Identify, Query, SimpleSortMethod, SortOn};
use serde_with::{DeserializeFromStr, SerializeDisplay};
use std::str::FromStr;
use strum::{Display, EnumString};
use thiserror::Error;
use uuid::Uuid;

#[cfg(test)]
mod tests;

#[derive(Debug)]
pub struct PreviewCursorQuery {
    pub view: PreviewView,
    pub link_id: Uuid,
    pub limit: u32,
    pub query: Query<Uuid, SimpleSortMethod, ()>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, EnumString, Display)]
#[strum(serialize_all = "lowercase", ascii_case_insensitive)]
pub enum PreviewViewStandardLabel {
    Inbox,
    Sent,
    Drafts,
    Starred,
    All,
    Important,
    Other,
}

#[derive(Debug, Clone, PartialEq, Eq, SerializeDisplay, DeserializeFromStr)]
pub enum PreviewView {
    StandardLabel(PreviewViewStandardLabel),
    UserLabel(String),
}

impl std::fmt::Display for PreviewView {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            PreviewView::StandardLabel(label) => write!(f, "{}", label),
            PreviewView::UserLabel(label) => write!(f, "user:{}", label),
        }
    }
}

impl FromStr for PreviewView {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match PreviewViewStandardLabel::from_str(s) {
            Ok(label) => Ok(PreviewView::StandardLabel(label)),
            Err(_) => match s.to_lowercase().as_str() {
                s if s.starts_with("user:") => Ok(PreviewView::UserLabel(s[5..].to_string())),
                _ => Err(format!("Unknown preview view: {}", s)),
            },
        }
    }
}

#[derive(Debug, Clone)]
#[non_exhaustive]
pub struct EmailThreadPreview {
    pub id: Uuid,
    pub provider_id: Option<String>,
    pub owner_id: MacroUserIdStr<'static>,
    pub inbox_visible: bool,
    pub is_read: bool,
    pub is_draft: bool,
    pub is_important: bool,
    pub name: Option<String>,
    pub snippet: Option<String>,
    pub sender_email: Option<String>,
    pub sender_name: Option<String>,
    pub sender_photo_url: Option<String>,
    pub sort_ts: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub viewed_at: Option<DateTime<Utc>>,
}

#[non_exhaustive]
#[derive(Debug)]
pub struct EnrichedEmailThreadPreview {
    pub thread: EmailThreadPreview,
    pub attachments: Vec<Attachment>,
    pub attachments_macro: Vec<AttachmentMacro>,
    pub labels: Vec<Label>,
    pub metadata: EmailThreadPreviewMetadata,
    pub frecency_score: Option<AggregateFrecency>,
    pub participants: Vec<Contact>,
}

impl Identify for EnrichedEmailThreadPreview {
    type Id = Uuid;

    fn id(&self) -> Self::Id {
        self.thread.id
    }
}

impl SortOn<SimpleSortMethod> for EnrichedEmailThreadPreview {
    fn sort_on(
        sort: SimpleSortMethod,
    ) -> impl FnMut(&Self) -> models_pagination::CursorVal<SimpleSortMethod> {
        move |v| {
            let val = match sort {
                SimpleSortMethod::ViewedAt => v.thread.viewed_at.unwrap_or_default(),
                SimpleSortMethod::UpdatedAt => v.thread.updated_at,
                SimpleSortMethod::CreatedAt => v.thread.created_at,
                SimpleSortMethod::ViewedUpdated => {
                    v.thread.viewed_at.unwrap_or(v.thread.updated_at)
                }
            };

            models_pagination::CursorVal {
                sort_type: sort,
                last_val: val,
            }
        }
    }
}

// derived metadata for the email thread that the FE uses for filtering
#[derive(Debug, Clone, Default)]
pub struct EmailThreadPreviewMetadata {
    // if user has previously emailed this sender
    pub known_sender: bool,
    // if any email contains a <table> html tag
    pub tabular: bool,
    // if any email contains a calendar invite
    pub calendar_invite: bool,
    // if the sender is a generic email
    pub generic_sender: bool,
}

#[derive(Debug, Clone)]
#[non_exhaustive]
pub struct Attachment {
    pub id: Uuid,
    pub(crate) thread_id: Uuid,
    pub message_id: Uuid,
    // a different value is returned by the gmail API for this each time you fetch a message -
    // don't make the mistake of using it to uniquely identify an attachment
    pub provider_attachment_id: Option<String>,
    pub filename: Option<String>,
    pub mime_type: Option<String>,
    pub size_bytes: Option<i64>,
    pub content_id: Option<String>,
    pub created_at: DateTime<Utc>,
}

impl Identify for Attachment {
    type Id = Uuid;

    fn id(&self) -> Self::Id {
        self.id
    }
}

/// Attachments of a message created when sending a message/draft through Macro FE. references
/// a macro item (document, canvas, etc). These don't actually get sent to the provider when
/// sending a message, but we store them so we can display the pills for the Macro objects in the FE
/// when displaying the message.
#[derive(Debug, Clone)]
#[non_exhaustive]
pub struct AttachmentMacro {
    pub thread_id: Uuid,
    pub db_id: Uuid,
    pub message_id: Uuid,
    pub item_id: Uuid,
    pub item_type: String,
}

impl Identify for AttachmentMacro {
    type Id = Uuid;

    fn id(&self) -> Self::Id {
        self.thread_id
    }
}

#[derive(Debug, Clone)]
#[non_exhaustive]
pub struct Contact {
    pub id: Uuid,
    pub(crate) thread_id: Uuid,
    pub link_id: Uuid,
    pub name: Option<String>,
    pub email_address: Option<String>,
    pub sfs_photo_url: Option<String>,
}

#[derive(Debug, Error)]
pub enum EmailErr {
    #[error(transparent)]
    RepoErr(#[from] anyhow::Error),
    #[error(transparent)]
    Frecency(#[from] FrecencyQueryErr),
}

pub struct GetEmailsRequest {
    pub view: PreviewView,
    pub link_id: Uuid,
    pub macro_id: MacroUserIdStr<'static>,
    pub limit: Option<u32>,
    pub query: Query<Uuid, SimpleSortMethod, ()>,
}

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

/// The provider of this email
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UserProvider {
    Gmail,
}

impl UserProvider {
    pub fn as_str(&self) -> &'static str {
        match self {
            UserProvider::Gmail => "GMAIL",
        }
    }
}

#[derive(Clone)]
pub struct Link {
    pub id: Uuid,
    pub macro_id: MacroUserIdStr<'static>,
    pub fusionauth_user_id: String,
    pub email_address: EmailStr<'static>,
    pub provider: UserProvider,
    pub is_sync_active: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// thread values needed to build thread preview metadata
#[derive(Debug)]
pub struct IntermediateThreadMetadata {
    pub thread_id: Uuid,
    pub has_table: bool,
    pub has_calendar_invite: bool,
    pub sender_emails: Vec<String>,
}
