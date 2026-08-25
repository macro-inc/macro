//! Compute resources for a [`SandboxSize`].

use agent_session::domain::model::SandboxSize;

#[cfg(test)]
mod test;

/// CPU, RAM, and disk for one sandbox size.
///
/// Disk grows with the named tier. Daytona snapshot creates inherit snapshot
/// disk; live CPU/RAM resize does not send disk.
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

/// Resources for `size`.
///
/// Small is 2 vCPU / 4 GiB / 24 GiB, default is 4 / 8 / 96, large is 8 / 16 / 128.
#[must_use]
pub fn resources(size: SandboxSize) -> SandboxResources {
    match size {
        SandboxSize::Small => SandboxResources {
            cpu: 2,
            memory_gib: 4,
            disk_gib: 24,
        },
        SandboxSize::Default => SandboxResources {
            cpu: 4,
            memory_gib: 8,
            disk_gib: 96,
        },
        SandboxSize::Large => SandboxResources {
            cpu: 8,
            memory_gib: 16,
            disk_gib: 128,
        },
    }
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
