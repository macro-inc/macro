//! Status option enum.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Type-safe enum for Status property options.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StatusOption {
    NotStarted,
    InProgress,
    InReview,
    Completed,
    Canceled,
}

impl StatusOption {
    pub const NOT_STARTED_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0002_000000000001);
    pub const IN_PROGRESS_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0002_000000000002);
    pub const IN_REVIEW_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0002_000000000003);
    pub const COMPLETED_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0002_000000000004);
    pub const CANCELED_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0002_000000000005);

    /// Get the UUID for this option.
    pub const fn uuid(&self) -> Uuid {
        match self {
            Self::NotStarted => Self::NOT_STARTED_UUID,
            Self::InProgress => Self::IN_PROGRESS_UUID,
            Self::InReview => Self::IN_REVIEW_UUID,
            Self::Completed => Self::COMPLETED_UUID,
            Self::Canceled => Self::CANCELED_UUID,
        }
    }

    /// Get the display value for this option.
    pub const fn display_value(&self) -> &'static str {
        match self {
            Self::NotStarted => "Not Started",
            Self::InProgress => "In Progress",
            Self::InReview => "In Review",
            Self::Completed => "Completed",
            Self::Canceled => "Canceled",
        }
    }

    /// Try to get a StatusOption from an option UUID.
    pub fn from_uuid(uuid: Uuid) -> Option<Self> {
        match uuid {
            u if u == Self::NOT_STARTED_UUID => Some(Self::NotStarted),
            u if u == Self::IN_PROGRESS_UUID => Some(Self::InProgress),
            u if u == Self::IN_REVIEW_UUID => Some(Self::InReview),
            u if u == Self::COMPLETED_UUID => Some(Self::Completed),
            u if u == Self::CANCELED_UUID => Some(Self::Canceled),
            _ => None,
        }
    }
}
