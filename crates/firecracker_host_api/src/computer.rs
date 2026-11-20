//! Computers: one Firecracker microVM each.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::{
    ComputerId, ComputerRole, ControlPlaneId, EnrollmentGeneration, GuestImage, PairingId,
};

/// What the computer was sold, enforced by the agent: vCPUs and memory by
/// the golden's shape and the VM's cgroup, disks by their files' sizes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct ComputerResources {
    /// Virtual CPUs.
    pub vcpus: u8,
    /// Guest memory in MiB.
    pub memory_mib: u32,
    /// Size of the root disk in GiB; at least the image's rootfs. The guest
    /// grows its filesystem to it.
    pub root_disk_gib: u32,
    /// Size of the `/home` volume in GiB. Grown, never shrunk.
    pub home_disk_gib: u32,
}

/// The one-time `Enrollment` JSON (`hosted_runtimes::domain::enrollment`)
/// served to the guest at [`crate::mmds::ENROLLMENT_POINTER`]. Opaque to
/// the agent by design: it never reads or validates it, only keeps it in
/// the computer's record and serves it, so its shape belongs to the control
/// plane and the guest alone. It carries a device secret: never logged, and
/// dropped from MMDS once macrod has used it.
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema), schema(value_type = Object))]
#[serde(transparent)]
pub struct EnrollmentDocument(pub serde_json::Value);

impl std::fmt::Debug for EnrollmentDocument {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("EnrollmentDocument(<redacted>)")
    }
}

/// `PUT /v1/computers/{computer_id}`.
///
/// - Absent: restore a new VM from the golden of `image` and `resources`,
///   reusing a `/home` volume a lost VM left behind, then leave it
///   `running` or, when `start` is false, `stopped`.
/// - Present with the same `controlPlaneId` and `generation`: answer it as
///   it is; the enrollment and power state are not touched (call
///   `PUT /v1/computers/{computer_id}/enrollment` and the power actions for that).
/// - Present otherwise: [`crate::ErrorCode::GenerationMismatch`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CreateComputer {
    /// Owner identity shared by control-plane replicas.
    pub control_plane_id: ControlPlaneId,
    /// Enrollment generation this guest is created for.
    pub generation: EnrollmentGeneration,
    /// The pairing `enrollment` claims.
    pub pairing_id: PairingId,
    /// Image name, e.g. `macro-box/2026-11-17`.
    pub image: GuestImage,
    /// Whom the computer is for, served in MMDS at `macro.identity.role`.
    pub role: ComputerRole,
    /// Sold limits.
    pub resources: ComputerResources,
    /// Served in MMDS before the guest first runs.
    pub enrollment: EnrollmentDocument,
    /// Whether to leave the new VM running.
    pub start: bool,
    /// Answer as soon as the VM runs and its guest agent answers, before
    /// `macro-restore` (identity, `/home`, macrod) finished; poll
    /// [`Computer::restore_pending`]. A purchase leaves this false.
    #[serde(default)]
    pub return_when_resumed: bool,
}

/// `PUT /v1/computers/{computer_id}/enrollment`: a fresh enrollment for a guest whose
/// pairing was never claimed. The agent records `pairing_id`, serves the
/// document, and restarts the guest's enrollment when it is running.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SetEnrollment {
    /// Must equal the computer's; otherwise
    /// [`crate::ErrorCode::GenerationMismatch`].
    pub generation: EnrollmentGeneration,
    /// The pairing `enrollment` claims.
    pub pairing_id: PairingId,
    /// The new document.
    pub enrollment: EnrollmentDocument,
}

/// Where a VM's power stands.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, strum::Display, strum::AsRefStr,
)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
#[strum(serialize_all = "camelCase")]
pub enum PowerState {
    /// The VM runs.
    Running,
    /// vCPUs paused, memory in RAM.
    Paused,
    /// Memory and device state on disk, no process.
    Hibernated,
    /// Shut down; only the disks remain.
    Stopped,
}

/// A power action: `POST /v1/computers/{computer_id}/{action}`.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    strum::Display,
    strum::IntoStaticStr,
    strum::EnumString,
)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum Action {
    /// Start: a stopped guest cold boots, a hibernated one is restored, a paused one resumes.
    Start,
    /// Clean shutdown, killed after the grace period.
    Stop,
    /// Stop, then start.
    Restart,
    /// Pause the vCPUs, memory kept in RAM.
    Freeze,
    /// Resume a frozen guest.
    Unfreeze,
    /// Snapshot memory and devices to disk and end the process.
    Hibernate,
}

