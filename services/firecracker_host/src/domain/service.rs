//! The host agent's operations. Each computer's operations run one at a
//! time under its own lock; the record is saved after every step that
//! changed it, so a crash mid-operation leaves the last settled state.

use std::collections::HashMap;
use std::sync::Arc;
use tokio_util::task::TaskTracker;

use chrono::Utc;
use firecracker_host_api::mmds::{Document, Identity, MacroData, Network};
use firecracker_host_api::{
    Action, Computer, ComputerId, CreateComputer, ErrorCode, GuestImage, HostLimits, LaunchSource,
    LaunchTimings, PowerState,
};
use std::time::Instant;
use tokio::sync::Mutex;
use tracing::Instrument;

use crate::crash_point::{self, CrashPoint};
use crate::domain::metrics::{HostMetrics, Operation};
use crate::domain::model::{ComputerRecord, Process, SlotPool};
use crate::domain::ports::{
    BootSource, Disks, GoldenAvailability, Goldens, GuestSwap, Machines, Store,
};
use crate::domain::power::{Step, after, plan};

mod enrollment;
mod host;
mod moves;
mod operations;
pub mod pressure;
pub mod reconcile;
#[cfg(test)]
mod test;
mod upkeep;

/// The guest's address on its tap; the same in every netns.
pub const GUEST_ADDRESS: &str = "172.16.0.2/30";
/// The tap's host side; the same in every netns.
pub const GUEST_GATEWAY: &str = "172.16.0.1";

/// Guest programs the agent runs as root.
const RESTORE_COMMAND: [&str; 3] = ["systemctl", "start", "macro-restore.service"];
const ENROLL_COMMAND: [&str; 4] = [
    "systemctl",
    "restart",
    "macrod-enroll.service",
    "macrod.service",
];
/// Starts of macro-restore before a restore counts as failed.
const RESTORE_ATTEMPTS: u8 = 3;
/// Between them: macro-restore's own RestartSec.
const RESTORE_RETRY_DELAY: std::time::Duration = std::time::Duration::from_secs(1);

