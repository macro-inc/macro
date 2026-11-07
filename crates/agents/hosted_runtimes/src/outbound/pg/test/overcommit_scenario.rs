//! Overcommit end to end on Postgres: three simulated Firecracker hosts, a
//! burst of purchases spread over them, memory pressure on one, relief
//! hibernating its idlest computers (never one in use), wakes, and a wake
//! storm through the host's bounded queue.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use crate::domain::enrollment::EnrollmentGeneration;
use crate::domain::fakes::{FakeSetupNotices, FixedDeployment, MovingClock};
use crate::domain::image::GuestImage;
use crate::domain::models::{ControlPlaneId, HostName, HostRecord};
use crate::domain::operator::{ComputerOperator, Wake};
use crate::domain::overcommit::telemetry::WakeReason;
use crate::domain::ports::{
    ComputersInUse, ComputersInUseFuture, DefaultAgent, Fleet, FleetEnrollment, FleetError,
    FleetHandle, FleetInstance, Fleets, GuestProcess, GuestUsage, Harnesses, HostLimitsState,
    HostMemory, HostedPairing, InstanceStatus, OvercommitRepo,
};
use crate::domain::service::Clock;

use super::*;

const GIB: u64 = 1024;
/// Each simulated host: 32 vCPUs, 64 GiB.
const HOST_VCPUS: u32 = 32;
const HOST_MEMORY_GB: u32 = 64;
/// What a simulated host uses for itself.
const HOST_BASE_MIB: u64 = 4 * GIB;

#[derive(Debug, thiserror::Error)]
#[error("the simulated host does not do that")]
struct SimError;

impl FleetError for SimError {
    fn is_missing(&self) -> bool {
        false
    }

    fn is_permanent(&self) -> bool {
        true
    }
}

#[derive(Debug, Clone, Copy)]
struct SimGuest {
    private_mib: u64,
    cpu_usage_microseconds: u64,
    hibernated: bool,
}

#[derive(Default)]
struct SimState {
    /// In the order they started.
    guests: Vec<(ComputerId, SimGuest)>,
    limits: Option<crate::domain::overcommit::HostAgentLimits>,
    hibernated: Vec<ComputerId>,
    woken: Vec<ComputerId>,
    /// Wakes restoring now, and the most at once.
    restoring: u32,
    most_restoring: u32,
}

/// One Firecracker host, in memory. Wakes wait on `restore_gate` when set,
/// so a test can hold a storm of them in flight.
struct SimHost {
    name: &'static str,
    clock: Arc<MovingClock>,
    state: Mutex<SimState>,
    restore_gate: Option<Arc<tokio::sync::Semaphore>>,
    restoring: tokio::sync::watch::Sender<u32>,
}

impl SimHost {
    fn new(name: &'static str, clock: &Arc<MovingClock>) -> Arc<Self> {
        Arc::new(Self {
            name,
            clock: Arc::clone(clock),
            state: Mutex::default(),
            restore_gate: None,
            restoring: tokio::sync::watch::Sender::new(0),
        })
    }

    fn gated(name: &'static str, clock: &Arc<MovingClock>) -> Arc<Self> {
        Arc::new(Self {
            restore_gate: Some(Arc::new(tokio::sync::Semaphore::new(0))),
            ..Arc::into_inner(Self::new(name, clock)).unwrap()
        })
    }

    /// A guest the effect worker started, holding `private_mib`.
    fn run(&self, computer_id: ComputerId, private_mib: u64) {
        self.state.lock().unwrap().guests.push((
            computer_id,
            SimGuest {
                private_mib,
                cpu_usage_microseconds: 0,
                hibernated: false,
            },
        ));
    }

    /// Every running guest grows to `private_mib` and spends `cpu_seconds`.
    fn grow(&self, private_mib: u64, cpu_seconds: u64) {
        for (_, guest) in &mut self.state.lock().unwrap().guests {
            if !guest.hibernated {
                guest.private_mib = private_mib;
                guest.cpu_usage_microseconds += cpu_seconds * 1_000_000;
            }
        }
    }

    fn running(&self) -> usize {
        self.state
            .lock()
            .unwrap()
            .guests
            .iter()
            .filter(|(_, guest)| !guest.hibernated)
            .count()
    }
}

static CONTROL_PLANE: std::sync::LazyLock<ControlPlaneId> =
    std::sync::LazyLock::new(|| ControlPlaneId::try_new("overcommit-test").unwrap());

