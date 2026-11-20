use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::Utc;
use firecracker_host_api::mmds::Document;
use firecracker_host_api::{
    Action, ComputerId, ComputerResources, ControlPlaneId, CreateComputer, DiskBackend,
    EnrollmentDocument, EnrollmentGeneration, ErrorCode, GoldenImage, GoldenKey, GuestImage,
    HostLimits, PairingId, PowerState, Usage,
};
use uuid::Uuid;

use super::{HostError, HostMeasurement, HostProbe, HostService, ServiceSettings, SwapPlacement};
use crate::domain::model::{ComputerRecord, Process, Slot};
use crate::domain::ports::{
    BootSource, ComputerDisks, Disks, DriveBacking, GoldenAvailability, Goldens, GuestSwap, Jail,
    LaunchPhases, Launched, Machines, Store,
};

#[derive(Debug, thiserror::Error)]
#[error("fake failure")]
pub(super) struct FakeError;

#[derive(Clone, Default)]
pub(super) struct FakeStore(pub(super) Arc<Mutex<HashMap<ComputerId, ComputerRecord>>>);

impl Store for FakeStore {
    type Err = FakeError;
    async fn load_all(&self) -> Result<Vec<ComputerRecord>, FakeError> {
        Ok(self.0.lock().unwrap().values().cloned().collect())
    }
    async fn save(&self, record: &ComputerRecord) -> Result<(), FakeError> {
        self.0
            .lock()
            .unwrap()
            .insert(record.computer_id, record.clone());
        Ok(())
    }
    async fn delete(&self, computer_id: ComputerId) -> Result<(), FakeError> {
        self.0.lock().unwrap().remove(&computer_id);
        Ok(())
    }
    async fn load_staged(
        &self,
        _computer_id: ComputerId,
    ) -> Result<Option<ComputerRecord>, FakeError> {
        Ok(None)
    }
    async fn load_host_limits(&self) -> Result<Option<HostLimits>, FakeError> {
        Ok(None)
    }
    async fn save_host_limits(&self, _: &HostLimits) -> Result<(), FakeError> {
        Ok(())
    }
}

#[derive(Clone, Default)]
pub(super) struct FakeDisks(Arc<Mutex<Vec<String>>>);

impl Disks for FakeDisks {
    type Err = FakeError;
    async fn prepare(&self, record: &ComputerRecord) -> Result<ComputerDisks, FakeError> {
        self.0
            .lock()
            .unwrap()
            .push(format!("prepare {}", record.computer_id));
        Ok(ComputerDisks {
            rootfs: DriveBacking::File("/rootfs".into()),
            home: DriveBacking::File("/home".into()),
        })
    }
    async fn create_golden_rootfs(&self, _key: &GoldenKey) -> Result<DriveBacking, FakeError> {
        Ok(DriveBacking::File("/golden".into()))
    }
    async fn seal_golden_rootfs(&self, _key: &GoldenKey) -> Result<(), FakeError> {
        Ok(())
    }
    fn golden_rootfs_present(&self, _key: &GoldenKey) -> bool {
        true
    }
    async fn refill_spares(&self, _: &[GoldenKey], _: &[u32]) -> Result<(), FakeError> {
        Ok(())
    }
    async fn prepare_home_templates(&self, _: &[GoldenKey], _: &[u32]) -> Result<(), FakeError> {
        Ok(())
    }
    fn home_templates_ready(&self, _: &[GoldenKey], _: &[u32]) -> bool {
        true
    }
    fn backend(&self) -> DiskBackend {
        DiskBackend::XfsReflink
    }
    async fn collect_garbage(&self) -> Result<(), FakeError> {
        Ok(())
    }
    async fn delete(&self, computer_id: ComputerId) -> Result<(), FakeError> {
        self.0.lock().unwrap().push(format!("delete {computer_id}"));
        Ok(())
    }
}

#[derive(Clone)]
pub(super) struct FakeGoldens(
    pub(super) Arc<Mutex<GoldenAvailability>>,
    pub(super) Arc<Mutex<Vec<GoldenKey>>>,
);

impl Goldens for FakeGoldens {
    fn availability(&self, _key: &GoldenKey) -> GoldenAvailability {
        self.0.lock().unwrap().clone()
    }
    fn build(&self, key: GoldenKey) {
        self.1.lock().unwrap().push(key);
    }
    fn list(&self) -> Vec<GoldenImage> {
        Vec::new()
    }
    fn images(&self) -> Vec<GuestImage> {
        Vec::new()
    }
}

