//! One test per point an agent can die at: each sets up what the dead
//! agent left (records, live pids, jails, hibernation files) and starts a
//! new agent on it.

use chrono::Utc;
use firecracker_host_api::{Action, ComputerId, PowerState};
use uuid::Uuid;

use super::super::test::{FakeMachines, FakeStore, computer_id, create_request, host_with};
use crate::domain::health::HealthCheck;
use crate::domain::metrics::Repair;
use crate::domain::model::{ComputerRecord, Process, Slot};
use crate::domain::ports::{BootSource, Jail, Store};

/// A record of the test computer in `state`, booted once.
fn record(state: PowerState, process: Option<Process>) -> ComputerRecord {
    let mut record = ComputerRecord::new(computer_id(), &create_request(1, true), Utc::now());
    record.state = state;
    record.process = process;
    record.rootfs_never_booted = false;
    record.start_pending = false;
    record
}

const PROCESS: Process = Process {
    slot: Slot(0),
    pid: 41,
};

/// A Firecracker process that survived the agent, with its jail.
fn survivor(machines: &FakeMachines, computer_id: ComputerId, pid: i32) {
    machines.alive.lock().unwrap().insert(pid);
    machines
        .jails
        .lock()
        .unwrap()
        .insert(Jail::Computer(computer_id));
    machines
        .jail_processes
        .lock()
        .unwrap()
        .insert(Jail::Computer(computer_id), pid);
}

async fn saved(store: &FakeStore, record: &ComputerRecord) {
    store.save(record).await.unwrap();
}

#[tokio::test]
async fn killed_during_the_creates_launch_the_orphan_goes_and_a_repeated_create_boots() {
    // The record was saved stopped with the start pending, and the jailer
    // had started a process the record never learned about.
    let store = FakeStore::default();
    let machines = FakeMachines::default();
    let created = ComputerRecord::new(computer_id(), &create_request(1, true), Utc::now());
    saved(&store, &created).await;
    survivor(&machines, computer_id(), 41);

    let host = host_with(store, machines, 1).await;

    assert!(host.machines.jails.lock().unwrap().is_empty());
    assert_eq!(host.service.host().network_slots.free, 1);
    let computer = host
        .service
        .create(computer_id(), create_request(1, true))
        .await
        .unwrap();
    assert_eq!(computer.state, PowerState::Running);
    assert_eq!(
        host.machines.launches.lock().unwrap()[0].0,
        BootSource::Golden
    );
}

