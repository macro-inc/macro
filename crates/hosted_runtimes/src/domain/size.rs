//! The explicit computer size catalog. Hosts count capacity in units.

use std::borrow::Cow;

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
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "outbound", derive(sqlx::Type))]
#[cfg_attr(
    feature = "outbound",
    sqlx(type_name = "computer_size", rename_all = "snake_case")
)]
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
    /// Disk quota saved at purchase, split between the root disk and the
    /// data disk (see [`crate::domain::image::data_disk_gib`]).
    pub disk_gib: DiskGib,
}

/// vCPUs in one capacity unit.
pub const VCPUS_PER_UNIT: u32 = 4;
/// Memory in GiB in one capacity unit.
pub const MEMORY_GIB_PER_UNIT: u32 = 8;

impl ComputerResources {
    /// Compute capacity units from CPU and memory requirements.
    pub fn units(self) -> u32 {
        self.memory_gib
            .get()
            .div_ceil(MEMORY_GIB_PER_UNIT)
            .max(self.vcpus.get().div_ceil(VCPUS_PER_UNIT))
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

/// One tier as sold, every quantity written out rather than derived. The
/// root and `/home` disks and the capacity units must agree with what the
/// fleet derives from a recorded purchase ([`ComputerResources::units`],
/// [`crate::domain::image::data_disk_gib`]); the size tests check that.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SizeSpec {
    /// Versioned catalog identity recorded at purchase.
    pub id: CatalogEntryId,
    /// The tier.
    pub size: ComputerSize,
    /// Virtual CPU count.
    pub vcpus: Vcpus,
    /// Memory in GiB.
    pub memory_gib: MemoryGib,
    /// Root disk in GiB: the system, replaced by image updates.
    pub root_disk_gib: DiskGib,
    /// `/home` data disk in GiB: survives image updates.
    pub home_disk_gib: DiskGib,
    /// Host capacity units one computer of this tier holds.
    pub units: u32,
}

/// The tiers offered for new purchases; existing rows retain their snapshot.
pub const SIZE_SPECS: [SizeSpec; 3] = [
    SizeSpec {
        id: CatalogEntryId::from_static("standard@2026-11"),
        size: ComputerSize::Standard,
        vcpus: Vcpus::new(4),
        memory_gib: MemoryGib::new(8),
        root_disk_gib: DiskGib::new(32),
        home_disk_gib: DiskGib::new(68),
        units: 1,
    },
    SizeSpec {
        id: CatalogEntryId::from_static("large@2026-11"),
        size: ComputerSize::Large,
        vcpus: Vcpus::new(8),
        memory_gib: MemoryGib::new(16),
        root_disk_gib: DiskGib::new(32),
        home_disk_gib: DiskGib::new(168),
        units: 2,
    },
    SizeSpec {
        id: CatalogEntryId::from_static("xl@2026-11"),
        size: ComputerSize::Xl,
        vcpus: Vcpus::new(16),
        memory_gib: MemoryGib::new(32),
        root_disk_gib: DiskGib::new(32),
        home_disk_gib: DiskGib::new(368),
        units: 4,
    },
];

impl SizeSpec {
    /// The resources a purchase records: the disk quota is root plus `/home`.
    pub const fn resources(&self) -> ComputerResources {
        ComputerResources {
            vcpus: self.vcpus,
            memory_gib: self.memory_gib,
            disk_gib: DiskGib::new(self.root_disk_gib.get() + self.home_disk_gib.get()),
        }
    }

    /// The purchase offer for this tier.
    pub fn catalog_entry(&self) -> CatalogEntry {
        CatalogEntry {
            id: self.id.clone(),
            size: self.size,
            resources: self.resources(),
        }
    }
}

/// The catalog offered for new purchases, from [`SIZE_SPECS`].
pub fn current_catalog() -> Vec<CatalogEntry> {
    SIZE_SPECS.iter().map(SizeSpec::catalog_entry).collect()
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

/// The versioned identity recorded at purchase, `label@version`: the label
/// ASCII alphanumerics and `-`, the version those and `.`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "inbound", schema(value_type = String))]
#[serde(transparent)]
pub struct CatalogEntryId(Cow<'static, str>);
impl CatalogEntryId {
    /// Validate a versioned catalog entry identity.
    pub fn try_new(value: String) -> Result<Self, InvalidCatalogEntryId> {
        if is_catalog_entry_id(value.as_bytes()) {
            Ok(Self(Cow::Owned(value)))
        } else {
            Err(InvalidCatalogEntryId)
        }
    }
    /// A literal identity, checked when the constant using it is evaluated:
    /// an invalid literal in a `const` fails the build.
    pub const fn from_static(value: &'static str) -> Self {
        assert!(
            is_catalog_entry_id(value.as_bytes()),
            "catalog entry must be a label@version identity"
        );
        Self(Cow::Borrowed(value))
    }
    /// Borrow the validated catalog entry identity.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

/// Whether `bytes` is `label@version` with a non-empty label of ASCII
/// alphanumerics and `-` and a non-empty version of those and `.`.
const fn is_catalog_entry_id(bytes: &[u8]) -> bool {
    let mut index = 0;
    while index < bytes.len() && bytes[index] != b'@' {
        if !(bytes[index].is_ascii_alphanumeric() || bytes[index] == b'-') {
            return false;
        }
        index += 1;
    }
    if index == 0 || index + 1 >= bytes.len() {
        return false;
    }
    index += 1;
    while index < bytes.len() {
        let byte = bytes[index];
        if !(byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'.') {
            return false;
        }
        index += 1;
    }
    true
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