impl Fleet for SimHost {
    type Err = SimError;

    fn control_plane_id(&self) -> &ControlPlaneId {
        &CONTROL_PLANE
    }

    async fn create(
        &self,
        _computer: &Computer,
        _generation: EnrollmentGeneration,
        _enrollment: &impl FleetEnrollment,
        _start: bool,
    ) -> Result<GuestImage, SimError> {
        Err(SimError)
    }

    async fn start(&self, computer_id: ComputerId) -> Result<(), SimError> {
        {
            let mut state = self.state.lock().unwrap();
            state.restoring += 1;
            state.most_restoring = state.most_restoring.max(state.restoring);
            self.restoring.send_replace(state.restoring);
        }
        if let Some(gate) = &self.restore_gate {
            gate.acquire().await.unwrap().forget();
        }
        let mut state = self.state.lock().unwrap();
        state.restoring -= 1;
        self.restoring.send_replace(state.restoring);
        let (_, guest) = state
            .guests
            .iter_mut()
            .find(|(id, _)| *id == computer_id)
            .ok_or(SimError)?;
        guest.hibernated = false;
        state.woken.push(computer_id);
        Ok(())
    }

    async fn stop(&self, _computer_id: ComputerId) -> Result<(), SimError> {
        Err(SimError)
    }

    async fn restart(&self, _computer_id: ComputerId) -> Result<(), SimError> {
        Err(SimError)
    }

    async fn restart_macrod(&self, _computer_id: ComputerId) -> Result<(), SimError> {
        Err(SimError)
    }

    async fn destroy(&self, _computer_id: ComputerId) -> Result<(), SimError> {
        Err(SimError)
    }

    async fn clear_enrollment(&self, _computer_id: ComputerId) -> Result<(), SimError> {
        Err(SimError)
    }

    async fn resources_match(&self, _computer: &Computer) -> Result<bool, SimError> {
        Ok(true)
    }

    async fn instances(&self) -> Result<Vec<FleetInstance>, SimError> {
        Ok(self
            .state
            .lock()
            .unwrap()
            .guests
            .iter()
            .map(|(computer_id, _)| FleetInstance {
                computer_id: *computer_id,
                status: InstanceStatus::Running,
                control_plane_id: CONTROL_PLANE.clone(),
                created_at: Some(now()),
            })
            .collect())
    }

    async fn host(&self) -> Result<HostRegistration, SimError> {
        Ok(HostRegistration {
            name: HostName::try_new(self.name).unwrap(),
            vcpus: HOST_VCPUS,
            memory_gb: HOST_MEMORY_GB,
        })
    }

    async fn memory(&self) -> Result<HostMemory, SimError> {
        let state = self.state.lock().unwrap();
        let guests_mib: u64 = state
            .guests
            .iter()
            .filter(|(_, guest)| !guest.hibernated)
            .map(|(_, guest)| guest.private_mib)
            .sum();
        Ok(HostMemory {
            report: crate::domain::overcommit::MemoryReport {
                resident_memory_mib: HOST_BASE_MIB + guests_mib,
                reported_at: self.clock.now(),
            },
            limits: HostLimitsState::Enforced(state.limits.clone()),
            guests: state
                .guests
                .iter()
                .map(|(computer_id, guest)| GuestUsage {
                    computer_id: *computer_id,
                    hibernated: guest.hibernated,
                    private_memory_bytes: (!guest.hibernated)
                        .then_some(guest.private_mib * 1024 * 1024),
                    swap_bytes: (!guest.hibernated).then_some(0),
                    cpu_usage_microseconds: (!guest.hibernated)
                        .then_some(guest.cpu_usage_microseconds),
                })
                .collect(),
        })
    }

    async fn set_host_limits(
        &self,
        limits: crate::domain::overcommit::HostAgentLimits,
    ) -> Result<(), SimError> {
        self.state.lock().unwrap().limits = Some(limits);
        Ok(())
    }

    async fn hibernate(&self, computer_id: ComputerId) -> Result<(), SimError> {
        let mut state = self.state.lock().unwrap();
        state
            .guests
            .iter_mut()
            .find(|(id, _)| *id == computer_id)
            .ok_or(SimError)?
            .1
            .hibernated = true;
        state.hibernated.push(computer_id);
        Ok(())
    }

    async fn exec(
        &self,
        _computer_id: ComputerId,
        _argv: &[&str],
    ) -> Result<GuestProcess<SimError>, SimError> {
        Err(SimError)
    }
}