/// A launch's source and the enrollment its MMDS document carried.
pub(super) type Launch = (BootSource, Option<EnrollmentDocument>);

/// Processes as pids in a set; `launches` records each launch's source and
/// the enrollment its MMDS document carried.
#[derive(Clone, Default)]
pub(super) struct FakeMachines {
    pub(super) alive: Arc<Mutex<std::collections::HashSet<i32>>>,
    next_pid: Arc<Mutex<i32>>,
    pub(super) launches: Arc<Mutex<Vec<Launch>>>,
    pub(super) hibernations: Arc<Mutex<std::collections::HashSet<ComputerId>>>,
    /// Jails on the host; a launch adds its computer's, a kill removes it.
    pub(super) jails: Arc<Mutex<std::collections::HashSet<Jail>>>,
    /// The process running in each jail; removing the jail ends it.
    pub(super) jail_processes: Arc<Mutex<HashMap<Jail, i32>>>,
    /// What every program run in a guest exits with.
    guest_exit: Arc<Mutex<i32>>,
    /// Programs run in guests, in order.
    pub(super) guest_runs: Arc<Mutex<Vec<String>>>,
    /// Each computer's cgroup `usage_usec` and `memory.current`; a
    /// computer without one has no readable usage.
    pub(super) usage: Arc<Mutex<HashMap<ComputerId, Usage>>>,
    /// The `cpu.weight` last written per computer.
    pub(super) weights: Arc<Mutex<HashMap<ComputerId, u16>>>,
    /// Computers whose memory was reclaimed, in order.
    pub(super) reclaims: Arc<Mutex<Vec<ComputerId>>>,
    /// Every `memory.swap.max` write.
    pub(super) guest_swap: Arc<Mutex<Vec<GuestSwap>>>,
}

impl Machines for FakeMachines {
    type Err = FakeError;
    type GuestStream = tokio::io::DuplexStream;