/// A failed operation, by what the client should do about it.
#[derive(Debug, thiserror::Error)]
pub enum HostError {
    /// No such computer.
    #[error("computer {0} does not exist on this host")]
    NotFound(ComputerId),
    /// Created for another control plane or generation.
    #[error("computer {0} exists for another control plane or generation")]
    GenerationMismatch(ComputerId),
    /// Malformed request.
    #[error(transparent)]
    InvalidRequest(#[from] InvalidRequest),
    /// The image is not installed.
    #[error("image {0} is not installed on this host")]
    ImageMissing(GuestImage),
    /// The golden is being built.
    #[error("the golden for {0} is not ready yet")]
    GoldenNotReady(GuestImage),
    /// Every slot is taken.
    #[error("every network slot is taken")]
    NoNetworkSlot,
    /// The action does not apply.
    #[error(transparent)]
    InvalidState(#[from] crate::domain::power::NotApplicable),
    /// The guest agent did not answer, or what it ran failed.
    #[error("the guest did not answer: {0}")]
    GuestUnreachable(#[source] GuestFailure),
    /// The computer is staged here (moving): not served, not created.
    #[error("computer {0} is staged on this host by a move")]
    Staged(ComputerId),
    /// Another operation on the computer is in progress; retry.
    #[error("{0}")]
    Busy(String),
    /// A move request this host cannot carry out.
    #[error("{0}")]
    MoveRefused(String),
    /// A host operation failed.
    #[error("{0}")]
    Internal(rootcause::Report),
}

/// Why a request is malformed.
#[derive(Debug, thiserror::Error)]
pub enum InvalidRequest {
    /// No vCPU or no memory.
    #[error("a computer needs at least one vCPU and some memory")]
    NoCpuOrMemory,
    /// No root disk or no `/home`.
    #[error("a computer needs a root disk and a /home volume")]
    NoDisks,
    /// The image name cannot become a path.
    #[error("image {0} is not a valid image name")]
    UnsafeImage(GuestImage),
    /// Host limits whose squeeze window is upside down.
    #[error(transparent)]
    HostLimits(#[from] firecracker_host_api::InvalidHostLimits),
}

/// How a guest failed a request.
#[derive(Debug, thiserror::Error)]
pub enum GuestFailure {
    /// Its agent could not be reached or broke the exchange.
    #[error("{0}")]
    Unreachable(rootcause::Report),
    /// A command the host ran in it exited non-zero.
    #[error("{command} exited {exit_code} in the guest; its journal has why")]
    CommandFailed {
        /// What ran.
        command: GuestCommand,
        /// Its exit code.
        exit_code: i32,
    },
}

/// The commands the host runs in guests.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::Display)]
#[strum(serialize_all = "kebab-case")]
pub enum GuestCommand {
    /// `systemctl start macro-restore.service`.
    MacroRestore,
    /// Restarting the guest's enrollment.
    Enrollment,
}

fn guest_unreachable(error: impl std::error::Error + Send + Sync + 'static) -> HostError {
    HostError::GuestUnreachable(GuestFailure::Unreachable(
        rootcause::Report::new(error).into_dynamic(),
    ))
}

impl HostError {
    /// The wire code.
    pub fn code(&self) -> ErrorCode {
        match self {
            Self::NotFound(_) => ErrorCode::NotFound,
            Self::GenerationMismatch(_) => ErrorCode::GenerationMismatch,
            Self::InvalidRequest(_) => ErrorCode::InvalidRequest,
            Self::ImageMissing(_) => ErrorCode::ImageMissing,
            Self::GoldenNotReady(_) => ErrorCode::GoldenNotReady,
            Self::NoNetworkSlot => ErrorCode::NoNetworkSlot,
            Self::InvalidState(_) => ErrorCode::InvalidState,
            Self::GuestUnreachable(_) => ErrorCode::GuestUnreachable,
            Self::Staged(_) | Self::Busy(_) => ErrorCode::InvalidState,
            Self::MoveRefused(_) => ErrorCode::InvalidRequest,
            Self::Internal(_) => ErrorCode::Internal,
        }
    }
}

fn internal(error: impl std::error::Error + Send + Sync + 'static) -> HostError {
    HostError::Internal(rootcause::Report::new(error).into_dynamic())
}

/// Settings the service needs from the agent's configuration.
#[derive(Debug, Clone)]
pub struct ServiceSettings {
    /// Host name, for registration.
    pub host_name: String,
    /// The Firecracker release, e.g. `v1.18.0`.
    pub firecracker_version: String,
    /// The agent's build, if recorded.
    pub agent_version: Option<String>,
    /// Network slots: computers running at once.
    pub slot_count: u16,
    /// Resolvers handed to guests.
    pub dns: Vec<String>,
    /// Launches (boots, restores, wakes) running at once.
    pub concurrent_launches: u16,
    /// Where other hosts push computers moving here (`[moves] listen`).
    pub move_address: Option<String>,
}

/// Reads the host's own numbers.
pub trait HostProbe: Send + Sync + 'static {
    /// `HostInfo` minus what the service knows (slots, goldens, name).
    fn measure(&self) -> HostMeasurement;
}

/// What [`HostProbe`] measures.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct HostMeasurement {
    /// Logical CPUs.
    pub cpus: u32,
    /// `MemTotal`.
    pub memory_total_bytes: u64,
    /// `MemAvailable`.
    pub memory_available_bytes: u64,
    /// The VMs' parent cgroup `memory.current`.
    pub guest_resident_memory_bytes: u64,
    /// KSM `pages_sharing` × page size.
    pub ksm_shared_bytes: u64,
    /// `SwapTotal`: zram the squeeze pushes idle computers into.
    pub swap_total_bytes: u64,
    /// `SwapTotal - SwapFree`: logical bytes in swap.
    pub swap_used_bytes: u64,
    /// RAM zram devices hold, compressed (`mm_stat` `mem_used_total`).
    pub zram_used_bytes: u64,
    /// Where swapped pages can go (`/proc/swaps`).
    pub swap_placement: SwapPlacement,
}

/// Where the host's swap puts pages.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum SwapPlacement {
    /// Only zram without a writeback device, or no swap at all.
    RamOnly,
    /// Swap devices that write to a disk: any but zram, and zram with a
    /// writeback device.
    Disk {
        /// How many.
        devices: u32,
    },
    /// `/proc/swaps` is unreadable: treated as on disk.
    #[default]
    Unknown,
}

type Entry = Arc<Mutex<Option<ComputerRecord>>>;

/// The host agent.
pub struct HostService<S, D, G, M, P> {
    store: S,
    disks: D,
    goldens: G,
    machines: M,
    probe: P,
    settings: ServiceSettings,
    computers: std::sync::Mutex<HashMap<ComputerId, Entry>>,
    slots: std::sync::Mutex<SlotPool>,
    /// Bounds concurrent launches: past a few at once each one slows all.
    launches: tokio::sync::Semaphore,
    /// A copy of every running computer's record, so exec reaches a guest
    /// without waiting for the computer's lock (held through a create's
    /// macro-restore).
    running: std::sync::Mutex<HashMap<ComputerId, ComputerRecord>>,
    /// Computers staged here by a move: never created over.
    staged: std::sync::Mutex<std::collections::HashSet<ComputerId>>,
    /// The control plane's memory limits for this host, once set.
    host_limits: std::sync::Mutex<Option<HostLimits>>,
    metrics: HostMetrics,
    /// Every computer's saved state, for the gauges without taking locks.
    states: std::sync::Mutex<HashMap<ComputerId, PowerState>>,
    /// Launches waiting for a turn.
    launches_waiting: std::sync::atomic::AtomicU64,
    /// Whether the last reconcile left nothing unresolved.
    reconcile_clean: std::sync::atomic::AtomicBool,
    /// Work that outlives a request (a restore finishing after an early
    /// answer); shutdown waits for it.
    tasks: TaskTracker,
    /// Running computers' activity and squeeze state (`pressure`).
    activity: std::sync::Mutex<HashMap<ComputerId, pressure::Tracked>>,
    /// Whether VMs may swap, as last applied (`None`: not yet).
    guest_swap: std::sync::Mutex<Option<GuestSwap>>,
}

impl<S: Store, D: Disks, G: Goldens, M: Machines, P: HostProbe> HostService<S, D, G, M, P> {
    /// Load every record and reconcile them with the host (an agent restart
    /// keeps processes; a host reboot does not): see [`reconcile`].
    pub async fn start(
        store: S,
        disks: D,
        goldens: G,
        machines: M,
        probe: P,
        settings: ServiceSettings,
        tasks: TaskTracker,
    ) -> Result<Self, HostError> {
        let mut records = store.load_all().await.map_err(internal)?;
        let host_limits = store.load_host_limits().await.map_err(internal)?;
        if let Some(limits) = &host_limits {
            machines
                .set_guest_memory_max(limits.guest_memory_max_bytes)
                .await
                .map_err(internal)?;
        }
        let report = reconcile::at_startup(&mut records, &store, &machines)
            .instrument(tracing::info_span!("firecracker_host.reconcile_startup"))
            .await;
        let metrics = HostMetrics::new();
        metrics.reconciled(&report);

        let held = records
            .iter()
            .filter_map(|record| record.process.map(|process| process.slot));
        let slots = SlotPool::new(settings.slot_count, held);
        let launches = tokio::sync::Semaphore::new(usize::from(settings.concurrent_launches));
        let running = records
            .iter()
            .filter(|record| record.state == PowerState::Running && record.process.is_some())
            .map(|record| (record.computer_id, record.clone()))
            .collect();
        let states = records
            .iter()
            .map(|record| (record.computer_id, record.state))
            .collect();
        let computers = records
            .into_iter()
            .map(|record| (record.computer_id, Arc::new(Mutex::new(Some(record)))))
            .collect();
        Ok(Self {
            store,
            disks,
            goldens,
            machines,
            probe,
            settings,
            computers: std::sync::Mutex::new(computers),
            slots: std::sync::Mutex::new(slots),
            launches,
            running: std::sync::Mutex::new(running),
            staged: std::sync::Mutex::new(std::collections::HashSet::new()),
            host_limits: std::sync::Mutex::new(host_limits),
            metrics,
            states: std::sync::Mutex::new(states),
            launches_waiting: std::sync::atomic::AtomicU64::new(0),
            reconcile_clean: std::sync::atomic::AtomicBool::new(report.unresolved.is_empty()),
            tasks,
            activity: std::sync::Mutex::new(HashMap::new()),
            guest_swap: std::sync::Mutex::new(None),
        })
    }

