//! The computer size catalog. Sizes are measured in units: one unit is
//! 8 GB of RAM, 4 vCPU and 100 GB of disk. Hosts count capacity in units.

use serde::{Deserialize, Serialize};

/// A size a team can buy.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum ComputerSize {
    Standard,
    Large,
    Xl,
}

impl ComputerSize {
    pub const ALL: [ComputerSize; 3] = [Self::Standard, Self::Large, Self::Xl];

    /// Host capacity this size takes while awake, and sold capacity always.
    pub fn units(self) -> u32 {
        match self {
            Self::Standard => 1,
            Self::Large => 2,
            Self::Xl => 4,
        }
    }

    pub fn memory_gb(self) -> u32 {
        self.units() * 8
    }

    pub fn vcpus(self) -> u32 {
        self.units() * 4
    }

    pub fn disk_gb(self) -> u32 {
        self.units() * 100
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::Large => "large",
            Self::Xl => "xl",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|size| size.as_str() == value)
    }
}
