//! The host: capacity, measured memory, and the goldens it restores from.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::GuestImage;

/// A golden snapshot's identity. A snapshot fixes vCPUs and memory, so each
/// sold shape of each image has its own golden.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct GoldenKey {
    /// Image name, e.g. `macro-box/2026-11-17`.
    pub image: GuestImage,
    /// Virtual CPUs.
    pub vcpus: u8,
    /// Guest memory in MiB.
    pub memory_mib: u32,
}

/// Where a golden's build stands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    tag = "kind"
)]
pub enum GoldenState {
    /// Booting the image, waiting for it to settle, or saving the snapshot.
    Building,
    /// Restorable.
    Ready {
        /// When the snapshot was saved.
        created_at: DateTime<Utc>,
    },
    /// The last build failed; `POST` `/v1/goldens` again to retry.
    Failed {
        /// Why, for logs.
        message: String,
    },
}

/// One golden on the host.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct GoldenImage {
    /// Image and shape.
    pub key: GoldenKey,
    /// Build state.
    pub state: GoldenState,
}

/// The pre-created network namespaces VMs run in, one per VM.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct NetworkSlots {
    /// Slots on the host.
    pub total: u32,
    /// Slots no VM holds.
    pub free: u32,
}

/// `GET /v1/host`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    /// Host name, for registration.
    pub name: String,
    /// The Firecracker release the agent runs, e.g. `v1.18.0`.
    pub firecracker_version: String,
    /// The agent's build (its source commit), when the build recorded one.
    pub agent_version: Option<String>,
    /// The memory limits the control plane set, if any.
    pub limits: Option<HostLimits>,
    /// Logical CPUs on the host.
    pub cpus: u32,
    /// Host memory (`MemTotal`).
    pub memory_total_bytes: u64,
    /// Memory the kernel could hand out now (`MemAvailable`).
    pub memory_available_bytes: u64,
    /// Memory charged to every VM's cgroup together (`memory.current` of the
    /// VMs' parent cgroup): what admission and the watermarks compare.
    pub guest_resident_memory_bytes: u64,
    /// Memory KSM currently deduplicates (`pages_sharing` × page size).
    pub ksm_shared_bytes: u64,
    /// Network slots.
    pub network_slots: NetworkSlots,
    /// Images installed on the host, by name, whether or not a golden exists.
    pub images: Vec<GuestImage>,
    /// Every golden on the host.
    pub goldens: Vec<GoldenImage>,
    /// Where other hosts push computers moving here (its move
    /// listener, `address:port` on the private host mesh); absent when the
    /// host does not receive computers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub move_address: Option<String>,
}

/// `PUT /v1/host/limits`: the host's memory policy, set by the control
/// plane; the agent keeps it across restarts. The squeeze bounds compare
/// against the host's resident memory (`MemTotal - MemAvailable`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct HostLimits {
    /// `memory.max` of all VMs together: the hard ceiling.
    pub guest_memory_max_bytes: u64,
    /// Low end of the squeeze window (the control plane's low watermark):
    /// from here up, idle computers' memory is squeezed into zram.
    pub squeeze_above_bytes: Option<u64>,
    /// High end of the squeeze window (its high watermark): beyond it the
    /// control plane hibernates instead.
    pub squeeze_below_bytes: Option<u64>,
    /// The `/home` sizes the control plane sells, in GiB: the agent makes
    /// their empty filesystems and ready disk sets ahead, so no create
    /// pays for them, and is not ready until they exist.
    pub home_disk_gib: Vec<u32>,
}

impl HostLimits {
    /// Limits whose squeeze window, when both ends are given, is not upside
    /// down.
    pub fn new(
        guest_memory_max_bytes: u64,
        squeeze_above_bytes: Option<u64>,
        squeeze_below_bytes: Option<u64>,
        home_disk_gib: Vec<u32>,
    ) -> Result<Self, InvalidHostLimits> {
        if let (Some(above), Some(below)) = (squeeze_above_bytes, squeeze_below_bytes)
            && above > below
        {
            return Err(InvalidHostLimits::SqueezeWindowInverted { above, below });
        }
        if home_disk_gib.contains(&0) {
            return Err(InvalidHostLimits::EmptyHome);
        }
        Ok(Self {
            guest_memory_max_bytes,
            squeeze_above_bytes,
            squeeze_below_bytes,
            home_disk_gib,
        })
    }
}

/// Why [`HostLimits::new`] refused.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum InvalidHostLimits {
    /// A `/home` size of 0 GiB.
    #[error("homeDiskGib sizes must be at least 1")]
    EmptyHome,
    /// The window's low end is above its high end.
    #[error("squeezeAboveBytes {above} exceeds squeezeBelowBytes {below}")]
    SqueezeWindowInverted {
        /// Low end.
        above: u64,
        /// High end.
        below: u64,
    },
}