#[tokio::test]
async fn a_repeated_create_after_a_stop_does_not_boot_again() {
    let host = host_with(FakeStore::default(), FakeMachines::default(), 1).await;
    host.service
        .create(computer_id(), create_request(1, true))
        .await
        .unwrap();
    host.service
        .power(computer_id(), Action::Stop)
        .await
        .unwrap();

    let computer = host
        .service
        .create(computer_id(), create_request(1, true))
        .await
        .unwrap();

    assert_eq!(computer.state, PowerState::Stopped);
    assert_eq!(host.machines.launches.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn killed_during_macro_restore_the_new_agent_adopts_the_vm_and_finishes_it() {
    let store = FakeStore::default();
    let machines = FakeMachines::default();
    let mut running = record(PowerState::Running, Some(PROCESS));
    running.guest_restore_pending = true;
    saved(&store, &running).await;
    survivor(&machines, computer_id(), 41);

    let host = host_with(store, machines, 1).await;
    for restore in host.service.resume_pending_restores() {
        restore.await.unwrap();
    }

    let computer = host.service.get(computer_id()).await.unwrap();
    assert_eq!(computer.state, PowerState::Running);
    assert!(!computer.restore_pending);
    assert_eq!(
        *host.machines.guest_runs.lock().unwrap(),
        vec!["systemctl start macro-restore.service".to_owned()]
    );
    assert_eq!(host.service.host().network_slots.free, 0);
}

#[tokio::test]
async fn killed_before_the_snapshot_the_vm_stays_paused_and_a_retry_hibernates() {
    let store = FakeStore::default();
    let machines = FakeMachines::default();
    let mut paused = record(PowerState::Paused, Some(PROCESS));
    paused.hibernating = true;
    saved(&store, &paused).await;
    survivor(&machines, computer_id(), 41);

    let host = host_with(store, machines, 1).await;

    let computer = host.service.get(computer_id()).await.unwrap();
    assert_eq!(computer.state, PowerState::Paused);
    assert!(!host.store.0.lock().unwrap()[&computer_id()].hibernating);
    let computer = host
        .service
        .power(computer_id(), Action::Hibernate)
        .await
        .unwrap();
    assert_eq!(computer.state, PowerState::Hibernated);
}

#[tokio::test]
async fn killed_after_publishing_the_snapshot_the_hibernation_is_finished() {
    // The snapshot is whole and published; the process still runs.
    let store = FakeStore::default();
    let machines = FakeMachines::default();
    let mut paused = record(PowerState::Paused, Some(PROCESS));
    paused.hibernating = true;
    saved(&store, &paused).await;
    survivor(&machines, computer_id(), 41);
    machines.hibernations.lock().unwrap().insert(computer_id());

    let host = host_with(store, machines, 1).await;

    assert_eq!(
        host.service.get(computer_id()).await.unwrap().state,
        PowerState::Hibernated
    );
    assert!(host.machines.alive.lock().unwrap().is_empty());
    assert!(host.machines.jails.lock().unwrap().is_empty());
    assert_eq!(host.service.host().network_slots.free, 1);
    host.service
        .power(computer_id(), Action::Start)
        .await
        .unwrap();
    assert_eq!(
        host.machines.launches.lock().unwrap()[0].0,
        BootSource::Hibernation
    );
}

#[tokio::test]
async fn killed_after_the_vm_ended_the_hibernation_is_finished() {
    let store = FakeStore::default();
    let machines = FakeMachines::default();
    let mut paused = record(PowerState::Paused, Some(PROCESS));
    paused.hibernating = true;
    saved(&store, &paused).await;
    machines.hibernations.lock().unwrap().insert(computer_id());

    let host = host_with(store, machines, 1).await;

    let saved = host.store.0.lock().unwrap()[&computer_id()].clone();
    assert_eq!(saved.state, PowerState::Hibernated);
    assert_eq!(saved.process, None);
    assert!(!saved.hibernating);
}

#[tokio::test]
async fn a_paused_vm_that_was_not_hibernating_and_died_is_stopped() {
    let store = FakeStore::default();
    saved(&store, &record(PowerState::Paused, Some(PROCESS))).await;

    let host = host_with(store, FakeMachines::default(), 1).await;

    assert_eq!(
        host.service.get(computer_id()).await.unwrap().state,
        PowerState::Stopped
    );
}

#[tokio::test]
async fn killed_before_a_wake_discarded_the_snapshot_the_stale_one_is_deleted() {
    // The woken guest ran since: its old memory must never be restored.
    let store = FakeStore::default();
    let machines = FakeMachines::default();
    saved(&store, &record(PowerState::Running, Some(PROCESS))).await;
    survivor(&machines, computer_id(), 41);
    machines.hibernations.lock().unwrap().insert(computer_id());

    let host = host_with(store, machines, 1).await;

    assert!(host.machines.hibernations.lock().unwrap().is_empty());
    assert_eq!(
        host.service.get(computer_id()).await.unwrap().state,
        PowerState::Running
    );
}

#[tokio::test]
async fn killed_during_a_wakes_launch_the_orphan_goes_and_the_computer_stays_hibernated() {
    let store = FakeStore::default();
    let machines = FakeMachines::default();
    saved(&store, &record(PowerState::Hibernated, None)).await;
    survivor(&machines, computer_id(), 41);
    machines.hibernations.lock().unwrap().insert(computer_id());

    let host = host_with(store, machines, 1).await;

    assert!(host.machines.jails.lock().unwrap().is_empty());
    assert!(host.machines.alive.lock().unwrap().is_empty());
    assert_eq!(
        host.service.get(computer_id()).await.unwrap().state,
        PowerState::Hibernated
    );
}

#[tokio::test]
async fn a_golden_build_cut_short_leaves_no_jail() {
    let machines = FakeMachines::default();
    machines.jails.lock().unwrap().insert(Jail::Golden);

    let host = host_with(FakeStore::default(), machines, 1).await;

    assert!(host.machines.jails.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_unrecognized_jail_is_left_alone_and_fails_the_reconcile_check() {
    let machines = FakeMachines::default();
    let stranger = Jail::Unrecognized("someone-else".to_owned());
    machines.jails.lock().unwrap().insert(stranger.clone());

    let host = host_with(FakeStore::default(), machines, 1).await;

    assert!(host.machines.jails.lock().unwrap().contains(&stranger));
    let reconcile = host
        .service
        .service_checks()
        .into_iter()
        .find(|check| check.check == HealthCheck::Reconcile)
        .unwrap();
    assert!(!reconcile.healthy);

    // Fixed by hand: the next pass clears the check.
    host.machines.jails.lock().unwrap().clear();
    let report = host.service.reconcile_pass().await;
    assert!(report.unresolved.is_empty());
    assert!(
        host.service
            .service_checks()
            .iter()
            .all(|check| check.check != HealthCheck::Reconcile || check.healthy)
    );
}

#[tokio::test]
async fn a_pass_stops_a_computer_whose_process_ended_and_frees_its_slot() {
    let host = host_with(FakeStore::default(), FakeMachines::default(), 1).await;
    host.service
        .create(computer_id(), create_request(1, true))
        .await
        .unwrap();
    assert_eq!(host.service.host().network_slots.free, 0);
    host.machines.alive.lock().unwrap().clear();

    let report = host.service.reconcile_pass().await;

    assert_eq!(report.repairs, vec![Repair::ProcessEnded]);
    assert_eq!(
        host.store.0.lock().unwrap()[&computer_id()].state,
        PowerState::Stopped
    );
    assert_eq!(host.service.host().network_slots.free, 1);
    assert!(host.machines.jails.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_pass_removes_a_jail_no_record_holds_but_skips_a_busy_computer() {
    let host = host_with(FakeStore::default(), FakeMachines::default(), 2).await;
    let stray = ComputerId::new_from_uuid(Uuid::from_u128(99));
    survivor(&host.machines, stray, 77);

    let report = host.service.reconcile_pass().await;
    assert_eq!(report.repairs, vec![Repair::OrphanJailRemoved]);
    assert!(host.machines.jails.lock().unwrap().is_empty());

    // A computer mid-operation holds its lock: its jail is left alone.
    survivor(&host.machines, computer_id(), 78);
    let entry = host.service.entry(computer_id());
    let guard = entry.lock().await;
    let report = host.service.reconcile_pass().await;
    assert!(report.repairs.is_empty());
    assert!(
        host.machines
            .jails
            .lock()
            .unwrap()
            .contains(&Jail::Computer(computer_id()))
    );
    drop(guard);
}
