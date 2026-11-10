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
    /// Standard resource tier.
    Standard,
    /// Large resource tier.
    Large,
    /// Extra-large resource tier.
    Xl,
}

impl ComputerSize {
    /// The name people see, as Settings shows it.
    pub fn label(self) -> &'static str {
        match self {
            Self::Standard => "Standard",
            Self::Large => "Large",
            Self::Xl => "XL",
        }
    }
}

/// Immutable resources sold with a computer. One unit is 8 GiB or 4 vCPUs,
/// whichever requires more units, rounding each resource up.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ComputerResources {
    /// Virtual CPU count.
    pub vcpus: Vcpus,
    /// Memory limit saved at purchase.
    pub memory_gib: MemoryGib,
    /// Root disk limit saved at purchase.
    pub disk_gib: DiskGib,
}

impl ComputerResources {
    /// Compute capacity units from CPU and memory requirements.
    pub fn units(self) -> u32 {
        self.memory_gib
            .get()
            .div_ceil(8)
            .max(self.vcpus.get().div_ceil(4))
    }
}

/// A versioned purchase offer. Labels never determine a purchased VM's limits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogEntry {
    /// Stable resource identity.
    pub id: CatalogEntryId,
    /// Purchased catalog size.
    pub size: ComputerSize,
    /// Resource limits saved at purchase.
    pub resources: ComputerResources,
}

/// The catalog offered for new purchases; existing rows retain their snapshot.
pub fn current_catalog() -> Vec<CatalogEntry> {
    vec![
        CatalogEntry {
            id: CatalogEntryId("standard@2026-11".to_owned()),
            size: ComputerSize::Standard,
            resources: ComputerResources {
                vcpus: Vcpus::new(4),
                memory_gib: MemoryGib::new(8),
                disk_gib: DiskGib::new(100),
            },
        },
        CatalogEntry {
            id: CatalogEntryId("large@2026-11".to_owned()),
            size: ComputerSize::Large,
            resources: ComputerResources {
                vcpus: Vcpus::new(8),
                memory_gib: MemoryGib::new(16),
                disk_gib: DiskGib::new(200),
            },
        },
        CatalogEntry {
            id: CatalogEntryId("xl@2026-11".to_owned()),
            size: ComputerSize::Xl,
            resources: ComputerResources {
                vcpus: Vcpus::new(16),
                memory_gib: MemoryGib::new(32),
                disk_gib: DiskGib::new(400),
            },
        },
    ]
}

impl ComputerSize {
    /// All supported computer sizes in catalog order.
    pub const ALL: [ComputerSize; 3] = [Self::Standard, Self::Large, Self::Xl];
}

#[cfg(test)]
mod test;

/// A recorded resource quantity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(transparent)]
pub struct Vcpus(u32);
impl Vcpus {
    /// Wrap a resource count.
    pub const fn new(value: u32) -> Self {
        Self(value)
    }
    /// Return the resource count.
    pub const fn get(self) -> u32 {
        self.0
    }
}

/// A recorded resource quantity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(transparent)]
pub struct MemoryGib(u32);
impl MemoryGib {
    /// Wrap a resource count.
    pub const fn new(value: u32) -> Self {
        Self(value)
    }
    /// Return the resource count.
    pub const fn get(self) -> u32 {
        self.0
    }
}

/// A recorded resource quantity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(transparent)]
pub struct DiskGib(u32);
impl DiskGib {
    /// Wrap a resource count.
    pub const fn new(value: u32) -> Self {
        Self(value)
    }
    /// Return the resource count.
    pub const fn get(self) -> u32 {
        self.0
    }
}

/// The versioned identity recorded at purchase.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(transparent)]
pub struct CatalogEntryId(String);
impl CatalogEntryId {
    /// Validate a versioned catalog entry identity.
    pub fn try_new(value: String) -> Result<Self, InvalidCatalogEntryId> {
        let Some((label, version)) = value.split_once('@') else {
            return Err(InvalidCatalogEntryId);
        };
        if label.is_empty()
            || version.is_empty()
            || !label
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-')
            || !version
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.'))
        {
            return Err(InvalidCatalogEntryId);
        }
        Ok(Self(value))
    }
    /// Borrow the validated catalog entry identity.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// A catalog identity must include a label and version separated by `@`.
#[derive(Debug, thiserror::Error)]
#[error("catalog entry must be a label@version identity")]
pub struct InvalidCatalogEntryId;

impl<'de> Deserialize<'de> for CatalogEntryId {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::try_new(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}