/// `a` is the home host; `b` and `c` are host rows.
struct SimFleets {
    a: Arc<SimHost>,
    b: Arc<SimHost>,
    c: Arc<SimHost>,
}

impl SimFleets {
    fn by_name(&self, name: &str) -> &Arc<SimHost> {
        match name {
            "sim-a" => &self.a,
            "sim-b" => &self.b,
            _ => &self.c,
        }
    }
}

impl Fleets for SimFleets {
    type Fleet = SimHost;
    type Err = std::convert::Infallible;

    fn home(&self) -> Option<&SimHost> {
        Some(&self.a)
    }

    fn drives(&self, host: &HostRecord) -> bool {
        matches!(host.name.as_str(), "sim-b" | "sim-c")
    }

    fn fleet(&self, host: &HostRecord) -> Result<FleetHandle<'_, SimHost>, Self::Err> {
        Ok(FleetHandle::Host(Arc::clone(
            self.by_name(host.name.as_str()),
        )))
    }
}

/// No computer in this scenario pairs a harness.
struct NoHarnesses;

impl Harnesses for NoHarnesses {
    type Err = FakeStorage;

    async fn create_hosted_pairing(
        &self,
        _computer: &Computer,
    ) -> Result<HostedPairing, FakeStorage> {
        Err(FakeStorage)
    }

    async fn pairing_claimed(
        &self,
        _pairing_id: crate::domain::ids::PairingId,
    ) -> Result<bool, FakeStorage> {
        Err(FakeStorage)
    }

    async fn computer_for(
        &self,
        _harness_id: HarnessId,
    ) -> Result<Option<ComputerId>, FakeStorage> {
        Ok(None)
    }

    async fn revoke(&self, _computer: &Computer) -> Result<(), FakeStorage> {
        Ok(())
    }

    async fn deliver_agent(
        &self,
        _harness_id: HarnessId,
        _computer_id: ComputerId,
        _generation: EnrollmentGeneration,
    ) -> Result<(), FakeStorage> {
        Err(FakeStorage)
    }

    async fn create_default_agent(
        &self,
        _computer: &Computer,
        _harness_id: HarnessId,
    ) -> Result<DefaultAgent, FakeStorage> {
        Err(FakeStorage)
    }
}

#[derive(Debug, thiserror::Error)]
#[error("not part of this scenario")]
struct FakeStorage;

/// The computers someone is using.
#[derive(Default)]
struct InUse(Mutex<HashSet<ComputerId>>);

impl ComputersInUse for InUse {
    fn in_use<'a>(&'a self, candidates: &'a [ComputerId]) -> ComputersInUseFuture<'a> {
        let in_use = self.0.lock().unwrap();
        let found = candidates
            .iter()
            .filter(|id| in_use.contains(id))
            .copied()
            .collect();
        Box::pin(async move { Ok(found) })
    }
}

type Operator =
    ComputerOperator<PgComputerRepo, SimFleets, NoHarnesses, Arc<MovingClock>, FakeSetupNotices>;

