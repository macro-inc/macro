//! Compute resources for a [`SandboxSize`].
//!
//! Named-tier CPU, RAM, and disk come from [`SANDBOX_SIZES_JSON`]. Daytona
//! snapshot creates inherit [`snapshot`] until the org quota can take the
//! product default disk.

use std::sync::OnceLock;

use agent_session::domain::model::SandboxSize;
use serde::Deserialize;

#[cfg(test)]
mod test;

/// Checked-in size table. UI, justfile, and CI read the same file.
pub(crate) const SANDBOX_SIZES_JSON: &str =
    include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/sandbox_sizes.json"));

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Quota {
    cpu: u32,
    memory_gib: u32,
    disk_gib: u32,
}

#[derive(Debug, Deserialize)]
struct SizeTable {
    small: Quota,
    default: Quota,
    large: Quota,
    snapshot: Quota,
}

fn table() -> &'static SizeTable {
    static TABLE: OnceLock<SizeTable> = OnceLock::new();
    TABLE.get_or_init(|| {
        serde_json::from_str(SANDBOX_SIZES_JSON).expect("sandbox_sizes.json should parse")
    })
}

fn resources_from(quota: &Quota) -> SandboxResources {
    SandboxResources {
        cpu: quota.cpu,
        memory_gib: quota.memory_gib,
        disk_gib: quota.disk_gib,
    }
}

/// CPU, RAM, and disk for one sandbox size.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SandboxResources {
    /// vCPU cores.
    pub cpu: u32,
    /// RAM in GiB.
    pub memory_gib: u32,
    /// Disk in GiB.
    pub disk_gib: u32,
}

/// How a container manager applies a named size change.
///
/// Product sizes live in this module. Whether an existing container can take
/// that change — in place, after a stop, or not at all — is a
/// [`crate::domain::ports::ContainerManager`] capability.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SandboxResizeEffect {
    /// Already at the requested size.
    NoOp,
    /// Change compute without stopping the container.
    InPlace,
    /// Container must be stopped first. Domain closes the session, then
    /// [`crate::domain::ports::ContainerManager::resize`], then resume+attach.
    Restart,
    /// This manager cannot change size on an existing container.
    Unsupported,
}

/// Resources for `size` from [`SANDBOX_SIZES_JSON`].
#[must_use]
pub fn resources(size: SandboxSize) -> SandboxResources {
    let table = table();
    resources_from(match size {
        SandboxSize::Small => &table.small,
        SandboxSize::Default => &table.default,
        SandboxSize::Large => &table.large,
    })
}

/// Daytona snapshot bake size from [`SANDBOX_SIZES_JSON`].
#[must_use]
pub fn snapshot() -> SandboxResources {
    resources_from(&table().snapshot)
}

/// CPU/RAM comparison used by managers that can resize a live container.
///
/// Disk is ignored: Daytona resize does not send disk, so a live session keeps
/// the snapshot's disk. Spawn uses this against a snapshot's live CPU/RAM
/// because `POST /sandbox` with a snapshot cannot set resources.
#[must_use]
pub fn resize_effect(from: SandboxSize, to: SandboxSize) -> SandboxResizeEffect {
    resize_effect_from_resources(resources(from), resources(to))
}

/// Size change for managers that can only pick resources at create time.
#[must_use]
pub fn create_only_resize_effect(from: SandboxSize, to: SandboxSize) -> SandboxResizeEffect {
    if from == to {
        SandboxResizeEffect::NoOp
    } else {
        SandboxResizeEffect::Unsupported
    }
}

/// CPU/RAM comparison between two resource quotas.
///
/// Increases can apply in place. A decrease needs a stop. Equal CPU and RAM
/// is a no-op.
#[must_use]
pub fn resize_effect_from_resources(
    current: SandboxResources,
    next: SandboxResources,
) -> SandboxResizeEffect {
    if current.cpu == next.cpu && current.memory_gib == next.memory_gib {
        SandboxResizeEffect::NoOp
    } else if next.cpu >= current.cpu && next.memory_gib >= current.memory_gib {
        SandboxResizeEffect::InPlace
    } else {
        SandboxResizeEffect::Restart
    }
}