    async fn launch(
        &self,
        record: &ComputerRecord,
        slot: Slot,
        source: BootSource,
        _disks: &ComputerDisks,
        document: &Document,
    ) -> Result<Launched, FakeError> {
        let mut next = self.next_pid.lock().unwrap();
        *next += 1;
        self.jails
            .lock()
            .unwrap()
            .insert(Jail::Computer(record.computer_id));
        self.jail_processes
            .lock()
            .unwrap()
            .insert(Jail::Computer(record.computer_id), *next);
        self.alive.lock().unwrap().insert(*next);
        self.launches
            .lock()
            .unwrap()
            .push((source, document.macro_data.enrollment.clone()));
        Ok(Launched {
            process: Process { slot, pid: *next },
            phases: LaunchPhases::default(),
        })
    }
    async fn pause(&self, _: &ComputerRecord, _: Process) -> Result<(), FakeError> {
        Ok(())
    }
    async fn resume(&self, _: &ComputerRecord, _: Process, _: &Document) -> Result<(), FakeError> {
        Ok(())
    }
    async fn put_mmds(
        &self,
        _: &ComputerRecord,
        _: Process,
        _: &Document,
    ) -> Result<(), FakeError> {
        Ok(())
    }
    async fn shutdown(&self, record: &ComputerRecord, process: Process) -> Result<(), FakeError> {
        self.alive.lock().unwrap().remove(&process.pid);
        self.jails
            .lock()
            .unwrap()
            .remove(&Jail::Computer(record.computer_id));
        Ok(())
    }
    async fn hibernate(&self, record: &ComputerRecord, process: Process) -> Result<(), FakeError> {
        self.alive.lock().unwrap().remove(&process.pid);
        self.hibernations.lock().unwrap().insert(record.computer_id);
        self.jails
            .lock()
            .unwrap()
            .remove(&Jail::Computer(record.computer_id));
        Ok(())
    }
    async fn kill(&self, record: &ComputerRecord, process: Process) -> Result<(), FakeError> {
        self.alive.lock().unwrap().remove(&process.pid);
        self.jails
            .lock()
            .unwrap()
            .remove(&Jail::Computer(record.computer_id));
        Ok(())
    }
    fn jails(&self) -> Result<Vec<Jail>, FakeError> {
        Ok(self.jails.lock().unwrap().iter().cloned().collect())
    }
    async fn remove_jail(&self, jail: &Jail) -> Result<(), FakeError> {
        self.jails.lock().unwrap().remove(jail);
        if let Some(pid) = self.jail_processes.lock().unwrap().remove(jail) {
            self.alive.lock().unwrap().remove(&pid);
        }
        Ok(())
    }
    fn has_hibernation(&self, computer_id: ComputerId) -> bool {
        self.hibernations.lock().unwrap().contains(&computer_id)
    }
    async fn discard_hibernation(&self, computer_id: ComputerId) -> Result<(), FakeError> {
        self.hibernations.lock().unwrap().remove(&computer_id);
        Ok(())
    }
    fn alive(&self, _: &ComputerRecord, process: Process) -> bool {
        self.alive.lock().unwrap().contains(&process.pid)
    }
    async fn set_guest_memory_max(&self, _: u64) -> Result<(), FakeError> {
        Ok(())
    }
    async fn set_guest_swap(&self, swap: GuestSwap) -> Result<(), FakeError> {
        self.guest_swap.lock().unwrap().push(swap);
        Ok(())
    }
    fn usage(&self, record: &ComputerRecord, _: Process) -> Option<Usage> {
        self.usage.lock().unwrap().get(&record.computer_id).copied()
    }
    fn set_cpu_weight(
        &self,
        record: &ComputerRecord,
        _: Process,
        weight: u16,
    ) -> Result<(), FakeError> {
        self.weights
            .lock()
            .unwrap()
            .insert(record.computer_id, weight);
        Ok(())
    }
    /// Halves the computer's resident memory.
    async fn reclaim_memory(
        &self,
        record: &ComputerRecord,
        _: Process,
        _bytes: u64,
    ) -> Result<u64, FakeError> {
        self.reclaims.lock().unwrap().push(record.computer_id);
        let mut usage = self.usage.lock().unwrap();
        let usage = usage.get_mut(&record.computer_id).ok_or(FakeError)?;
        let reclaimed = usage.resident_memory_bytes / 2;
        usage.resident_memory_bytes -= reclaimed;
        Ok(reclaimed)
    }
    async fn run_as_root(
        &self,
        _: &ComputerRecord,
        _: Process,
        argv: &[&str],
    ) -> Result<i32, FakeError> {
        self.guest_runs.lock().unwrap().push(argv.join(" "));
        Ok(*self.guest_exit.lock().unwrap())
    }
    /// A guest agent that exits 0 for anything it is asked to run.
    async fn connect_guest(
        &self,
        _: &ComputerRecord,
        _: Process,
    ) -> Result<tokio::io::DuplexStream, FakeError> {
        let (host, mut guest) = tokio::io::duplex(4096);
        let exit = *self.guest_exit.lock().unwrap();
        let runs = self.guest_runs.clone();
        tokio::spawn(async move {
            use firecracker_host_api::exec::{Frame, read_frame, write_frame};
            while let Ok(Some(frame)) = read_frame(&mut guest).await {
                match frame {
                    Frame::Start(request) => runs.lock().unwrap().push(request.argv.join(" ")),
                    Frame::CloseStdin => {
                        let _ = write_frame(&mut guest, &Frame::Exited(exit)).await;
                    }
                    _ => {}
                }
            }
        });
        Ok(host)
    }
}

/// A 128 GiB host with as much memory in use, and as many disk swap
/// devices, as the test sets (none unless set).
#[derive(Clone)]
pub(super) struct FakeProbe(
    pub(super) Arc<Mutex<u64>>,
    pub(super) Arc<Mutex<SwapPlacement>>,
);

impl Default for FakeProbe {
    fn default() -> Self {
        Self(Arc::default(), Arc::new(Mutex::new(SwapPlacement::RamOnly)))
    }
}

impl HostProbe for FakeProbe {
    fn measure(&self) -> HostMeasurement {
        let total = 128 * 1024 * 1024 * 1024;
        HostMeasurement {
            memory_total_bytes: total,
            memory_available_bytes: total - *self.0.lock().unwrap(),
            swap_placement: *self.1.lock().unwrap(),
            ..HostMeasurement::default()
        }
    }
}

pub(super) struct Host {
    pub(super) store: FakeStore,
    pub(super) machines: FakeMachines,
    pub(super) goldens: FakeGoldens,
    pub(super) probe: FakeProbe,
    pub(super) service:
        Arc<HostService<FakeStore, FakeDisks, FakeGoldens, FakeMachines, FakeProbe>>,
}