async fn bought_at(repo: &PgComputerRepo, id: u128, at: DateTime<Utc>) -> Computer {
    let reservation = match repo
        .reserve(standard(id), at, at + Duration::minutes(15))
        .await
        .unwrap()
    {
        Reserved::New(reservation) => reservation,
        other => panic!("expected a new reservation, got {other:?}"),
    };
    repo.convert_reservation(reservation.id, active(id), at)
        .await
        .unwrap()
        .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_purchase_burst_spreads_over_hosts_and_pressure_hibernates_only_idle_computers(
    pool: PgPool,
) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    let clock = MovingClock::new();
    let fleets = SimFleets {
        a: SimHost::new("sim-a", &clock),
        b: SimHost::new("sim-b", &clock),
        c: SimHost::gated("sim-c", &clock),
    };
    let (a, b, c) = (
        Arc::clone(&fleets.a),
        Arc::clone(&fleets.b),
        Arc::clone(&fleets.c),
    );
    // The home host registers as the operator starts; the others are rows.
    for host in [&b, &c] {
        repo.register_host(host.host().await.unwrap())
            .await
            .unwrap();
    }
    let in_use = Arc::new(InUse::default());
    let operator: Operator = ComputerOperator::start(
        repo.clone(),
        fleets,
        NoHarnesses,
        FakeSetupNotices::default(),
        Arc::clone(&clock),
        Arc::new(FixedDeployment),
    )
    .await
    .unwrap()
    .with_computers_in_use(in_use.clone());
    let hosts: HashMap<String, HostId> = repo
        .hosts()
        .await
        .unwrap()
        .into_iter()
        .map(|record| (record.name.to_string(), record.id))
        .collect();
    assert_eq!(hosts.len(), 3);

    // Nothing has reported yet: no host admits a start.
    for host in hosts.values() {
        assert!(!operator_admits(&repo, *host, clock.now()).await);
    }

    // The first pass reports every host and hands each its limits: the
    // ceiling, and the squeeze window between the watermarks.
    operator.overcommit().await.unwrap();
    for host in [&a, &b, &c] {
        // 90%, 70% and 80% of 64 GiB.
        assert_eq!(
            host.state.lock().unwrap().limits,
            Some(crate::domain::overcommit::HostAgentLimits {
                guest_memory_max_mib: 58_982,
                squeeze_above_mib: 45_875,
                squeeze_below_mib: 52_428,
                home_disk_gib: crate::domain::image::sold_home_disk_gib(),
            }),
            "{}",
            host.name
        );
    }

    // A burst of 36 purchases: each lands on the host with the most room
    // and starts; the effect worker's restore is simulated by `run`.
    let mut placed: HashMap<HostId, Vec<ComputerId>> = HashMap::new();
    for id in 1..=36 {
        let computer = bought_at(&repo, id, clock.now()).await;
        assert_eq!(
            computer.state.phase,
            crate::domain::lifecycle::Phase::Provisioning { start: true },
            "purchase {id}"
        );
        let host = hosts
            .iter()
            .find(|(_, host)| **host == computer.host)
            .unwrap()
            .0;
        operator_host(&a, &b, &c, host).run(computer.id, GIB);
        placed.entry(computer.host).or_default().push(computer.id);
    }
    assert!(
        placed.values().all(|computers| computers.len() == 12),
        "spread evenly: {placed:?}"
    );

    // Host a's guests grow to 4 GiB each: 4 + 12 * 4 = 52 GiB, over its
    // 51.2 GiB (80%) high watermark. Two of them are in use.
    let pressured = &placed[&hosts["sim-a"]];
    in_use
        .0
        .lock()
        .unwrap()
        .extend(pressured.iter().take(2).copied());
    a.grow(4 * GIB, 1);
    b.grow(2 * GIB, 1);
    c.grow(2 * GIB, 1);
    operator.overcommit().await.unwrap();
    // Nobody has been idle long enough yet.
    assert!(a.state.lock().unwrap().hibernated.is_empty());
    // Host a refuses starts above its high watermark.
    assert!(
        !operator_admits(&repo, hosts["sim-a"], clock.now()).await,
        "over the high watermark"
    );

    // Sixteen quiet minutes later relief hibernates the idlest until a is
    // under its 44.8 GiB (70%) low watermark: two 4 GiB guests.
    clock.advance(Duration::minutes(16));
    a.grow(4 * GIB, 1);
    b.grow(2 * GIB, 1);
    c.grow(2 * GIB, 1);
    operator.overcommit().await.unwrap();
    let hibernated = a.state.lock().unwrap().hibernated.clone();
    assert_eq!(hibernated.len(), 2, "{hibernated:?}");
    assert!(hibernated.iter().all(|id| !pressured[..2].contains(id)));
    assert!(b.state.lock().unwrap().hibernated.is_empty());
    assert!(c.state.lock().unwrap().hibernated.is_empty());
    for id in &hibernated {
        let marked = sqlx::query_scalar!(
            "SELECT hibernated_at FROM hosted_runtime WHERE id = $1",
            id.as_uuid(),
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(marked, Some(clock.now()));
    }
    // The next pass measures 44 GiB: no more relief, and a admits again.
    operator.overcommit().await.unwrap();
    assert_eq!(a.state.lock().unwrap().hibernated.len(), 2);
    assert!(operator_admits(&repo, hosts["sim-a"], clock.now()).await);

    // The pass also kept host a's usage readings for Settings: one per
    // guest for the minute sixteen minutes in (the passes before the burst
    // saw no guests in the first minute; the pass after it is the same
    // minute again), each at its 4 GiB.
    let readings = crate::domain::ports::UsageHistory::usage_since(
        &repo,
        pressured,
        clock.now() - Duration::hours(1),
    )
    .await
    .unwrap();
    assert_eq!(readings.len(), 12);
    assert!(
        readings
            .iter()
            .all(|(_, reading)| reading.sampled_at == clock.now()
                && reading.memory_bytes == 4 * GIB * 1024 * 1024
                && reading.cpu_usage_microseconds == 2_000_000),
        "{readings:?}"
    );

    // Its team powers one on: it wakes through the admission it freed.
    assert_eq!(
        operator
            .wake(hibernated[0], WakeReason::Power)
            .await
            .unwrap(),
        Wake::Woken
    );
    assert_eq!(a.state.lock().unwrap().woken, vec![hibernated[0]]);
    assert_eq!(
        operator
            .wake(hibernated[0], WakeReason::Power)
            .await
            .unwrap(),
        Wake::Awake
    );
    assert_eq!(a.running(), 11);
}

/// The simulated host named `name`.
fn operator_host<'a>(
    a: &'a Arc<SimHost>,
    b: &'a Arc<SimHost>,
    c: &'a Arc<SimHost>,
    name: &str,
) -> &'a Arc<SimHost> {
    match name {
        "sim-a" => a,
        "sim-b" => b,
        _ => c,
    }
}