/// What a VM uses right now, read from its cgroup. Absent unless it has a
/// process (`running` or `paused`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    /// Resident memory charged to the VM (cgroup `memory.current`), including
    /// its share of the golden's page cache it faulted in.
    pub resident_memory_bytes: u64,
    /// Memory only this VM holds: anonymous pages it wrote (cgroup
    /// `memory.stat` `anon`).
    pub private_memory_bytes: u64,
    /// Memory of this VM the host moved to swap (cgroup
    /// `memory.swap.current`): the zram squeeze of an idle computer lands
    /// here, so `private_memory_bytes` plus this is what the VM holds.
    /// Absent from an agent older than the field: unknown, not zero.
    #[serde(default)]
    pub swap_bytes: Option<u64>,
    /// CPU time used since the process started (cgroup `cpu.stat`
    /// `usage_usec`); two readings give its recent activity.
    pub cpu_usage_microseconds: u64,
}

/// A computer as the agent holds it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct Computer {
    /// Computer this VM runs.
    pub computer_id: ComputerId,
    /// Owner identity from the create.
    pub control_plane_id: ControlPlaneId,
    /// Enrollment generation from the create.
    pub generation: EnrollmentGeneration,
    /// The pairing the current enrollment claims.
    pub pairing_id: PairingId,
    /// Image the VM was created from.
    pub image: GuestImage,
    /// Whom the computer is for.
    pub role: ComputerRole,
    /// Enforced limits.
    pub resources: ComputerResources,
    /// Power state.
    pub state: PowerState,
    /// Whether MMDS still serves an enrollment.
    pub enrollment_present: bool,
    /// When the agent created the VM.
    pub created_at: DateTime<Utc>,
    /// Current usage, when the VM has a process.
    pub usage: Option<Usage>,
    /// Whether the guest has yet to finish `macro-restore` after its last
    /// restore or wake.
    pub restore_pending: bool,
    /// Where the time of the last boot, restore or wake went.
    pub last_launch: Option<LaunchTimings>,
}

/// What the last launch started from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub enum LaunchSource {
    /// The golden snapshot (a purchase).
    Golden,
    /// The computer's hibernation snapshot.
    Hibernation,
    /// A cold boot of its own rootfs.
    ColdBoot,
}

/// The storage a host keeps computers' disks on.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, strum::Display, strum::IntoStaticStr,
)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
#[strum(serialize_all = "camelCase")]
pub enum DiskBackend {
    /// Reflinked files on XFS.
    XfsReflink,
    /// ZFS datasets cloned from the golden's snapshot.
    ZfsDatasetClone,
}

/// Phases of one launch, in milliseconds. A phase that did not run is
/// absent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct LaunchTimings {
    /// What it started from.
    pub source: LaunchSource,
    /// The disk storage.
    pub disk_backend: DiskBackend,
    /// Clone or reuse and size the rootfs and `/home`.
    pub disks_ms: u64,
    /// Waiting for a launch turn (bounded concurrency).
    pub queue_ms: u64,
    /// Chroot, drive placement, snapshot links.
    pub jail_ms: u64,
    /// Jailer until Firecracker's API answers.
    pub jailer_ms: u64,
    /// `snapshot/load`.
    pub snapshot_load_ms: Option<u64>,
    /// `PATCH` both drives.
    pub drives_patch_ms: Option<u64>,
    /// `PUT /mmds`.
    pub mmds_ms: Option<u64>,
    /// Resume (or InstanceStart for a cold boot).
    pub resume_ms: u64,
    /// Until the guest agent accepted a connection.
    pub guest_agent_ms: Option<u64>,
    /// `macro-restore`, all attempts.
    pub macro_restore_ms: Option<u64>,
    /// Starts of `macro-restore`.
    pub macro_restore_attempts: Option<u8>,
    /// The whole launch, request to answer; for a create, the whole
    /// handler. The phases above plus `otherMs` add up to it.
    pub total_ms: u64,
    /// A create's wait for the computer's lock (another request on it).
    pub lock_wait_ms: Option<u64>,
    /// A create's disk preparation before its boot (clone, `/home`).
    pub create_disks_ms: Option<u64>,
    /// A create's record writes before its boot.
    pub create_record_ms: Option<u64>,
    /// What no phase above covers: record writes during the boot,
    /// bookkeeping, scheduling.
    pub other_ms: Option<u64>,
}

#[cfg(test)]
mod test;