    fn entry(&self, computer_id: ComputerId) -> Entry {
        let mut computers = self
            .computers
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        computers
            .entry(computer_id)
            .or_insert_with(|| Arc::new(Mutex::new(None)))
            .clone()
    }

    fn entries(&self) -> Vec<Entry> {
        let computers = self
            .computers
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        computers.values().cloned().collect()
    }

    fn forget(&self, computer_id: ComputerId) {
        let mut computers = self
            .computers
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        computers.remove(&computer_id);
    }

    /// Save `record` and keep the running copy in step with it.
    async fn save(&self, record: &ComputerRecord) -> Result<(), HostError> {
        self.store.save(record).await.map_err(internal)?;
        self.states
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(record.computer_id, record.state);
        let mut running = self
            .running
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if record.state == PowerState::Running && record.process.is_some() {
            running.insert(record.computer_id, record.clone());
        } else {
            running.remove(&record.computer_id);
        }
        Ok(())
    }

    fn running_copy(&self, computer_id: ComputerId) -> Option<ComputerRecord> {
        self.running
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(&computer_id)
            .cloned()
    }

    fn slot_pool(&self) -> std::sync::MutexGuard<'_, SlotPool> {
        self.slots
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    fn document(&self, record: &ComputerRecord) -> Document {
        Document {
            macro_data: MacroData {
                identity: Identity {
                    id: record.computer_id,
                    role: record.role,
                    time_unix_ms: Utc::now().timestamp_millis(),
                    network: Network {
                        address: GUEST_ADDRESS.to_owned(),
                        gateway: GUEST_GATEWAY.to_owned(),
                        dns: self.settings.dns.clone(),
                    },
                },
                enrollment: record.enrollment.clone(),
            },
        }
    }