pub(super) async fn host_with(store: FakeStore, machines: FakeMachines, slots: u16) -> Host {
    let goldens = FakeGoldens(
        Arc::new(Mutex::new(GoldenAvailability::Ready)),
        Arc::new(Mutex::new(Vec::new())),
    );
    let probe = FakeProbe::default();
    let service = HostService::start(
        store.clone(),
        FakeDisks::default(),
        goldens.clone(),
        machines.clone(),
        probe.clone(),
        ServiceSettings {
            host_name: "test-host".to_owned(),
            firecracker_version: "v1.18.0".to_owned(),
            agent_version: None,
            dns: vec!["1.1.1.1".to_owned()],
            concurrent_launches: 2,
            slot_count: slots,
            move_address: None,
        },
        tokio_util::task::TaskTracker::new(),
    )
    .await
    .unwrap();
    let service = Arc::new(service);
    Host {
        store,
        machines,
        goldens,
        probe,
        service,
    }
}

pub(super) fn computer_id() -> ComputerId {
    ComputerId::new_from_uuid(Uuid::from_u128(7))
}

pub(super) fn create_request(generation: u32, start: bool) -> CreateComputer {
    CreateComputer {
        control_plane_id: ControlPlaneId::try_new("dev").unwrap(),
        generation: EnrollmentGeneration::new(generation),
        pairing_id: PairingId::new_from_uuid(Uuid::from_u128(9)),
        image: GuestImage::try_new("macro-box/2026-11-17").unwrap(),
        role: firecracker_host_api::ComputerRole::Person,
        resources: ComputerResources {
            vcpus: 2,
            memory_mib: 2048,
            root_disk_gib: 20,
            home_disk_gib: 80,
        },
        enrollment: EnrollmentDocument(serde_json::json!({ "device_secret": "secret" })),
        start,
        return_when_resumed: false,
    }
}

#[tokio::test]
async fn a_repeated_create_answers_the_same_computer_without_a_second_restore() {
    let host = host_with(FakeStore::default(), FakeMachines::default(), 4).await;

    let first = host
        .service
        .create(computer_id(), create_request(1, true))
        .await
        .unwrap();
    let second = host
        .service
        .create(computer_id(), create_request(1, true))
        .await
        .unwrap();

    assert_eq!(first.state, PowerState::Running);
    assert_eq!(second, first);
    let launches = host.machines.launches.lock().unwrap().clone();
    assert_eq!(
        launches,
        vec![(
            BootSource::Golden,
            Some(EnrollmentDocument(
                serde_json::json!({ "device_secret": "secret" })
            ))
        )]
    );
}

#[tokio::test]
async fn a_create_for_another_generation_is_refused() {
    let host = host_with(FakeStore::default(), FakeMachines::default(), 4).await;
    host.service
        .create(computer_id(), create_request(1, true))
        .await
        .unwrap();

    let error = host
        .service
        .create(computer_id(), create_request(2, true))
        .await
        .unwrap_err();

    assert_eq!(error.code(), ErrorCode::GenerationMismatch);
}

#[tokio::test]
async fn a_missing_golden_starts_its_build_and_asks_for_a_retry() {
    let host = host_with(FakeStore::default(), FakeMachines::default(), 4).await;
    *host.goldens.0.lock().unwrap() = GoldenAvailability::Absent;

    let error = host
        .service
        .create(computer_id(), create_request(1, true))
        .await
        .unwrap_err();

    assert!(matches!(error, HostError::GoldenNotReady(_)), "{error}");
    assert_eq!(
        host.goldens.1.lock().unwrap().clone(),
        vec![GoldenKey {
            image: GuestImage::try_new("macro-box/2026-11-17").unwrap(),
            vcpus: 2,
            memory_mib: 2048
        }]
    );
    assert_eq!(
        host.service.get(computer_id()).await.unwrap_err().code(),
        ErrorCode::NotFound
    );
}

#[tokio::test]
async fn a_computer_created_stopped_restores_the_golden_on_its_first_start_and_cold_boots_after() {
    let host = host_with(FakeStore::default(), FakeMachines::default(), 4).await;
    host.service
        .create(computer_id(), create_request(1, false))
        .await
        .unwrap();

    host.service
        .power(computer_id(), Action::Start)
        .await
        .unwrap();
    host.service
        .power(computer_id(), Action::Restart)
        .await
        .unwrap();

    let sources: Vec<BootSource> = host
        .machines
        .launches
        .lock()
        .unwrap()
        .iter()
        .map(|(source, _)| *source)
        .collect();
    assert_eq!(sources, vec![BootSource::Golden, BootSource::ColdBoot]);
}

