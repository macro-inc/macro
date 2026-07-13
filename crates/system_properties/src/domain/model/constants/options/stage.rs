//! CRM stage option enum.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Type-safe enum for the CRM Stage property options.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StageOption {
    Lead,
    Qualified,
    Demo,
    Trial,
    Negotiation,
    Customer,
    Churned,
}

impl TryFrom<&str> for StageOption {
    type Error = String;

    fn try_from(s: &str) -> Result<Self, Self::Error> {
        match s {
            "Lead" | "lead" => Ok(Self::Lead),
            "Qualified" | "qualified" => Ok(Self::Qualified),
            "Demo" | "demo" => Ok(Self::Demo),
            "Trial" | "trial" => Ok(Self::Trial),
            "Negotiation" | "negotiation" => Ok(Self::Negotiation),
            "Customer" | "customer" => Ok(Self::Customer),
            "Churned" | "churned" => Ok(Self::Churned),
            _ => Err(format!("unknown stage option: {s}")),
        }
    }
}

impl StageOption {
    pub const LEAD_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0010_000000000001);
    pub const QUALIFIED_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0010_000000000002);
    pub const DEMO_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0010_000000000003);
    pub const TRIAL_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0010_000000000004);
    pub const NEGOTIATION_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0010_000000000005);
    pub const CUSTOMER_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0010_000000000006);
    pub const CHURNED_UUID: Uuid = Uuid::from_u128(0x00000001_0000_0000_0010_000000000007);

    /// Get the UUID for this option.
    pub const fn uuid(&self) -> Uuid {
        match self {
            Self::Lead => Self::LEAD_UUID,
            Self::Qualified => Self::QUALIFIED_UUID,
            Self::Demo => Self::DEMO_UUID,
            Self::Trial => Self::TRIAL_UUID,
            Self::Negotiation => Self::NEGOTIATION_UUID,
            Self::Customer => Self::CUSTOMER_UUID,
            Self::Churned => Self::CHURNED_UUID,
        }
    }

    /// Get the display value for this option.
    pub const fn display_value(&self) -> &'static str {
        match self {
            Self::Lead => "Lead",
            Self::Qualified => "Qualified",
            Self::Demo => "Demo",
            Self::Trial => "Trial",
            Self::Negotiation => "Negotiation",
            Self::Customer => "Customer",
            Self::Churned => "Churned",
        }
    }

    /// Try to get a StageOption from an option UUID.
    pub fn from_uuid(uuid: Uuid) -> Option<Self> {
        match uuid {
            u if u == Self::LEAD_UUID => Some(Self::Lead),
            u if u == Self::QUALIFIED_UUID => Some(Self::Qualified),
            u if u == Self::DEMO_UUID => Some(Self::Demo),
            u if u == Self::TRIAL_UUID => Some(Self::Trial),
            u if u == Self::NEGOTIATION_UUID => Some(Self::Negotiation),
            u if u == Self::CUSTOMER_UUID => Some(Self::Customer),
            u if u == Self::CHURNED_UUID => Some(Self::Churned),
            _ => None,
        }
    }
}