    /// A process that ended on its own (guest reboot, crash, OOM kill)
    /// leaves the computer stopped; see [`reconcile::settle`].
    async fn observe(&self, record: &mut ComputerRecord) -> Result<(), HostError> {
        let repairs = self.settle_and_save(record).await?;
        self.metrics.repaired(&repairs);
        Ok(())
    }

    fn view(&self, record: &ComputerRecord) -> Computer {
        let usage = record
            .process
            .and_then(|process| self.machines.usage(record, process));
        record.view(usage)
    }

    /// One computer.
    pub async fn get(&self, computer_id: ComputerId) -> Result<Computer, HostError> {
        let entry = self.entry(computer_id);
        let mut guard = entry.lock().await;
        let record = guard.as_mut().ok_or(HostError::NotFound(computer_id))?;
        self.observe(record).await?;
        Ok(self.view(record))
    }

    /// Every computer.
    pub async fn list(&self) -> Result<Vec<Computer>, HostError> {
        let mut computers = Vec::new();
        for entry in self.entries() {
            let mut guard = entry.lock().await;
            if let Some(record) = guard.as_mut() {
                self.observe(record).await?;
                computers.push(self.view(record));
            }
        }
        computers.sort_by_key(|computer| computer.created_at);
        Ok(computers)
    }

    /// Create unless it exists; see [`CreateComputer`].
    pub async fn create(
        self: &Arc<Self>,
        computer_id: ComputerId,
        request: CreateComputer,
    ) -> Result<Computer, HostError> {
        let started = Instant::now();
        let result = self.create_measured(computer_id, request).await;
        self.metrics.operation(
            Operation::Create,
            started.elapsed(),
            result.as_ref().map(|_| ()),
        );
        result
    }

