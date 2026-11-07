use crate::email::service;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::FromRow;
use strum::{AsRefStr, Display, EnumString};
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
)]
#[sqlx(
    type_name = "email_message_list_visibility_enum",
    rename_all = "PascalCase"
)]
pub enum MessageListVisibility {
    Show,
    Hide,
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
)]
#[sqlx(type_name = "email_label_type_enum", rename_all = "PascalCase")]
pub enum LabelType {
    System,
    User,
}

#[derive(FromRow, Debug, Clone, Serialize, Deserialize)]
pub struct Label {
    pub id: Uuid,
    pub link_id: Uuid,
    pub provider_label_id: String,
    pub name: String,
    pub created_at: DateTime<Utc>,
    pub message_list_visibility: MessageListVisibility,
    pub label_list_visibility: LabelListVisibility,
    #[sqlx(rename = "type")]
    pub type_: LabelType,
}

impl From<service::label::Label> for Label {
    fn from(service_label: service::label::Label) -> Self {
        Self {
            id: service_label.id.unwrap_or_default(),
            link_id: service_label.link_id,
            provider_label_id: service_label.provider_label_id,
            name: service_label.name.unwrap_or_default(),
            created_at: service_label.created_at,
            message_list_visibility: match service_label.message_list_visibility {
                Some(service::label::MessageListVisibility::Show) => MessageListVisibility::Show,
                Some(service::label::MessageListVisibility::Hide) => MessageListVisibility::Hide,
                None => MessageListVisibility::Show,
            },
            label_list_visibility: match service_label.label_list_visibility {
                Some(service::label::LabelListVisibility::LabelShow) => {
                    LabelListVisibility::LabelShow
                }
                Some(service::label::LabelListVisibility::LabelShowIfUnread) => {
                    LabelListVisibility::LabelShowIfUnread
                }
                Some(service::label::LabelListVisibility::LabelHide) => {
                    LabelListVisibility::LabelHide
                }
                None => LabelListVisibility::LabelShow,
            },
            type_: match service_label.type_ {
                Some(service::label::LabelType::System) => LabelType::System,
                Some(service::label::LabelType::User) => LabelType::User,
                None => LabelType::User,
            },
        }
    }
}

#[derive(FromRow, Debug, Clone, Serialize, Deserialize)]
pub struct MessageLabel {
    pub message_id: Uuid,
    pub label_id: Uuid,
}
