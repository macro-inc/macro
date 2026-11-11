//! Domain models for the platform status.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Longest accepted status message, in characters.
pub const MAX_MESSAGE_LENGTH: usize = 500;

/// Errors returned by the system status service.
#[derive(Debug, thiserror::Error)]
pub enum SystemStatusError {
    /// The caller is not Macro staff.
    #[error("only Macro staff can manage the system status")]
    Forbidden,
    /// An internal error occurred.
    #[error("internal error")]
    Internal(rootcause::Report),
}

impl From<rootcause::Report> for SystemStatusError {
    fn from(report: rootcause::Report) -> Self {
        Self::Internal(report)
    }
}

/// Why a status message was rejected.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum InvalidStatusMessage {
    /// The message is empty once trimmed.
    #[error("message must not be empty")]
    Empty,
    /// The message is longer than [`MAX_MESSAGE_LENGTH`].
    #[error("message must be at most {MAX_MESSAGE_LENGTH} characters")]
    TooLong,
}

/// The text shown in the banner: trimmed, non-empty, and at most
/// [`MAX_MESSAGE_LENGTH`] characters.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct StatusMessage(String);

impl StatusMessage {
    /// The message as a string slice.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for StatusMessage {
    type Error = InvalidStatusMessage;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        let trimmed = value.trim();
        if trimmed.is_empty() {
            return Err(InvalidStatusMessage::Empty);
        }
        if trimmed.chars().count() > MAX_MESSAGE_LENGTH {
            return Err(InvalidStatusMessage::TooLong);
        }
        Ok(Self(trimmed.to_owned()))
    }
}

impl From<StatusMessage> for String {
    fn from(value: StatusMessage) -> Self {
        value.0
    }
}

/// The platform status. Only the non-operational statuses carry a message.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum SystemStatus {
    /// Everything works; no banner is shown.
    Operational,
    /// Some features are slow or failing.
    Degraded {
        /// What users should know.
        #[cfg_attr(feature = "inbound", schema(value_type = String))]
        message: StatusMessage,
    },
    /// Macro is largely unavailable.
    MajorOutage {
        /// What users should know.
        #[cfg_attr(feature = "inbound", schema(value_type = String))]
        message: StatusMessage,
    },
}

impl SystemStatus {
    /// The banner message, absent when operational.
    pub fn message(&self) -> Option<&StatusMessage> {
        match self {
            Self::Operational => None,
            Self::Degraded { message } | Self::MajorOutage { message } => Some(message),
        }
    }
}

/// One status a staff member set. The newest is the current status.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct StatusUpdate {
    /// UUIDv7, so ids sort by creation.
    pub id: Uuid,
    /// The status that was set.
    #[serde(flatten)]
    pub status: SystemStatus,
    /// The staff member who set it.
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub user_id: MacroUserIdStr<'static>,
    /// When it was set.
    pub created_at: DateTime<Utc>,
}

/// The status every user sees, without who set it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CurrentSystemStatus {
    /// The status and its message.
    #[serde(flatten)]
    pub status: SystemStatus,
    /// The id of the update that set it; absent when no status was ever set.
    /// Clients remember dismissed banners by this id.
    pub id: Option<Uuid>,
    /// When it was set; absent when no status was ever set. Clients keep the
    /// newest status they have seen, whether fetched or pushed.
    pub updated_at: Option<DateTime<Utc>>,
}

impl From<Option<StatusUpdate>> for CurrentSystemStatus {
    fn from(update: Option<StatusUpdate>) -> Self {
        match update {
            Some(update) => Self {
                status: update.status,
                id: Some(update.id),
                updated_at: Some(update.created_at),
            },
            None => Self {
                status: SystemStatus::Operational,
                id: None,
                updated_at: None,
            },
        }
    }
}
