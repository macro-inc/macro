//! Priority option enum.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Type-safe enum for Priority property options.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PriorityOption {
    Low,
    Medium,
    High,
    Urgent,
}

impl PriorityOption {
    pub const LOW_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0003_000000000001);
    pub const MEDIUM_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0003_000000000002);
    pub const HIGH_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0003_000000000003);
    pub const URGENT_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0003_000000000004);

    /// Get the UUID for this option.
    pub const fn uuid(&self) -> Uuid {
        match self {
            Self::Low => Self::LOW_UUID,
            Self::Medium => Self::MEDIUM_UUID,
            Self::High => Self::HIGH_UUID,
            Self::Urgent => Self::URGENT_UUID,
        }
    }

    /// Get the display value for this option.
    pub const fn display_value(&self) -> &'static str {
        match self {
            Self::Low => "Low",
            Self::Medium => "Medium",
            Self::High => "High",
            Self::Urgent => "Urgent",
        }
    }

    /// Try to get a PriorityOption from an option UUID.
    pub fn from_uuid(uuid: Uuid) -> Option<Self> {
        match uuid {
            u if u == Self::LOW_UUID => Some(Self::Low),
            u if u == Self::MEDIUM_UUID => Some(Self::Medium),
            u if u == Self::HIGH_UUID => Some(Self::High),
            u if u == Self::URGENT_UUID => Some(Self::Urgent),
            _ => None,
        }
    }
}
