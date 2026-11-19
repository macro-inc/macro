//! What the host service needs from the host.

use firecracker_host_api::mmds::Document;
use std::path::PathBuf;

use std::sync::Arc;

use firecracker_host_api::{
    Action, Computer, ComputerId, CreateComputer, DiskBackend, GoldenImage, GoldenKey, GuestImage,
    HostInfo, HostLimits, SetEnrollment, Usage,
};

use crate::domain::service::HostError;
use tokio::io::{AsyncRead, AsyncWrite};

use crate::domain::model::{ComputerRecord, Process, Slot};

/// Records on the durable disk.
pub trait Store: Send + Sync + 'static {
    /// Adapter failure type.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Every record, for startup.
    fn load_all(&self) -> impl Future<Output = Result<Vec<ComputerRecord>, Self::Err>> + Send;

    /// Write a record atomically.
    fn save(&self, record: &ComputerRecord) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Delete a record; absent is fine.
    fn delete(&self, computer_id: ComputerId)
    -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// The record a staged (received) copy of the computer carries.
    fn load_staged(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<Option<ComputerRecord>, Self::Err>> + Send;

    /// The host's limits, if the control plane set them.
    fn load_host_limits(
        &self,
    ) -> impl Future<Output = Result<Option<HostLimits>, Self::Err>> + Send;

    /// Keep the host's limits.
    fn save_host_limits(
        &self,
        limits: &HostLimits,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// What backs a VM drive: the jail bind-mounts a file and makes a device
/// node for a block device, at the drive's fixed chroot path either way.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DriveBacking {
    /// A regular file (XFS reflink copies).
    File(PathBuf),
    /// A block device such as a ZFS zvol (`/dev/zvol/...`).
    BlockDevice(PathBuf),
}

impl DriveBacking {
    /// The host path.
    pub fn path(&self) -> &std::path::Path {
        match self {
            Self::File(path) | Self::BlockDevice(path) => path,
        }
    }
}

/// A computer's two drives.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComputerDisks {
    /// The root drive (`/dev/vda`).
    pub rootfs: DriveBacking,
    /// The `/home` drive (`/dev/vdb`).
    pub home: DriveBacking,
}