/// Whether `host` would admit a standard start now.
async fn operator_admits(repo: &PgComputerRepo, host: HostId, now: DateTime<Utc>) -> bool {
    let mut tx = repo.pool.begin().await.unwrap();
    let admitted = PgComputerRepo::host_has_room(
        &mut tx,
        host,
        ComputerId::new_from_uuid(Uuid::from_u128(0xffff)),
        standard(0xffff).resources,
        now,
    )
    .await
    .unwrap();
    tx.rollback().await.unwrap();
    admitted
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_wake_storm_restores_through_the_hosts_bounded_queue(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    let clock = MovingClock::new();
    let fleets = SimFleets {
        a: SimHost::new("sim-a", &clock),
        b: SimHost::new("sim-b", &clock),
        c: SimHost::gated("sim-c", &clock),
    };
    let c = Arc::clone(&fleets.c);
    repo.register_host(c.host().await.unwrap()).await.unwrap();
    let operator: Arc<Operator> = Arc::new(
        ComputerOperator::start(
            repo.clone(),
            fleets,
            NoHarnesses,
            FakeSetupNotices::default(),
            Arc::clone(&clock),
            Arc::new(FixedDeployment),
        )
        .await
        .unwrap(),
    );
    let host_c = repo
        .hosts()
        .await
        .unwrap()
        .into_iter()
        .find(|record| record.name.as_str() == "sim-c")
        .unwrap()
        .id;
    // Keep the home host from taking purchases.
    sqlx::query!(
        "UPDATE hosted_runtime_host SET admitting = false WHERE id <> $1",
        host_c.into_inner()
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE hosted_runtime_host SET max_concurrent_starts = 3 WHERE id = $1",
        host_c.into_inner()
    )
    .execute(&pool)
    .await
    .unwrap();
    operator.overcommit().await.unwrap();

    // Ten computers run on c, then all hibernate.
    let mut computers = Vec::new();
    for id in 1..=10 {
        let computer = bought_at(&repo, id, clock.now()).await;
        assert_eq!(computer.host, host_c);
        c.run(computer.id, GIB);
        computers.push(computer.id);
    }
    for id in &computers {
        c.hibernate(*id).await.unwrap();
    }
    clock.advance(Duration::seconds(10));
    operator.overcommit().await.unwrap();
    for id in &computers {
        assert!(repo.request_wake(*id, clock.now()).await.unwrap());
    }

    // Every one is asked to wake at once.
    let wakes: Vec<_> = computers
        .iter()
        .map(|id| {
            let operator = Arc::clone(&operator);
            let id = *id;
            tokio::spawn(async move { operator.wake(id, WakeReason::Dispatch).await })
        })
        .collect();
    // Three restore while the rest queue.
    let mut restoring = c.restoring.subscribe();
    restoring.wait_for(|count| *count == 3).await.unwrap();
    c.restore_gate
        .as_ref()
        .unwrap()
        .add_permits(computers.len());
    for wake in wakes {
        assert_eq!(wake.await.unwrap().unwrap(), Wake::Woken);
    }
    let state = c.state.lock().unwrap();
    assert_eq!(state.most_restoring, 3);
    assert_eq!(state.woken.len(), 10);
}
