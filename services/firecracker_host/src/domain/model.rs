//! What the agent keeps about each computer, persisted on the durable disk
//! so the agent restarts (or the host reboots) without losing a computer.

use chrono::{DateTime, Utc};
use firecracker_host_api::{
    Computer, ComputerId, ComputerResources, ComputerRole, ControlPlaneId, CreateComputer,
    EnrollmentDocument, EnrollmentGeneration, GoldenKey, GuestImage, LaunchTimings, PairingId,
    PowerState, Usage,
};
use serde::{Deserialize, Serialize};

/// A network slot: one pre-created netns with its tap, veth and firewall,
/// and the VM user id derived from it. A slot is held by at most one process.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct Slot(pub u16);

/// A Firecracker process the agent started for a computer.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Process {
    /// The netns and uid it runs in.
    pub slot: Slot,
    /// Its pid in the host's pid namespace.
    pub pid: i32,
}

/// Which of a computer's system disk files the VM boots: generation 0 is
/// the rootfs its create cloned, each [`ReplaceSystemDisk`] clone takes the
/// next generation. The record naming one is what puts it in place, so a
/// swap or a rollback is one record save.
///
/// [`ReplaceSystemDisk`]: firecracker_host_api::ReplaceSystemDisk
#[derive(
    Debug, Clone, Copy, Default, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize,
)]
#[serde(transparent)]
pub struct SystemDisk(pub u32);

/// The system disk a computer booted before its current one, kept for a
/// rollback.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PreviousSystemDisk {
    /// Its file.
    pub disk: SystemDisk,
    /// The image it was cloned from.
    pub image: GuestImage,
}

/// One computer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ComputerRecord {
    /// Computer this VM runs.
    pub computer_id: ComputerId,
    /// Owner identity from the create.
    pub control_plane_id: ControlPlaneId,
    /// Enrollment generation from the create.
    pub generation: EnrollmentGeneration,
    /// The pairing the current enrollment claims.
    pub pairing_id: PairingId,
    /// Image of the system disk the VM boots: the one it was created from
    /// until a system disk replacement.
    pub image: GuestImage,
    /// The system disk the VM boots.
    #[serde(default)]
    pub system_disk: SystemDisk,
    /// The one it booted before, kept for a rollback.
    #[serde(default)]
    pub previous_system_disk: Option<PreviousSystemDisk>,
    /// Whom the computer is for.
    pub role: ComputerRole,
    /// Enforced limits.
    pub resources: ComputerResources,
    /// Served in MMDS until cleared. Kept here (root-only file) so a guest
    /// cold booted after a host stop can still enroll.
    pub enrollment: Option<EnrollmentDocument>,
    /// Settled power state.
    pub state: PowerState,
    /// The running process; `Some` exactly when `state` is running or paused.
    pub process: Option<Process>,
    /// Whether the rootfs is still the golden's untouched copy, so the first
    /// boot can restore the golden instead of cold booting.
    pub rootfs_never_booted: bool,
    /// Whether a restored guest has yet to run `macro-restore` (identity,
    /// clock, `/home`) successfully. A restore gives the guest no signal of
    /// its own, so the agent starts it; until it succeeds, a repeated create
    /// or start tries again.
    #[serde(default)]
    pub guest_restore_pending: bool,
    /// Whether the create asked to start the computer and no boot has
    /// succeeded since, so a repeated create boots it.
    #[serde(default)]
    pub start_pending: bool,
    /// Whether a hibernation began and was not settled: after a crash, a
    /// published snapshot finishes it; without one the VM stays as it was.
    #[serde(default)]
    pub hibernating: bool,
    /// Where the last launch's time went.
    #[serde(default)]
    pub last_launch: Option<LaunchTimings>,
    /// When the agent created the computer.
    pub created_at: DateTime<Utc>,
}

impl ComputerRecord {
    /// A new, stopped computer for `request`.
    pub fn new(computer_id: ComputerId, request: &CreateComputer, now: DateTime<Utc>) -> Self {
        Self {
            computer_id,
            control_plane_id: request.control_plane_id.clone(),
            generation: request.generation,
            pairing_id: request.pairing_id,
            image: request.image.clone(),
            system_disk: SystemDisk::default(),
            previous_system_disk: None,
            role: request.role,
            resources: request.resources,
            enrollment: Some(request.enrollment.clone()),
            state: PowerState::Stopped,
            process: None,
            rootfs_never_booted: true,
            guest_restore_pending: false,
            start_pending: request.start,
            hibernating: false,
            last_launch: None,
            created_at: now,
        }
    }

    /// The golden a fresh restore of this computer comes from.
    pub fn golden_key(&self) -> GoldenKey {
        GoldenKey {
            image: self.image.clone(),
            vcpus: self.resources.vcpus,
            memory_mib: self.resources.memory_mib,
        }
    }

    /// The system disks the record holds: the current one, then the
    /// previous one if any. Any other file is a leftover.
    pub fn system_disks(&self) -> Vec<SystemDisk> {
        let mut disks = vec![self.system_disk];
        disks.extend(self.previous_system_disk.as_ref().map(|previous| previous.disk));
        disks
    }

    /// Whether `request` is the create that made this computer.
    pub fn created_by(&self, request: &CreateComputer) -> bool {
        self.control_plane_id == request.control_plane_id && self.generation == request.generation
    }

    /// The wire view.
    pub fn view(&self, usage: Option<Usage>) -> Computer {
        Computer {
            computer_id: self.computer_id,
            control_plane_id: self.control_plane_id.clone(),
            generation: self.generation,
            pairing_id: self.pairing_id,
            image: self.image.clone(),
            previous_image: self
                .previous_system_disk
                .as_ref()
                .map(|previous| previous.image.clone()),
            role: self.role,
            resources: self.resources,
            state: self.state,
            enrollment_present: self.enrollment.is_some(),
            created_at: self.created_at,
            usage,
            restore_pending: self.guest_restore_pending,
            last_launch: self.last_launch.clone(),
        }
    }
}

/// Hands out slots; the agent rebuilds it from the records at startup.
#[derive(Debug)]
pub struct SlotPool {
    free: std::collections::BTreeSet<Slot>,
    total: u16,
}

impl SlotPool {
    /// Slots `0..total`, minus those `held`.
    pub fn new(total: u16, held: impl IntoIterator<Item = Slot>) -> Self {
        let mut free: std::collections::BTreeSet<Slot> = (0..total).map(Slot).collect();
        for slot in held {
            free.remove(&slot);
        }
        Self { free, total }
    }

    /// The lowest free slot.
    pub fn take(&mut self) -> Option<Slot> {
        self.free.pop_first()
    }

    /// Return a slot whose process is gone.
    pub fn give_back(&mut self, slot: Slot) {
        if slot.0 < self.total {
            self.free.insert(slot);
        }
    }

    /// Slots on the host.
    pub fn total(&self) -> u16 {
        self.total
    }

    /// Slots no process holds.
    pub fn free(&self) -> usize {
        self.free.len()
    }
}