#[tokio::test]
async fn hibernation_frees_the_slot_and_start_wakes_from_the_snapshot() {
    let host = host_with(FakeStore::default(), FakeMachines::default(), 1).await;
    host.service
        .create(computer_id(), create_request(1, true))
        .await
        .unwrap();

    let hibernated = host
        .service
        .power(computer_id(), Action::Hibernate)
        .await
        .unwrap();
    assert_eq!(hibernated.state, PowerState::Hibernated);
    assert_eq!(host.service.host().network_slots.free, 1);

    let woken = host
        .service
        .power(computer_id(), Action::Start)
        .await
        .unwrap();
    assert_eq!(woken.state, PowerState::Running);
    assert_eq!(
        host.machines.launches.lock().unwrap()[1].0,
        BootSource::Hibernation
    );
    assert!(!host.machines.has_hibernation(computer_id()));
}

#[tokio::test]
async fn the_last_slot_taken_refuses_another_boot_until_one_stops() {
    let host = host_with(FakeStore::default(), FakeMachines::default(), 1).await;
    let other = ComputerId::new_from_uuid(Uuid::from_u128(8));
    host.service
        .create(computer_id(), create_request(1, true))
        .await
        .unwrap();

    let refused = host
        .service
        .create(other, create_request(1, true))
        .await
        .unwrap_err();
    assert_eq!(refused.code(), ErrorCode::NoNetworkSlot);
    // The computer exists, stopped: the retry is a start.
    assert_eq!(
        host.service.get(other).await.unwrap().state,
        PowerState::Stopped
    );

    host.service
        .power(computer_id(), Action::Stop)
        .await
        .unwrap();
    let started = host.service.power(other, Action::Start).await.unwrap();
    assert_eq!(started.state, PowerState::Running);
}

#[tokio::test]
async fn after_a_host_stop_running_and_hibernated_computers_come_back_stopped() {
    let store = FakeStore::default();
    let running = ComputerId::new_from_uuid(Uuid::from_u128(1));
    let hibernated = ComputerId::new_from_uuid(Uuid::from_u128(2));
    for (computer_id, state, process) in [
        (
            running,
            PowerState::Running,
            Some(Process {
                slot: Slot(0),
                pid: 41,
            }),
        ),
        (hibernated, PowerState::Hibernated, None),
    ] {
        let mut record = ComputerRecord::new(computer_id, &create_request(1, true), Utc::now());
        record.state = state;
        record.process = process;
        record.rootfs_never_booted = false;
        store.save(&record).await.unwrap();
    }

    // No live pids and no hibernation files: the host lost them.
    let host = host_with(store, FakeMachines::default(), 1).await;

    assert_eq!(
        host.service.get(running).await.unwrap().state,
        PowerState::Stopped
    );
    assert_eq!(
        host.service.get(hibernated).await.unwrap().state,
        PowerState::Stopped
    );
    assert_eq!(host.service.host().network_slots.free, 1);
    host.service.power(running, Action::Start).await.unwrap();
    assert_eq!(
        host.machines.launches.lock().unwrap()[0].0,
        BootSource::ColdBoot
    );
}

#[tokio::test]
async fn an_agent_restart_keeps_a_live_process() {
    let store = FakeStore::default();
    let machines = FakeMachines::default();
    let mut record = ComputerRecord::new(computer_id(), &create_request(1, true), Utc::now());
    record.state = PowerState::Running;
    record.process = Some(Process {
        slot: Slot(0),
        pid: 41,
    });
    store.save(&record).await.unwrap();
    machines.alive.lock().unwrap().insert(41);

    let host = host_with(store, machines, 1).await;

    assert_eq!(
        host.service.get(computer_id()).await.unwrap().state,
        PowerState::Running
    );
    assert_eq!(host.service.host().network_slots.free, 0);
}

#[tokio::test]
async fn clearing_the_enrollment_keeps_it_out_of_later_boots() {
    let host = host_with(FakeStore::default(), FakeMachines::default(), 2).await;
    host.service
        .create(computer_id(), create_request(1, true))
        .await
        .unwrap();

    host.service.clear_enrollment(computer_id()).await.unwrap();
    host.service
        .power(computer_id(), Action::Restart)
        .await
        .unwrap();

    assert_eq!(host.machines.launches.lock().unwrap()[1].1, None);
    assert!(
        !host
            .service
            .get(computer_id())
            .await
            .unwrap()
            .enrollment_present
    );
}

