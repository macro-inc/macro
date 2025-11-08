use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

/// Gmail system label IDs. These are IDs built-in to Gmail for all users.
pub enum SystemLabelID {
    Inbox,
    Spam,
    Trash,
    Unread,
    Starred,
    Important,
    Sent,
    Draft,
    CategoryPersonal,
    CategorySocial,
    CategoryPromotions,
    CategoryUpdates,
    CategoryForums,
}

impl SystemLabelID {
    pub fn is_manually_modifiable(&self) -> bool {
        match self {
            Self::Inbox => true,
            Self::Spam => true,
            Self::Trash => true,
            Self::Unread => true,
            Self::Starred => true,
            Self::Important => true,
            Self::Sent => false,
            Self::Draft => false,
            Self::CategoryPersonal => true,
            Self::CategorySocial => true,
            Self::CategoryPromotions => true,
            Self::CategoryUpdates => true,
            Self::CategoryForums => true,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Inbox => crate::email::service::label::system_labels::INBOX,
            Self::Spam => crate::email::service::label::system_labels::SPAM,
            Self::Trash => crate::email::service::label::system_labels::TRASH,
            Self::Unread => crate::email::service::label::system_labels::UNREAD,
            Self::Starred => crate::email::service::label::system_labels::STARRED,
            Self::Important => crate::email::service::label::system_labels::IMPORTANT,
            Self::Sent => crate::email::service::label::system_labels::SENT,
            Self::Draft => crate::email::service::label::system_labels::DRAFT,
            Self::CategoryPersonal => "CATEGORY_PERSONAL",
            Self::CategorySocial => "CATEGORY_SOCIAL",
            Self::CategoryPromotions => "CATEGORY_PROMOTIONS",
            Self::CategoryUpdates => "CATEGORY_UPDATES",
            Self::CategoryForums => "CATEGORY_FORUMS",
        }
    }
}

impl AsRef<str> for SystemLabelID {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl From<SystemLabelID> for String {
    fn from(label: SystemLabelID) -> Self {
        label.as_str().to_string()
    }
}

impl FromStr for SystemLabelID {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            s if s == crate::email::service::label::system_labels::INBOX => Ok(Self::Inbox),
            s if s == crate::email::service::label::system_labels::SPAM => Ok(Self::Spam),
            s if s == crate::email::service::label::system_labels::TRASH => Ok(Self::Trash),
            s if s == crate::email::service::label::system_labels::UNREAD => Ok(Self::Unread),
            s if s == crate::email::service::label::system_labels::STARRED => Ok(Self::Starred),
            s if s == crate::email::service::label::system_labels::IMPORTANT => Ok(Self::Important),
            s if s == crate::email::service::label::system_labels::SENT => Ok(Self::Sent),
            s if s == crate::email::service::label::system_labels::DRAFT => Ok(Self::Draft),
            "CATEGORY_PERSONAL" => Ok(Self::CategoryPersonal),
            "CATEGORY_SOCIAL" => Ok(Self::CategorySocial),
            "CATEGORY_PROMOTIONS" => Ok(Self::CategoryPromotions),
            "CATEGORY_UPDATES" => Ok(Self::CategoryUpdates),
            "CATEGORY_FORUMS" => Ok(Self::CategoryForums),
            _ => Err(format!("Unknown system label: {}", s)),
        }
    }
}

impl fmt::Display for SystemLabelID {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Represents the color information for a Gmail label
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GmailLabelColor {
    pub text_color: Option<String>,
    pub background_color: Option<String>,
}

/// Represents a single Gmail label as returned by the Gmail API
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GmailLabel {
    pub id: Option<String>,
    pub name: String,
    #[serde(rename = "messageListVisibility", default)]
    pub message_list_visibility: Option<String>,
    #[serde(rename = "labelListVisibility", default)]
    pub label_list_visibility: Option<String>,
    #[serde(rename = "type", default)]
    pub type_: Option<String>,
    pub color: Option<GmailLabelColor>,
}

/// Represents the top-level response from Gmail API containing a list of labels
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GmailLabelsResponse {
    pub labels: Vec<GmailLabel>,
}

impl GmailLabel {
    /// Convert a GmailLabel to a service::Label
    pub fn to_service_label(
        &self,
        link_id: uuid::Uuid,
    ) -> Result<crate::email::service::label::Label, String> {
        // Default values for optional fields
        let message_list_visibility = match self.message_list_visibility.as_deref() {
            Some(visibility) => {
                crate::email::service::label::MessageListVisibility::from_str(visibility)?
            }
            None => crate::email::service::label::MessageListVisibility::Show, // Default to Show
        };

        let label_list_visibility = match self.label_list_visibility.as_deref() {
            Some(visibility) => {
                crate::email::service::label::LabelListVisibility::from_str(visibility)?
            }
            None => crate::email::service::label::LabelListVisibility::LabelShow, // Default to LabelShow
        };

        let type_ = match self.type_.as_deref() {
            Some(type_str) => crate::email::service::label::LabelType::from_str(type_str)?,
            None => crate::email::service::label::LabelType::User, // Default to User
        };

        Ok(crate::email::service::label::Label {
            id: None, // Generated at insert
            link_id,
            provider_label_id: self.id.clone().unwrap_or_default(),
            name: Some(self.name.clone()),
            created_at: chrono::Utc::now(),
            message_list_visibility: Some(message_list_visibility),
            label_list_visibility: Some(label_list_visibility),
            type_: Some(type_),
        })
    }
}

impl GmailLabelsResponse {
    /// Convert all Gmail labels to service labels
    pub fn to_service_labels(
        &self,
        link_id: uuid::Uuid,
    ) -> Result<Vec<crate::email::service::label::Label>, String> {
        let mut service_labels = Vec::with_capacity(self.labels.len());

        for gmail_label in &self.labels {
            match gmail_label.to_service_label(link_id) {
                Ok(service_label) => service_labels.push(service_label),
                Err(e) => {
                    return Err(format!(
                        "Error converting label {}: {}",
                        gmail_label.id.clone().unwrap_or_default(),
                        e
                    ));
                }
            }
        }

        Ok(service_labels)
    }
}