    #[tracing::instrument(name = "firecracker_host.create", skip_all, fields(computer_id = %computer_id, image = %request.image, start = request.start, created = tracing::field::Empty), err)]
    async fn create_measured(
        self: &Arc<Self>,
        computer_id: ComputerId,
        request: CreateComputer,
    ) -> Result<Computer, HostError> {
        let received = Instant::now();
        let entry = self.entry(computer_id);
        let mut guard = entry.lock().await;
        let lock_wait_ms = elapsed_ms(received);
        if let Some(record) = guard.as_mut() {
            tracing::Span::current().record("created", false);
            if !record.created_by(&request) {
                return Err(HostError::GenerationMismatch(computer_id));
            }
            self.observe(record).await?;
            // The create's boot never succeeded (failed, or the agent died
            // during it): this repeat runs it.
            if record.start_pending && record.state == PowerState::Stopped {
                self.run_steps(record, &[Step::Boot]).await?;
            }
            self.finish_restore(record).await?;
            return Ok(self.view(record));
        }
        if self.is_staged(computer_id) {
            return Err(HostError::Staged(computer_id));
        }
        tracing::Span::current().record("created", true);

        validate(&request)?;
        let mut record = ComputerRecord::new(computer_id, &request, Utc::now());
        self.require_golden(&record)?;
        let preparing = Instant::now();
        self.disks.prepare(&record).await.map_err(internal)?;
        let create_disks_ms = elapsed_ms(preparing);
        crash_point::reach(CrashPoint::CreateDisksPrepared);
        let saving = Instant::now();
        self.save(&record).await?;
        let create_record_ms = elapsed_ms(saving);
        crash_point::reach(CrashPoint::CreateRecordSaved);

        // Saved before booting: a failed boot leaves a stopped computer
        // whose `start` retries it.
        let mut result = if request.start {
            self.run_steps(&mut record, &[Step::Boot]).await
        } else {
            Ok(())
        };
        if result.is_ok() && request.start {
            if request.return_when_resumed {
                result = self.wait_for_guest_agent(&mut record).await;
            } else {
                result = self.finish_restore(&mut record).await;
            }
        }
        if let Some(timings) = record.last_launch.as_mut() {
            account_whole_create(
                timings,
                received,
                lock_wait_ms,
                create_disks_ms,
                create_record_ms,
            );
        }
        let view = self.view(&record);
        *guard = Some(record);
        drop(guard);
        if result.is_ok() {
            // The create may have taken a spare disk set: top them up now,
            // not at the next upkeep.
            let this = Arc::clone(self);
            self.tasks
                .spawn(async move { this.refill_spares().await }.in_current_span());
        }
        if result.is_ok() && view.restore_pending {
            // Answered early: macro-restore runs on, under the computer's
            // lock; `GET` shows when `restorePending` clears.
            let this = Arc::clone(self);
            self.tasks.spawn(async move {
                let entry = this.entry(computer_id);
                let mut guard = entry.lock().await;
                if let Some(record) = guard.as_mut()
                    && let Err(error) = this.finish_restore(record).await
                {
                    tracing::warn!(computer_id = %computer_id, error = %error, "macro-restore after an early answer failed; a repeated create retries it");
                }
            }.in_current_span());
        }
        result.map(|()| view)
    }

    /// Wait until a just-launched guest's agent answers, and record how
    /// long that took.
    async fn wait_for_guest_agent(&self, record: &mut ComputerRecord) -> Result<(), HostError> {
        let Some(process) = record.process else {
            return Ok(());
        };
        let started = Instant::now();
        self.machines
            .connect_guest(record, process)
            .await
            .map_err(guest_unreachable)?;
        if let Some(timings) = record.last_launch.as_mut() {
            let guest_agent_ms = elapsed_ms(started);
            timings.guest_agent_ms = Some(guest_agent_ms);
            timings.total_ms += guest_agent_ms;
        }
        Ok(())
    }

    fn require_golden(&self, record: &ComputerRecord) -> Result<(), HostError> {
        let key = record.golden_key();
        match self.goldens.availability(&key) {
            GoldenAvailability::Ready => Ok(()),
            GoldenAvailability::Building => Err(HostError::GoldenNotReady(record.image.clone())),
            GoldenAvailability::Absent => {
                self.goldens.build(key);
                Err(HostError::GoldenNotReady(record.image.clone()))
            }
            GoldenAvailability::ImageMissing => Err(HostError::ImageMissing(record.image.clone())),
        }
    }

    /// Run a power action.
    #[tracing::instrument(name = "firecracker_host.power", skip(self), fields(state = tracing::field::Empty), err)]
    pub async fn power(
        &self,
        computer_id: ComputerId,
        action: Action,
    ) -> Result<Computer, HostError> {
        let started = Instant::now();
        let entry = self.entry(computer_id);
        let mut guard = entry.lock().await;
        let record = guard.as_mut().ok_or(HostError::NotFound(computer_id))?;
        self.observe(record).await?;
        tracing::Span::current().record("state", record.state.as_ref());
        let operation = Operation::power(action, record.state);

        let result = async {
            let steps = plan(record.state, action)?;
            self.run_steps(record, steps).await?;
            self.finish_restore(record).await
        }
        .await;
        self.metrics
            .operation(operation, started.elapsed(), result.as_ref().copied());
        result?;
        Ok(self.view(record))
    }

    async fn run_steps(
        &self,
        record: &mut ComputerRecord,
        steps: &[Step],
    ) -> Result<(), HostError> {
        for &step in steps {
            self.run_step(record, step).await?;
            record.state = after(step);
            self.save(record).await?;
        }
        Ok(())
    }