/// Storage for computers' and goldens' disks: XFS reflink files
/// (`outbound::disks`), or ZFS clones of the golden.
pub trait Disks: Send + Sync + 'static {
    /// Adapter failure type.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Make both drives exist at their sold sizes: a rootfs cloned from the
    /// golden of `record` unless one exists, a `/home` reused or created
    /// empty, both grown and never shrunk. Safe to repeat.
    fn prepare(
        &self,
        record: &ComputerRecord,
    ) -> impl Future<Output = Result<ComputerDisks, Self::Err>> + Send;

    /// A writable copy of `key`'s image rootfs for the golden boot,
    /// replacing any earlier one.
    fn create_golden_rootfs(
        &self,
        key: &GoldenKey,
    ) -> impl Future<Output = Result<DriveBacking, Self::Err>> + Send;

    /// Freeze the golden rootfs after its snapshot: computers clone it and
    /// nothing writes it again. On ZFS the golden's disk set also gets an
    /// empty `/home` of every size of the last [`Disks::prepare_home_templates`].
    fn seal_golden_rootfs(
        &self,
        key: &GoldenKey,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Make the empty `/home` of these sizes a create starts from: on XFS
    /// one template file per size; on ZFS one file per size in the disk set
    /// of each golden in `goldens`, so a computer's clone already holds it.
    fn prepare_home_templates(
        &self,
        goldens: &[GoldenKey],
        sizes_gib: &[u32],
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Keep a few ready disk sets per golden in `goldens` and sold `/home`
    /// size, so a create renames one instead of cloning; drop those of
    /// other goldens. Storage without the need does nothing.
    fn refill_spares(
        &self,
        goldens: &[GoldenKey],
        home_sizes_gib: &[u32],
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Whether the empty `/home` of these sizes exist (for `goldens`, on ZFS).
    fn home_templates_ready(&self, goldens: &[GoldenKey], sizes_gib: &[u32]) -> bool;

    /// Whether `key`'s sealed golden rootfs exists.
    fn golden_rootfs_present(&self, key: &GoldenKey) -> bool;

    /// What the disks are, for timings.
    fn backend(&self) -> DiskBackend;

    /// Delete both files; absent is fine. Storage that cannot delete now
    /// (a busy ZFS dataset) may defer it to [`Disks::collect_garbage`].
    fn delete(&self, computer_id: ComputerId)
    -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Finish deletes that were deferred; for the periodic upkeep.
    fn collect_garbage(&self) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Whether a golden can be restored now.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum GoldenAvailability {
    /// Restorable.
    Ready,
    /// Being built.
    Building,
    /// Never built, or the last build failed; [`Goldens::build`] starts one.
    Absent,
    /// The image is not installed on the host.
    ImageMissing,
}

/// Golden snapshots.
pub trait Goldens: Send + Sync + 'static {
    /// Where the golden for `key` stands.
    fn availability(&self, key: &GoldenKey) -> GoldenAvailability;

    /// Start building `key` in the background unless it is ready or building.
    fn build(&self, key: GoldenKey);

    /// Every golden and its state.
    fn list(&self) -> Vec<GoldenImage>;

    /// Images installed on the host.
    fn images(&self) -> Vec<GuestImage>;
}

/// What a new process starts from; its Display (`golden`, `hibernation`,
/// `cold_boot`) is the `source` span field monitors filter on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::Display)]
#[strum(serialize_all = "snake_case")]
pub enum BootSource {
    /// The golden of the record's image and shape (fresh rootfs only).
    Golden,
    /// The computer's hibernation snapshot.
    Hibernation,
    /// A cold boot of the computer's own rootfs.
    ColdBoot,
}

/// Where one launch's time went inside [`Machines::launch`], in ms.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LaunchPhases {
    /// Chroot, drive placement, snapshot links.
    pub jail_ms: u64,
    /// Jailer until Firecracker's API answers.
    pub jailer_ms: u64,
    /// `snapshot/load` (restores only).
    pub snapshot_load_ms: Option<u64>,
    /// `PATCH` both drives (restores only).
    pub drives_patch_ms: Option<u64>,
    /// `PUT /mmds` (restores only; a cold boot configures it with the VM).
    pub mmds_ms: Option<u64>,
    /// Resume, or configure and `InstanceStart` for a cold boot.
    pub resume_ms: u64,
}

/// A started process and how long starting it took.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Launched {
    /// The process.
    pub process: Process,
    /// Its phases.
    pub phases: LaunchPhases,
}

/// A jail found on the host, by whose it is.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Jail {
    /// A computer's.
    Computer(ComputerId),
    /// The golden builds'.
    Golden,
    /// A name the agent never makes; left alone.
    Unrecognized(String),
}

