//! The explicit computer size catalog. Hosts count capacity in units.

use serde::{Deserialize, Serialize};

/// A size a team can buy.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    strum::AsRefStr,
    strum::EnumString,
    strum::EnumIter,
)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum ComputerSize {
    Standard,
    Large,
    Xl,
}

/// Resources and fleet limits pinned independently for each computer size.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ComputerSpec {
    pub units: u32,
    pub vcpus: u32,
    pub memory_gb: u32,
    pub disk_gb: u32,
    pub incus_cpu: &'static str,
    pub incus_memory: &'static str,
    pub incus_root_size: &'static str,
    pub incus_state_size: &'static str,
}

impl ComputerSize {
    pub const ALL: [ComputerSize; 3] = [Self::Standard, Self::Large, Self::Xl];

    pub const fn spec(self) -> ComputerSpec {
        match self {
            Self::Standard => ComputerSpec {
                units: 1,
                vcpus: 4,
                memory_gb: 8,
                disk_gb: 100,
                incus_cpu: "4",
                incus_memory: "8GiB",
                incus_root_size: "100GiB",
                incus_state_size: "9GiB",
            },
            Self::Large => ComputerSpec {
                units: 2,
                vcpus: 8,
                memory_gb: 16,
                disk_gb: 200,
                incus_cpu: "8",
                incus_memory: "16GiB",
                incus_root_size: "200GiB",
                incus_state_size: "17GiB",
            },
            Self::Xl => ComputerSpec {
                units: 4,
                vcpus: 16,
                memory_gb: 32,
                disk_gb: 400,
                incus_cpu: "16",
                incus_memory: "32GiB",
                incus_root_size: "400GiB",
                incus_state_size: "33GiB",
            },
        }
    }

    /// Host capacity this size takes while awake, and sold capacity always.
    pub fn units(self) -> u32 {
        self.spec().units
    }

    pub fn memory_gb(self) -> u32 {
        self.spec().memory_gb
    }

    pub fn vcpus(self) -> u32 {
        self.spec().vcpus
    }

    pub fn disk_gb(self) -> u32 {
        self.spec().disk_gb
    }
}

#[cfg(test)]
mod test;