    #[tracing::instrument(name = "firecracker_host.step", skip(self, record), fields(computer_id = %record.computer_id), err)]
    async fn run_step(&self, record: &mut ComputerRecord, step: Step) -> Result<(), HostError> {
        match step {
            Step::Boot | Step::Wake => {
                let started = Instant::now();
                let source = match step {
                    Step::Wake => BootSource::Hibernation,
                    _ if record.rootfs_never_booted => {
                        self.require_golden(record)?;
                        BootSource::Golden
                    }
                    _ => BootSource::ColdBoot,
                };
                let disks = self.disks.prepare(record).await.map_err(internal)?;
                let disks_ms = elapsed_ms(started);
                let slot = self.slot_pool().take().ok_or(HostError::NoNetworkSlot)?;
                let document = self.document(record);
                let queued = Instant::now();
                let launched = {
                    let waiting = &self.launches_waiting;
                    waiting.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    let turn = self
                        .launches
                        .acquire()
                        .instrument(tracing::info_span!("firecracker_host.launch_queue"))
                        .await;
                    waiting.fetch_sub(1, std::sync::atomic::Ordering::Relaxed);
                    let _turn = turn.map_err(internal)?;
                    let queue_ms = elapsed_ms(queued);
                    self.machines
                        .launch(record, slot, source, &disks, &document)
                        .await
                        .map(|launched| (launched, queue_ms))
                };
                let launch_source = match source {
                    BootSource::Golden => LaunchSource::Golden,
                    BootSource::Hibernation => LaunchSource::Hibernation,
                    BootSource::ColdBoot => LaunchSource::ColdBoot,
                };
                self.metrics
                    .launch(launch_source, started.elapsed(), launched.is_ok());
                let process = match launched {
                    Ok((launched, queue_ms)) => {
                        let phases = launched.phases;
                        record.last_launch = Some(LaunchTimings {
                            source: launch_source,
                            disk_backend: self.disks.backend(),
                            disks_ms,
                            queue_ms,
                            jail_ms: phases.jail_ms,
                            jailer_ms: phases.jailer_ms,
                            snapshot_load_ms: phases.snapshot_load_ms,
                            drives_patch_ms: phases.drives_patch_ms,
                            mmds_ms: phases.mmds_ms,
                            resume_ms: phases.resume_ms,
                            guest_agent_ms: None,
                            macro_restore_ms: None,
                            macro_restore_attempts: None,
                            total_ms: elapsed_ms(started),
                            lock_wait_ms: None,
                            create_disks_ms: None,
                            create_record_ms: None,
                            other_ms: None,
                        });
                        launched.process
                    }
                    Err(error) => {
                        self.slot_pool().give_back(slot);
                        return Err(internal(error));
                    }
                };
                record.process = Some(process);
                record.rootfs_never_booted = false;
                record.start_pending = false;
                // A cold boot runs macro-restore itself, at boot.
                record.guest_restore_pending = source != BootSource::ColdBoot;
                // Saved now: from here on a process holds the slot.
                record.state = PowerState::Running;
                crash_point::reach(CrashPoint::LaunchReturned);
                self.save(record).await?;
                crash_point::reach(CrashPoint::LaunchSaved);
                if source == BootSource::Hibernation {
                    crash_point::reach(CrashPoint::WakeSaved);
                    self.machines
                        .discard_hibernation(record.computer_id)
                        .await
                        .map_err(internal)?;
                }
                Ok(())
            }
            Step::Resume => {
                let process = record.process.ok_or_else(|| missing_process(record))?;
                let document = self.document(record);
                self.machines
                    .resume(record, process, &document)
                    .await
                    .map_err(internal)?;
                // The clock stood still while paused.
                self.kick_restore(record, process).await;
                Ok(())
            }
            Step::Pause => {
                let process = record.process.ok_or_else(|| missing_process(record))?;
                self.machines.pause(record, process).await.map_err(internal)
            }
            Step::Shutdown | Step::Hibernate => {
                let process = record.process.ok_or_else(|| missing_process(record))?;
                if step == Step::Shutdown {
                    self.machines
                        .shutdown(record, process)
                        .await
                        .map_err(internal)?;
                } else {
                    // Saved first: an agent killed once the snapshot is
                    // published finishes the hibernation at startup.
                    record.hibernating = true;
                    self.save(record).await?;
                    crash_point::reach(CrashPoint::HibernateFlagSaved);
                    let started = Instant::now();
                    let hibernated = self.machines.hibernate(record, process).await;
                    self.metrics
                        .hibernate(started.elapsed(), hibernated.is_ok());
                    hibernated.map_err(internal)?;
                    crash_point::reach(CrashPoint::HibernateEnded);
                    record.hibernating = false;
                }
                record.process = None;
                self.slot_pool().give_back(process.slot);
                Ok(())
            }
            Step::DiscardHibernation => self
                .machines
                .discard_hibernation(record.computer_id)
                .await
                .map_err(internal),
        }
    }