#[tokio::test]
async fn destroy_deletes_everything_and_is_safe_to_repeat() {
    let host = host_with(FakeStore::default(), FakeMachines::default(), 1).await;
    host.service
        .create(computer_id(), create_request(1, true))
        .await
        .unwrap();

    host.service.destroy(computer_id()).await.unwrap();
    host.service.destroy(computer_id()).await.unwrap();

    assert!(host.store.0.lock().unwrap().is_empty());
    assert!(host.machines.alive.lock().unwrap().is_empty());
    assert_eq!(host.service.host().network_slots.free, 1);
    assert_eq!(
        host.service.get(computer_id()).await.unwrap_err().code(),
        ErrorCode::NotFound
    );
}

#[tokio::test]
async fn a_process_that_ended_on_its_own_reads_as_stopped() {
    let host = host_with(FakeStore::default(), FakeMachines::default(), 1).await;
    host.service
        .create(computer_id(), create_request(1, true))
        .await
        .unwrap();

    host.machines.alive.lock().unwrap().clear();

    assert_eq!(
        host.service.get(computer_id()).await.unwrap().state,
        PowerState::Stopped
    );
    assert_eq!(host.service.host().network_slots.free, 1);
}

#[tokio::test(start_paused = true)]
async fn a_failed_macro_restore_fails_the_create_and_the_retry_runs_it_again() {
    let host = host_with(FakeStore::default(), FakeMachines::default(), 1).await;
    *host.machines.guest_exit.lock().unwrap() = 1;

    let error = host
        .service
        .create(computer_id(), create_request(1, true))
        .await
        .unwrap_err();
    assert_eq!(error.code(), ErrorCode::GuestUnreachable);
    assert_eq!(
        host.service.get(computer_id()).await.unwrap().state,
        PowerState::Running
    );

    *host.machines.guest_exit.lock().unwrap() = 0;
    host.service
        .create(computer_id(), create_request(1, true))
        .await
        .unwrap();
    host.service
        .create(computer_id(), create_request(1, true))
        .await
        .unwrap();

    // Three attempts for the failed create, one for the retry.
    assert_eq!(
        host.machines.guest_runs.lock().unwrap().clone(),
        vec!["systemctl start macro-restore.service".to_owned(); 4]
    );
    assert_eq!(host.machines.launches.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn an_early_answer_comes_before_macro_restore_and_carries_the_launch_timings() {
    let host = host_with(FakeStore::default(), FakeMachines::default(), 1).await;
    let mut request = create_request(1, true);
    request.return_when_resumed = true;

    let computer = host.service.create(computer_id(), request).await.unwrap();

    assert_eq!(computer.state, PowerState::Running);
    assert!(computer.restore_pending);
    let timings = computer.last_launch.unwrap();
    assert_eq!(timings.source, firecracker_host_api::LaunchSource::Golden);
    assert!(timings.guest_agent_ms.is_some());
    assert_eq!(timings.macro_restore_ms, None);
}

#[tokio::test]
async fn a_creates_timings_add_up_to_its_whole_handler() {
    let host = host_with(FakeStore::default(), FakeMachines::default(), 1).await;

    let computer = host
        .service
        .create(computer_id(), create_request(1, true))
        .await
        .unwrap();

    let timings = computer.last_launch.unwrap();
    let phases = [
        timings.lock_wait_ms,
        timings.create_disks_ms,
        timings.create_record_ms,
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
        timings.other_ms,
    ];
    assert!(timings.lock_wait_ms.is_some() && timings.other_ms.is_some());
    assert_eq!(phases.into_iter().flatten().sum::<u64>(), timings.total_ms);
}

#[tokio::test]
async fn host_limits_refuse_a_squeeze_window_upside_down() {
    let host = host_with(FakeStore::default(), FakeMachines::default(), 1).await;
    let limits = HostLimits {
        guest_memory_max_bytes: 100,
        squeeze_above_bytes: Some(80),
        squeeze_below_bytes: Some(70),
        home_disk_gib: vec![20],
    };

    let refused = host.service.set_host_limits(limits).await;

    assert!(matches!(refused, Err(HostError::InvalidRequest(_))));
    assert_eq!(host.service.host().limits, None);
}
