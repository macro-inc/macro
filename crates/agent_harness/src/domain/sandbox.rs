//! Compute resources for a [`SandboxSize`].

use agent_session::domain::model::SandboxSize;

#[cfg(test)]
mod test;

/// CPU, RAM, and disk for one sandbox size.
///
/// Disk is 96 GiB for every tier so a live session can hot-resize CPU/RAM
/// without a disk migrate. Daytona cannot shrink disk, and growing it requires
/// a stop.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SandboxResources {
    /// vCPU cores.
    pub cpu: u32,
    /// RAM in GiB.
    pub memory_gib: u32,
    /// Disk in GiB. Constant across tiers.
    pub disk_gib: u32,
}

/// How a size change has to be applied to a live Daytona sandbox.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SandboxResizeKind {
    /// No resource change.
    NoOp,
    /// CPU and RAM only increase (or stay). Safe on a running sandbox.
    Hot,
    /// CPU or RAM decreases. Daytona requires the sandbox to be stopped.
    Cold,
}

/// Resources for `size`. Disk is always 96 GiB.
#[must_use]
pub fn resources(size: SandboxSize) -> SandboxResources {
    match size {
        SandboxSize::Small => SandboxResources {
            cpu: 2,
            memory_gib: 4,
            disk_gib: 96,
        },
        SandboxSize::Default => SandboxResources {
            cpu: 8,
            memory_gib: 16,
            disk_gib: 96,
        },
        SandboxSize::Large => SandboxResources {
            cpu: 16,
            memory_gib: 32,
            disk_gib: 96,
        },
    }
}

/// How to move a sandbox from `from` to `to`.
#[must_use]
pub fn resize_kind(from: SandboxSize, to: SandboxSize) -> SandboxResizeKind {
    resize_kind_from_resources(resources(from), resources(to))
}

/// How to move a sandbox between two resource quotas.
///
/// Disk is ignored: named tiers never change disk, and Daytona cannot shrink
/// it. Spawn uses this against the snapshot's live CPU/RAM because
/// `POST /sandbox` with a snapshot cannot set resources.
#[must_use]
pub fn resize_kind_from_resources(
    current: SandboxResources,
    next: SandboxResources,
) -> SandboxResizeKind {
    if current.cpu == next.cpu && current.memory_gib == next.memory_gib {
        SandboxResizeKind::NoOp
    } else if next.cpu >= current.cpu && next.memory_gib >= current.memory_gib {
        SandboxResizeKind::Hot
    } else {
        SandboxResizeKind::Cold
    }
}
