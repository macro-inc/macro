//! Effort option enum.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Type-safe enum for Effort property options.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EffortOption {
    Small,
    Medium,
    Large,
}

impl EffortOption {
    pub const SMALL_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0008_000000000001);
    pub const MEDIUM_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0008_000000000002);
    pub const LARGE_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0008_000000000003);

    /// Get the UUID for this option.
    pub const fn uuid(&self) -> Uuid {
        match self {
            Self::Small => Self::SMALL_UUID,
            Self::Medium => Self::MEDIUM_UUID,
            Self::Large => Self::LARGE_UUID,
        }
    }

    /// Get the display value for this option.
    pub const fn display_value(&self) -> &'static str {
        match self {
            Self::Small => "Small",
            Self::Medium => "Medium",
            Self::Large => "Large",
        }
    }

    /// Try to get an EffortOption from an option UUID.
    pub fn from_uuid(uuid: Uuid) -> Option<Self> {
        match uuid {
            u if u == Self::SMALL_UUID => Some(Self::Small),
            u if u == Self::MEDIUM_UUID => Some(Self::Medium),
            u if u == Self::LARGE_UUID => Some(Self::Large),
            _ => None,
        }
    }
}