    /// Run `macro-restore` in a restored guest that has not run it yet: the
    /// guest cannot tell it was restored (its VMGenID driver only reseeds),
    /// so this is what gives it its identity and `/home`.
    #[tracing::instrument(name = "firecracker_host.guest_restore", skip_all, fields(computer_id = %record.computer_id), err)]
    async fn finish_restore(&self, record: &mut ComputerRecord) -> Result<(), HostError> {
        let (true, PowerState::Running, Some(process)) =
            (record.guest_restore_pending, record.state, record.process)
        else {
            return Ok(());
        };
        let started = Instant::now();
        let result = self.run_restore(record, process, started).await;
        self.metrics
            .guest_restore(started.elapsed(), result.is_ok());
        result
    }

    async fn run_restore(
        &self,
        record: &mut ComputerRecord,
        process: Process,
        started: Instant,
    ) -> Result<(), HostError> {
        let guest_agent_ms = match self.machines.connect_guest(record, process).await {
            Ok(_) => elapsed_ms(started),
            Err(error) => return Err(guest_unreachable(error)),
        };
        let restoring = Instant::now();
        // macro-restore restarts itself on failure (the drives' growth can
        // race its first run), so a failed start is retried a few times.
        let mut attempt = 1;
        loop {
            // macro-restore steps the clock to the document's time: fresh
            // for every attempt.
            let document = self.document(record);
            self.machines
                .put_mmds(record, process, &document)
                .await
                .map_err(internal)?;
            let code = self.run_as_root(record, process, &RESTORE_COMMAND).await?;
            if code == 0 {
                break;
            }
            if attempt == RESTORE_ATTEMPTS {
                return Err(HostError::GuestUnreachable(GuestFailure::CommandFailed {
                    command: GuestCommand::MacroRestore,
                    exit_code: code,
                }));
            }
            tracing::warn!(computer_id = %record.computer_id, code, attempt, "macro-restore failed, starting it again");
            attempt += 1;
            tokio::time::sleep(RESTORE_RETRY_DELAY).await;
        }
        if let Some(timings) = record.last_launch.as_mut() {
            let macro_restore_ms = elapsed_ms(restoring);
            timings.guest_agent_ms = Some(guest_agent_ms);
            timings.macro_restore_ms = Some(macro_restore_ms);
            timings.macro_restore_attempts = Some(attempt);
            timings.total_ms += guest_agent_ms + macro_restore_ms;
            tracing::info!(computer_id = %record.computer_id, timings = ?timings, "launch finished");
        }
        record.guest_restore_pending = false;
        self.save(record).await
    }

    /// Step a resumed guest's clock (it stood still while paused); best
    /// effort, the guest's NTP corrects it too.
    async fn kick_restore(&self, record: &ComputerRecord, process: Process) {
        match self.run_as_root(record, process, &RESTORE_COMMAND).await {
            Ok(0) => {}
            Ok(code) => {
                tracing::warn!(computer_id = %record.computer_id, code, "macro-restore failed in the guest; journalctl -u macro-restore has why");
            }
            Err(error) => {
                tracing::warn!(computer_id = %record.computer_id, error = %error, "could not start macro-restore in the guest");
            }
        }
    }

    /// Destroy the VM and its disks; absent is fine.
    pub async fn destroy(&self, computer_id: ComputerId) -> Result<(), HostError> {
        let started = Instant::now();
        let result = self.destroy_measured(computer_id).await;
        self.metrics.operation(
            Operation::Destroy,
            started.elapsed(),
            result.as_ref().map(|_| ()),
        );
        result
    }

