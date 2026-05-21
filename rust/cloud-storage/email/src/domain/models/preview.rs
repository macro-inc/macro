use chrono::{DateTime, Utc};
use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use frecency::domain::models::AggregateFrecency;
use item_filters::ast::{LiteralTree, email::EmailLiteral};
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{Identify, Query, SimpleSortMethod, SortOn};
use serde_with::{DeserializeFromStr, SerializeDisplay};
use std::str::FromStr;
use strum::{Display, EnumString};
use uuid::Uuid;

use super::attachment::Attachment;
use super::contact::Contact;
use super::label::Label;

#[derive(Debug)]
pub struct PreviewCursorQuery {
    pub view: PreviewView,
    pub link_id: Uuid,
    pub limit: u32,
    pub query: Query<Uuid, SimpleSortMethod, LiteralTree<EmailLiteral>>,
    /// When `Some(team_id)`, the dynamic query path expands the candidate
    /// thread set from "only this `link_id`" to "every `link_id` owned by
    /// any user on this team." Populated by the service after a successful
    /// team_scope validation (see `validate_team_scope`).
    pub team_id: Option<Uuid>,
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

impl Default for PreviewView {
    fn default() -> Self {
        PreviewView::StandardLabel(PreviewViewStandardLabel::Inbox)
    }
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
    pub project_id: Option<String>,
}

#[non_exhaustive]
#[derive(Debug)]
pub struct EnrichedEmailThreadPreview {
    pub thread: EmailThreadPreview,
    pub attachments: Vec<Attachment>,
    pub labels: Vec<Label>,
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

pub struct GetEmailsRequest {
    pub view: PreviewView,
    pub link_id: Uuid,
    pub macro_id: MacroUserIdStr<'static>,
    pub limit: Option<u32>,
    pub query: Query<Uuid, SimpleSortMethod, LiteralTree<EmailLiteral>>,
    /// Proof that the caller belongs to a team, when the query contains an
    /// `EmailLiteral::TeamScope` literal. The receipt's `entity()` is the
    /// team's UUID, which the query layer can use to expand visibility to
    /// teammate mailboxes.
    pub team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
}