/// Jailed Firecracker processes, one per running or paused computer.
pub trait Machines: Send + Sync + 'static {
    /// Adapter failure type.
    type Err: std::error::Error + Send + Sync + 'static;
    /// A connected, handshaken stream to the guest agent.
    type GuestStream: AsyncRead + AsyncWrite + Send + Unpin + 'static;

    /// Start a process in `slot` from `source` on `disks`, serving
    /// `document` in MMDS before the guest runs, and leave it running.
    fn launch(
        &self,
        record: &ComputerRecord,
        slot: Slot,
        source: BootSource,
        disks: &ComputerDisks,
        document: &Document,
    ) -> impl Future<Output = Result<Launched, Self::Err>> + Send;

    /// Pause the vCPUs.
    fn pause(
        &self,
        record: &ComputerRecord,
        process: Process,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Replace the MMDS document, then resume the vCPUs.
    fn resume(
        &self,
        record: &ComputerRecord,
        process: Process,
        document: &Document,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Replace the MMDS document.
    fn put_mmds(
        &self,
        record: &ComputerRecord,
        process: Process,
        document: &Document,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Clean shutdown, killed after the grace period; the jail is removed.
    fn shutdown(
        &self,
        record: &ComputerRecord,
        process: Process,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Snapshot a paused VM to its hibernation files, then end the process
    /// and remove the jail.
    fn hibernate(
        &self,
        record: &ComputerRecord,
        process: Process,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// End the process if it lives and remove the jail. Safe to repeat.
    fn kill(
        &self,
        record: &ComputerRecord,
        process: Process,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Whether the computer has a hibernation snapshot.
    fn has_hibernation(&self, computer_id: ComputerId) -> bool;

    /// Delete the hibernation snapshot; absent is fine.
    fn discard_hibernation(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Whether the process still runs.
    fn alive(&self, record: &ComputerRecord, process: Process) -> bool;

    /// What the process uses now; `None` when it cannot be read.
    fn usage(&self, record: &ComputerRecord, process: Process) -> Option<Usage>;

    /// Cap all VMs' memory together (`memory.max` of their parent cgroup).
    fn set_guest_memory_max(
        &self,
        bytes: u64,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Let all VMs swap, or none (`memory.swap.max` of their parent cgroup:
    /// `max` or 0).
    fn set_guest_swap(&self, swap: GuestSwap)
    -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Set the VM cgroup's `cpu.weight` (1..=10000; the default is 100).
    fn set_cpu_weight(
        &self,
        record: &ComputerRecord,
        process: Process,
        weight: u16,
    ) -> Result<(), Self::Err>;

    /// Push up to `bytes` of the VM's memory out to swap (`memory.reclaim`);
    /// returns how much its charge fell. Takes seconds for a large VM.
    fn reclaim_memory(
        &self,
        record: &ComputerRecord,
        process: Process,
        bytes: u64,
    ) -> impl Future<Output = Result<u64, Self::Err>> + Send;

    /// Every jail on the host: chroots and VM cgroups, including those of
    /// processes no record knows (an agent killed mid-launch).
    fn jails(&self) -> Result<Vec<Jail>, Self::Err>;

    /// End whatever runs in `jail` and remove it. Safe to repeat.
    fn remove_jail(&self, jail: &Jail) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Connect to the guest agent.
    fn connect_guest(
        &self,
        record: &ComputerRecord,
        process: Process,
    ) -> impl Future<Output = Result<Self::GuestStream, Self::Err>> + Send;

    /// Run `argv` as root in the guest, discarding its output; its exit
    /// code.
    fn run_as_root(
        &self,
        record: &ComputerRecord,
        process: Process,
        argv: &[&str],
    ) -> impl Future<Output = Result<i32, Self::Err>> + Send;
}

/// The agent's operations, as the inbound adapters see them; implemented by
/// [`crate::domain::service::HostService`].
pub trait HostOperations: Send + Sync + 'static {
    /// A connected stream to a guest agent.
    type GuestStream: AsyncRead + AsyncWrite + Send + Unpin + 'static;

    /// The host: capacity, measured memory, goldens.
    fn host(&self) -> HostInfo;

    /// Every golden.
    fn goldens(&self) -> Vec<GoldenImage>;

    /// Build a golden unless it is ready or building.
    fn build_golden(&self, key: GoldenKey) -> Result<GoldenImage, HostError>;

    /// Set the host's memory limits, kept across restarts.
    fn set_host_limits(
        &self,
        limits: HostLimits,
    ) -> impl Future<Output = Result<(), HostError>> + Send;

    /// Every computer, oldest first.
    fn list(&self) -> impl Future<Output = Result<Vec<Computer>, HostError>> + Send;

    /// One computer.
    fn get(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<Computer, HostError>> + Send;

    /// Create unless it exists. Takes the service's `Arc`: an early answer
    /// leaves `macro-restore` running in a task that outlives the request.
    fn create(
        self: &Arc<Self>,
        computer_id: ComputerId,
        request: CreateComputer,
    ) -> impl Future<Output = Result<Computer, HostError>> + Send;

    /// Run a power action.
    fn power(
        &self,
        computer_id: ComputerId,
        action: Action,
    ) -> impl Future<Output = Result<Computer, HostError>> + Send;

    /// Replace the enrollment and restart the guest's enrollment.
    fn set_enrollment(
        &self,
        computer_id: ComputerId,
        request: SetEnrollment,
    ) -> impl Future<Output = Result<Computer, HostError>> + Send;

    /// Remove the enrollment; absent is fine.
    fn clear_enrollment(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<(), HostError>> + Send;

    /// Destroy the computer and its disks; absent is fine.
    fn destroy(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<(), HostError>> + Send;

    /// A stream to a running computer's guest agent, for exec.
    fn connect_guest(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<Self::GuestStream, HostError>> + Send;
}

/// Whether the VMs may swap.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GuestSwap {
    /// As much as the kernel wants (all swap is in RAM).
    Allowed,
    /// Not at all (swap may reach a disk).
    Off,
}