    #[tracing::instrument(name = "firecracker_host.destroy", skip(self), err)]
    async fn destroy_measured(&self, computer_id: ComputerId) -> Result<(), HostError> {
        let entry = self.entry(computer_id);
        let mut guard = entry.lock().await;
        if let Some(record) = guard.as_mut()
            && let Some(process) = record.process
        {
            self.machines
                .kill(record, process)
                .await
                .map_err(internal)?;
            record.process = None;
            record.state = PowerState::Stopped;
            self.slot_pool().give_back(process.slot);
            self.save(record).await?;
        }
        self.machines
            .discard_hibernation(computer_id)
            .await
            .map_err(internal)?;
        self.disks.delete(computer_id).await.map_err(internal)?;
        crash_point::reach(CrashPoint::DestroyDisksDeleted);
        // The record goes last, so a retry after a failure above still
        // finds what is left to delete.
        self.store.delete(computer_id).await.map_err(internal)?;
        *guard = None;
        drop(guard);
        self.forget(computer_id);
        self.states
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&computer_id);
        self.running
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .remove(&computer_id);
        Ok(())
    }

    /// A stream to the guest agent of a running computer, for exec.
    pub async fn connect_guest(
        &self,
        computer_id: ComputerId,
    ) -> Result<M::GuestStream, HostError> {
        // A running guest is reachable now, even while a create or start
        // holds the computer for its macro-restore.
        if let Some(record) = self.running_copy(computer_id)
            && let Some(process) = record.process
        {
            return self
                .machines
                .connect_guest(&record, process)
                .await
                .map_err(guest_unreachable);
        }
        let entry = self.entry(computer_id);
        let mut guard = entry.lock().await;
        let record = guard.as_mut().ok_or(HostError::NotFound(computer_id))?;
        self.observe(record).await?;
        let process = match (record.state, record.process) {
            (PowerState::Running, Some(process)) => process,
            (state, _) => {
                return Err(HostError::InvalidState(
                    crate::domain::power::NotApplicable {
                        state,
                        action: Action::Start,
                    },
                ));
            }
        };
        self.machines
            .connect_guest(record, process)
            .await
            .map_err(guest_unreachable)
    }

    /// Run `argv` as root in the guest; its exit code.
    async fn run_as_root(
        &self,
        record: &ComputerRecord,
        process: Process,
        argv: &[&str],
    ) -> Result<i32, HostError> {
        self.machines
            .run_as_root(record, process, argv)
            .await
            .map_err(guest_unreachable)
    }
}

/// Make a create's timings cover its whole handler: the create's own
/// phases are added and whatever no phase covers lands in `other_ms`, so the
/// phases sum to `total_ms`.
fn account_whole_create(
    timings: &mut LaunchTimings,
    received: Instant,
    lock_wait_ms: u64,
    create_disks_ms: u64,
    create_record_ms: u64,
) {
    let total_ms = elapsed_ms(received);
    let phases = [
        Some(lock_wait_ms),
        Some(create_disks_ms),
        Some(create_record_ms),
        Some(timings.disks_ms),
        Some(timings.queue_ms),
        Some(timings.jail_ms),
        Some(timings.jailer_ms),
        timings.snapshot_load_ms,
        timings.drives_patch_ms,
        timings.mmds_ms,
        Some(timings.resume_ms),
        timings.guest_agent_ms,
        timings.macro_restore_ms,
    ];
    let accounted: u64 = phases.into_iter().flatten().sum();
    timings.lock_wait_ms = Some(lock_wait_ms);
    timings.create_disks_ms = Some(create_disks_ms);
    timings.create_record_ms = Some(create_record_ms);
    timings.other_ms = Some(total_ms.saturating_sub(accounted));
    timings.total_ms = total_ms;
}

fn elapsed_ms(started: Instant) -> u64 {
    u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX)
}

fn missing_process(record: &ComputerRecord) -> HostError {
    HostError::Internal(rootcause::report!(
        "computer {} is {} without a process",
        record.computer_id,
        record.state
    ))
}

fn validate(request: &CreateComputer) -> Result<(), HostError> {
    let resources = request.resources;
    if resources.vcpus == 0 || resources.memory_mib == 0 {
        return Err(InvalidRequest::NoCpuOrMemory.into());
    }
    if resources.root_disk_gib == 0 || resources.home_disk_gib == 0 {
        return Err(InvalidRequest::NoDisks.into());
    }
    if !image_name_is_safe(request.image.as_str()) {
        return Err(InvalidRequest::UnsafeImage(request.image.clone()).into());
    }
    Ok(())
}

/// Image names become paths under the images directory: letters, digits,
/// `-_.`, and `/` between non-empty components that are not `.` or `..`.
pub fn image_name_is_safe(image: &str) -> bool {
    !image.is_empty()
        && image.len() <= 255
        && image.split('/').all(|component| {
            !component.is_empty()
                && component != "."
                && component != ".."
                && component
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
        })
}
