use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use std::collections::{HashMap, HashSet};
use strum::{AsRefStr, Display, EnumString};
use utoipa::ToSchema;
use uuid::Uuid;

// Enum for message list visibility
#[derive(
    Debug,
    Serialize,
    Deserialize,
    sqlx::Type,
    Clone,
    Copy,
    PartialEq,
    Eq,
    EnumString,
    AsRefStr,
    Display,
    ToSchema,
)]
#[sqlx(
    type_name = "email_message_list_visibility_enum",
    rename_all = "PascalCase"
)]
pub enum MessageListVisibility {
    Show,
    Hide,
}

impl MessageListVisibility {
    #[expect(
        clippy::should_implement_trait,
        reason = "FromStr impl conflicts with derive(EnumString)"
    )]
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s.to_lowercase().as_str() {
            "show" => Ok(Self::Show),
            "hide" => Ok(Self::Hide),
            _ => Err(format!("Invalid message list visibility: {}", s)),
        }
    }
}

// Enum for label list visibility
#[derive(
    Debug,
    Serialize,
    Deserialize,
    sqlx::Type,
    Clone,
    Copy,
    PartialEq,
    Eq,
    EnumString,
    AsRefStr,
    Display,
    ToSchema,
)]
#[sqlx(
    type_name = "email_label_list_visibility_enum",
    rename_all = "PascalCase"
)]
pub enum LabelListVisibility {
    LabelShow,
    LabelShowIfUnread,
    LabelHide,
}

impl LabelListVisibility {
    #[expect(
        clippy::should_implement_trait,
        reason = "FromStr impl conflicts with derive(EnumString)"
    )]
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s.to_lowercase().as_str() {
            "labelshow" | "label_show" | "label-show" => Ok(Self::LabelShow),
            "labelshowifunread" | "label_show_if_unread" | "label-show-if-unread" => {
                Ok(Self::LabelShowIfUnread)
            }
            "labelhide" | "label_hide" | "label-hide" => Ok(Self::LabelHide),
            _ => Err(format!("Invalid label list visibility: {}", s)),
        }
    }
}

// Enum for label type
#[derive(
    Debug,
    Serialize,
    Deserialize,
    sqlx::Type,
    Clone,
    Copy,
    PartialEq,
    Eq,
    EnumString,
    AsRefStr,
    Display,
    ToSchema,
)]
#[sqlx(type_name = "email_label_type_enum", rename_all = "PascalCase")]
pub enum LabelType {
    System,
    User,
}

impl LabelType {
    #[expect(
        clippy::should_implement_trait,
        reason = "FromStr impl conflicts with derive(EnumString)"
    )]
    pub fn from_str(s: &str) -> Result<Self, String> {
        match s.to_lowercase().as_str() {
            "system" => Ok(Self::System),
            "user" => Ok(Self::User),
            _ => Err(format!("Invalid label type: {}", s)),
        }
    }
}

#[derive(FromRow, Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Label {
    pub id: Option<Uuid>,
    pub link_id: Uuid,
    pub provider_label_id: String,
    pub name: Option<String>,
    pub created_at: DateTime<Utc>,
    pub message_list_visibility: Option<MessageListVisibility>,
    pub label_list_visibility: Option<LabelListVisibility>,
    #[sqlx(rename = "type")]
    pub type_: Option<LabelType>,
}

impl From<crate::email::db::label::Label> for Label {
    fn from(db_label: crate::email::db::label::Label) -> Self {
        Self {
            id: Some(db_label.id),
            link_id: db_label.link_id,
            provider_label_id: db_label.provider_label_id,
            name: Some(db_label.name),
            created_at: db_label.created_at,
            message_list_visibility: match db_label.message_list_visibility {
                crate::email::db::label::MessageListVisibility::Show => {
                    Some(MessageListVisibility::Show)
                }
                crate::email::db::label::MessageListVisibility::Hide => {
                    Some(MessageListVisibility::Hide)
                }
            },
            label_list_visibility: match db_label.label_list_visibility {
                crate::email::db::label::LabelListVisibility::LabelShow => {
                    Some(LabelListVisibility::LabelShow)
                }
                crate::email::db::label::LabelListVisibility::LabelShowIfUnread => {
                    Some(LabelListVisibility::LabelShowIfUnread)
                }
                crate::email::db::label::LabelListVisibility::LabelHide => {
                    Some(LabelListVisibility::LabelHide)
                }
            },
            type_: match db_label.type_ {
                crate::email::db::label::LabelType::System => Some(LabelType::System),
                crate::email::db::label::LabelType::User => Some(LabelType::User),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct LabelInfo {
    pub provider_id: String,
    pub name: String,
}

#[derive(FromRow, Debug, Clone, Serialize, Deserialize)]
pub struct MessageLabel {
    pub message_id: Uuid,
    pub label_id: Uuid,
}

impl From<crate::email::db::label::MessageLabel> for MessageLabel {
    fn from(db_message_label: crate::email::db::label::MessageLabel) -> Self {
        Self {
            message_id: db_message_label.message_id,
            label_id: db_message_label.label_id,
        }
    }
}

// key: message_id, value: label provider_ids
pub type LabelChanges = HashMap<String, HashSet<String>>;

// System email labels that are common across email providers
pub mod system_labels {
    pub const INBOX: &str = "INBOX";
    pub const SPAM: &str = "SPAM";
    pub const TRASH: &str = "TRASH";
    pub const UNREAD: &str = "UNREAD";
    pub const STARRED: &str = "STARRED";
    pub const IMPORTANT: &str = "IMPORTANT";
    pub const SENT: &str = "SENT";
    pub const DRAFT: &str = "DRAFT";
}
