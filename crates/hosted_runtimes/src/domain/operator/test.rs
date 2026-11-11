use std::str::FromStr;
mod agent;
mod data_disk;
mod redeploy;

use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};

use crate::domain::enrollment::DeviceSecret;
use crate::domain::ids::PairingId;
use crate::domain::image::GuestImage;
use crate::domain::models::ComputerName;
use uuid::Uuid;

use super::*;
use crate::domain::fakes::{FakeError, FakeRepo, FixedClock, HOST, TEAM, now};
use crate::domain::lifecycle::ComputerState;
use crate::domain::models::{ControlPlaneId, HostRegistration, NewReservation};
use crate::domain::ports::{DefaultAgent, HostedPairing};
use crate::domain::size::ComputerSize;

const HARNESS: HarnessId =
    HarnessId::new_from_uuid(Uuid::from_u128(0x0000_0000_0000_7000_8000_0000_0000_0c0c));
const DEFAULT_AGENT: bot_id::BotId =
    bot_id::BotId::new_from_uuid(Uuid::from_u128(0x0000_0000_0000_7000_8000_0000_0000_0a0a));

#[derive(Debug, thiserror::Error)]
enum FakeFleetError {
    #[error("fleet unavailable")]
    Unavailable,
    #[error(transparent)]
    Enrollment(#[from] EnrollmentIssueError),
    #[error("instance missing")]
    Missing,
}

impl FleetError for FakeFleetError {
    fn is_missing(&self) -> bool {
        matches!(self, Self::Missing)
    }
}

/// Records fleet calls; `create` fails `failures` times first.
#[derive(Default)]
struct FakeFleet {
    start_gate: Option<std::sync::Arc<redeploy::FleetGate>>,
    host_failures: Mutex<u32>,
    host_attempts: AtomicU32,
    failures: Mutex<u32>,
    missing: bool,
    lose_during_create: std::sync::atomic::AtomicBool,
    calls: Mutex<Vec<String>>,
    enrollments: Mutex<Vec<(Enrollment, bool)>>,
    created: Mutex<HashMap<ComputerId, (EnrollmentGeneration, PairingId)>>,
    /// Each guest's data disk, named by the generation that created it.
    volumes: Mutex<HashMap<ComputerId, String>>,
    instances: Mutex<Vec<FleetInstance>>,
}

const BASE_IMAGE: &str = "macro-box/2026-11-01";

impl Fleet for FakeFleet {
    type Err = FakeFleetError;

    fn control_plane_id(&self) -> &ControlPlaneId {
        static ID: std::sync::LazyLock<ControlPlaneId> =
            std::sync::LazyLock::new(|| ControlPlaneId::parse("test-a".to_owned()).unwrap());
        &ID
    }

    async fn create(
        &self,
        computer: &Computer,
        generation: EnrollmentGeneration,
        enrollment: &impl FleetEnrollment,
        start: bool,
    ) -> Result<GuestImage, FakeFleetError> {
        let image = GuestImage::try_new(BASE_IMAGE).unwrap();
        {
            let mut failures = self.failures.lock().unwrap();
            if *failures > 0 {
                *failures -= 1;
                return Err(FakeFleetError::Unavailable);
            }
        }
        let existing = if self.missing {
            None
        } else {
            self.created.lock().unwrap().get(&computer.id).copied()
        };
        if let Some((stored, pairing)) = existing {
            assert_eq!(stored, generation);
            if enrollment.claimed(pairing).await? {
                return Ok(image);
            }
        }
        let enrollment = enrollment.issue().await?;
        if self.lose_during_create.swap(false, Ordering::SeqCst) {
            return Err(FakeFleetError::Missing);
        }
        self.created
            .lock()
            .unwrap()
            .insert(computer.id, (generation, enrollment.pairing_id));
        self.enrollments.lock().unwrap().push((enrollment, start));
        if existing.is_some() {
            self.restart(computer.id).await?;
        } else {
            // A recreated guest reuses a volume its lost predecessor left.
            self.volumes
                .lock()
                .unwrap()
                .entry(computer.id)
                .or_insert_with(|| format!("data-{}", generation.get()));
        }
        Ok(image)
    }

    async fn start(&self, id: ComputerId) -> Result<(), FakeFleetError> {
        self.calls.lock().unwrap().push(format!("start {id}"));
        if let Some(gate) = &self.start_gate {
            gate.wait().await;
        }
        if self.missing {
            return Err(FakeFleetError::Missing);
        }
        Ok(())
    }

    async fn stop(&self, id: ComputerId) -> Result<(), FakeFleetError> {
        self.calls.lock().unwrap().push(format!("stop {id}"));
        Ok(())
    }

    async fn restart(&self, id: ComputerId) -> Result<(), FakeFleetError> {
        self.calls.lock().unwrap().push(format!("restart {id}"));
        if self.missing {
            return Err(FakeFleetError::Missing);
        }
        Ok(())
    }

    async fn restart_macrod(&self, id: ComputerId) -> Result<(), FakeFleetError> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("restart_macrod {id}"));
        Ok(())
    }

    async fn destroy(&self, id: ComputerId) -> Result<(), FakeFleetError> {
        self.calls.lock().unwrap().push(format!("destroy {id}"));
        self.volumes.lock().unwrap().remove(&id);
        Ok(())
    }

    async fn clear_enrollment(&self, id: ComputerId) -> Result<(), FakeFleetError> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("clear_enrollment {id}"));
        Ok(())
    }

    async fn resources_match(&self, _computer: &Computer) -> Result<bool, Self::Err> {
        Ok(true)
    }

    async fn instances(&self) -> Result<Vec<FleetInstance>, FakeFleetError> {
        Ok(self.instances.lock().unwrap().clone())
    }

    async fn host(&self) -> Result<HostRegistration, FakeFleetError> {
        self.host_attempts.fetch_add(1, Ordering::SeqCst);
        let mut failures = self.host_failures.lock().unwrap();
        if *failures > 0 {
            *failures -= 1;
            return Err(FakeFleetError::Unavailable);
        }
        Ok(HostRegistration {
            name: "runtime-dev-1".to_owned(),
            memory_gb: 31,
            reserve_gb: 7,
            oversell_factor: 3,
        })
    }
}

#[tokio::test]
async fn unavailable_host_does_not_abort_startup_and_registration_retries_with_backoff() {
    struct TestClock(Mutex<DateTime<Utc>>);
    impl Clock for TestClock {
        fn now(&self) -> DateTime<Utc> {
            *self.0.lock().unwrap()
        }
    }
    let operator = ComputerOperator::start(
        FakeRepo::default(),
        FakeFleet {
            host_failures: Mutex::new(4),
            ..Default::default()
        },
        FakeHarnesses::default(),
        TestClock(Mutex::new(now())),
        std::sync::Arc::new(crate::domain::fakes::FixedDeployment),
    )
    .await
    .unwrap();
    assert!(operator.run_fleet_effects().await.is_err());
    assert!(operator.fire_timers().await.is_err());
    assert!(operator.reconcile().await.is_err());
    assert_eq!(operator.fleet.host_attempts.load(Ordering::SeqCst), 1);

    *operator.clock.0.lock().unwrap() += Duration::seconds(10);
    assert!(operator.run_fleet_effects().await.is_err());
    assert_eq!(operator.fleet.host_attempts.load(Ordering::SeqCst), 2);
    *operator.clock.0.lock().unwrap() += Duration::seconds(19);
    assert!(operator.run_fleet_effects().await.is_err());
    assert_eq!(operator.fleet.host_attempts.load(Ordering::SeqCst), 2);

    *operator.clock.0.lock().unwrap() += Duration::seconds(1);
    assert!(operator.run_fleet_effects().await.is_err());
    assert_eq!(operator.fleet.host_attempts.load(Ordering::SeqCst), 3);
    *operator.clock.0.lock().unwrap() += Duration::seconds(40);
    assert!(operator.run_fleet_effects().await.is_err());
    assert_eq!(operator.fleet.host_attempts.load(Ordering::SeqCst), 4);
    *operator.clock.0.lock().unwrap() += Duration::seconds(59);
    assert!(operator.run_fleet_effects().await.is_err());
    assert_eq!(operator.fleet.host_attempts.load(Ordering::SeqCst), 4);
    *operator.clock.0.lock().unwrap() += Duration::seconds(1);
    assert_eq!(operator.run_fleet_effects().await.unwrap(), 0);
    operator.reconcile().await.unwrap();
    assert_eq!(operator.fire_timers().await.unwrap(), 0);
    assert_eq!(operator.fleet.host_attempts.load(Ordering::SeqCst), 5);
}

/// Records each hosted pairing created; `lose_response` drops the next
/// response after the pairing exists. `fail_default_agent` fails every
/// default agent request after recording it.
#[derive(Default)]
struct FakeHarnesses {
    claimed: std::sync::atomic::AtomicBool,
    lose_response: std::sync::atomic::AtomicBool,
    enrollments: Mutex<Vec<Option<HarnessId>>>,
    fail_default_agent: std::sync::atomic::AtomicBool,
    default_agents: Mutex<Vec<(ComputerId, HarnessId)>>,
}

impl Harnesses for FakeHarnesses {
    type Err = FakeError;

    async fn create_hosted_pairing(&self, computer: &Computer) -> Result<HostedPairing, FakeError> {
        if let Some(harness_id) = computer.harness_id {
            assert_eq!(harness_id, HARNESS);
        }
        let mut enrollments = self.enrollments.lock().unwrap();
        let generation = enrollments.len() as u128;
        enrollments.push(computer.harness_id);
        if self.lose_response.swap(false, Ordering::SeqCst) {
            return Err(FakeError);
        }
        Ok(HostedPairing {
            pairing_id: PairingId::new_from_uuid(Uuid::from_u128(
                0x0000_0000_0000_7000_8000_0000_0000_0909 + generation,
            )),
            device_secret: DeviceSecret::new(if generation == 0 {
                "secret".to_owned()
            } else {
                format!("secret-{generation}")
            }),
        })
    }

    async fn pairing_claimed(&self, _pairing_id: PairingId) -> Result<bool, FakeError> {
        Ok(self.claimed.load(Ordering::SeqCst))
    }

    async fn computer_for(&self, harness_id: HarnessId) -> Result<Option<ComputerId>, FakeError> {
        Ok((harness_id == HARNESS).then_some(ComputerId::new_from_uuid(Uuid::from_u128(1))))
    }

    async fn revoke(&self, _computer: &Computer) -> Result<(), FakeError> {
        Ok(())
    }

    async fn create_default_agent(
        &self,
        computer: &Computer,
        harness_id: HarnessId,
    ) -> Result<DefaultAgent, FakeError> {
        self.default_agents
            .lock()
            .unwrap()
            .push((computer.id, harness_id));
        if self.fail_default_agent.load(Ordering::SeqCst) {
            return Err(FakeError);
        }
        Ok(DefaultAgent::Created {
            agent_id: DEFAULT_AGENT,
        })
    }
}

async fn operator(
    fleet: FakeFleet,
) -> ComputerOperator<FakeRepo, FakeFleet, FakeHarnesses, FixedClock> {
    ComputerOperator::start(
        FakeRepo {
            sold_units: 9,
            ..FakeRepo::default()
        },
        fleet,
        FakeHarnesses::default(),
        FixedClock,
        std::sync::Arc::new(crate::domain::fakes::FixedDeployment),
    )
    .await
    .unwrap()
}

async fn paid_computer(
    operator: &ComputerOperator<FakeRepo, FakeFleet, FakeHarnesses, FixedClock>,
) -> ComputerId {
    let id = ComputerId::new_from_uuid(Uuid::from_u128(1));
    operator
        .repo
        .reserve(
            NewReservation {
                id,
                team_id: TEAM,
                purchase_key: crate::domain::models::PurchaseKey::try_new(
                    "buy-dialog-1".to_owned(),
                )
                .unwrap(),
                name: ComputerName::try_new("Ada").unwrap(),
                size: ComputerSize::Standard,
                resources: crate::domain::size::ComputerResources {
                    vcpus: crate::domain::size::Vcpus::new(4),
                    memory_gib: crate::domain::size::MemoryGib::new(8),
                    disk_gib: crate::domain::size::DiskGib::new(100),
                },
                catalog_entry: crate::domain::size::CatalogEntryId::try_new(
                    "standard@2026-11".to_owned(),
                )
                .unwrap(),
                funding: crate::domain::models::Funding::Stripe {
                    price_id: stripe::PriceId::from_str("price_standard").unwrap(),
                },
                created_by: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
                extra_items: vec![],
                provision_traceparent: None,
                agent: None,
            },
            now(),
            now() + Duration::minutes(15),
        )
        .await
        .unwrap();
    operator
        .repo
        .convert_reservation(
            id,
            crate::domain::lifecycle::Billing::Active {
                subscription_item: "si_1".parse().unwrap(),
            },
            now(),
        )
        .await
        .unwrap()
        .unwrap();
    id
}

#[tokio::test]
async fn create_enrolls_the_computer_and_connection_makes_it_ready() {
    let operator = operator(FakeFleet::default()).await;
    let id = paid_computer(&operator).await;

    assert_eq!(operator.run_fleet_effects().await.unwrap(), 1);

    assert_eq!(
        *operator.fleet.enrollments.lock().unwrap(),
        vec![(
            Enrollment {
                computer_id: id,
                generation: EnrollmentGeneration::new(1),
                pairing_id: PairingId::new_from_uuid(Uuid::from_u128(
                    0x0000_0000_0000_7000_8000_0000_0000_0909
                )),
                device_secret: DeviceSecret::new("secret".to_owned()),
                name: ComputerName::try_new("Ada").unwrap(),
                deployment: crate::domain::fakes::deployment(),
                traceparent: None,
                agent: None,
            },
            true,
        )]
    );
    let booting = operator
        .repo
        .get(id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(booting.state.phase, Phase::Booting);

    assert!(operator.macrod_connected(HARNESS).await.unwrap());
    let ready = operator
        .repo
        .get(id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(ready.state.phase, Phase::Running);
    assert_eq!(ready.harness_id, Some(HARNESS));
    assert_eq!(
        *operator.fleet.calls.lock().unwrap(),
        vec![format!("clear_enrollment {id}")]
    );
}

#[tokio::test]
async fn the_first_connection_gives_the_team_a_default_agent_once() {
    let operator = operator(FakeFleet::default()).await;
    let id = paid_computer(&operator).await;
    operator.run_fleet_effects().await.unwrap();

    assert!(operator.macrod_connected(HARNESS).await.unwrap());
    operator.macrod_disconnected(HARNESS).await.unwrap();
    assert!(operator.macrod_connected(HARNESS).await.unwrap());

    assert_eq!(
        *operator.harnesses.default_agents.lock().unwrap(),
        vec![(id, HARNESS)]
    );
    let ready = operator
        .repo
        .get(id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(ready.default_agent_id, Some(DEFAULT_AGENT));
    assert_eq!(
        ready
            .status(0, now(), crate::domain::fakes::policy())
            .default_agent_id,
        Some(DEFAULT_AGENT)
    );
}

/// The agent is a convenience: failing to create it never holds up setup,
/// and a later connection does not try again.
#[tokio::test]
async fn a_failed_default_agent_still_makes_the_computer_ready() {
    let operator = operator(FakeFleet::default()).await;
    let id = paid_computer(&operator).await;
    operator.run_fleet_effects().await.unwrap();
    operator
        .harnesses
        .fail_default_agent
        .store(true, Ordering::SeqCst);

    assert!(operator.macrod_connected(HARNESS).await.unwrap());
    let ready = operator
        .repo
        .get(id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(ready.state.phase, Phase::Running);
    assert!(ready.enrolled_at.is_some());
    assert_eq!(
        *operator.fleet.calls.lock().unwrap(),
        vec![format!("clear_enrollment {id}")]
    );

    operator.macrod_disconnected(HARNESS).await.unwrap();
    assert!(operator.macrod_connected(HARNESS).await.unwrap());
    assert_eq!(
        *operator.harnesses.default_agents.lock().unwrap(),
        vec![(id, HARNESS)]
    );
}

#[tokio::test]
async fn an_effect_that_keeps_failing_fails_the_computer() {
    let operator = operator(FakeFleet {
        failures: Mutex::new(MAX_EFFECT_ATTEMPTS),
        ..FakeFleet::default()
    })
    .await;
    let id = paid_computer(&operator).await;

    for _ in 0..MAX_EFFECT_ATTEMPTS {
        operator.repo.effect_run_after.lock().unwrap().clear();
        assert_eq!(operator.run_fleet_effects().await.unwrap(), 1);
    }

    let failed = operator
        .repo
        .get(id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(
        failed.state.phase,
        Phase::Crashed {
            restarts: 0,
            retry: None,
        }
    );
    // The page goes out, then nothing is left to do.
    assert_eq!(operator.run_fleet_effects().await.unwrap(), 1);
    assert_eq!(operator.run_fleet_effects().await.unwrap(), 0);
}

#[tokio::test]
async fn reconcile_turns_a_missing_instance_into_a_crash_and_removes_orphans() {
    let orphan =
        ComputerId::new_from_uuid(Uuid::from_u128(0x0000_0000_0000_7000_8000_0000_0000_dead));
    let operator = operator(FakeFleet {
        instances: Mutex::new(vec![FleetInstance {
            computer_id: orphan,
            status: InstanceStatus::Running,
            control_plane_id: ControlPlaneId::parse("test-a".to_owned()).unwrap(),
            created_at: Some(now() - Duration::minutes(11)),
        }]),
        ..FakeFleet::default()
    })
    .await;
    let id = paid_computer(&operator).await;
    {
        let mut computers = operator.repo.computers.lock().unwrap();
        let computer = computers.get_mut(&id).unwrap();
        computer.state = ComputerState {
            phase: Phase::Running,
            macrod_connected: true,
            macrod_misses: 0,
            ..computer.state.clone()
        };
    }

    operator.reconcile().await.unwrap();

    let crashed = operator
        .repo
        .get(id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(
        crashed.state.phase,
        Phase::Crashed {
            restarts: 1,
            retry: Some(crate::domain::lifecycle::Retry {
                attempt: 0,
                next_at: now() + Duration::seconds(30),
            }),
        }
    );
    assert_eq!(
        *operator.fleet.calls.lock().unwrap(),
        vec![format!("destroy {orphan}")]
    );
}

#[tokio::test]
async fn retry_of_a_lost_guest_reprovisions_the_same_computer_and_harness() {
    let operator = operator(FakeFleet {
        missing: true,
        ..FakeFleet::default()
    })
    .await;
    let id = paid_computer(&operator).await;
    operator.run_fleet_effects().await.unwrap();
    operator.macrod_connected(HARNESS).await.unwrap();
    operator
        .repo
        .apply(
            id,
            Event::EffectFailed {
                reason: "guest lost".to_owned(),
            },
            now(),
        )
        .await
        .unwrap();
    operator.run_fleet_effects().await.unwrap(); // PageOperator
    operator
        .repo
        .apply(id, Event::OperatorRetry, now())
        .await
        .unwrap();

    assert_eq!(operator.run_fleet_effects().await.unwrap(), 1);
    let lost = operator
        .repo
        .get(id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(lost.state.phase, Phase::Provisioning { start: true });
    assert!(!lost.state.macrod_connected);
    assert_eq!(lost.harness_id, Some(HARNESS));
    assert_eq!(operator.run_fleet_effects().await.unwrap(), 1);
    let recreated = operator
        .repo
        .get(id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(recreated.id, id);
    assert_eq!(recreated.harness_id, Some(HARNESS));
    assert_eq!(recreated.state.phase, Phase::Booting);
    {
        let enrollments = operator.fleet.enrollments.lock().unwrap();
        assert_eq!(enrollments.len(), 2);
        assert_ne!(enrollments[0].0.pairing_id, enrollments[1].0.pairing_id);
        assert_ne!(
            enrollments[0].0.device_secret,
            enrollments[1].0.device_secret
        );
        assert_eq!(
            *operator.harnesses.enrollments.lock().unwrap(),
            vec![None, Some(HARNESS)]
        );
    }
    assert_eq!(operator.run_fleet_effects().await.unwrap(), 0);
}

#[tokio::test]
async fn reconcile_recreates_missing_stopped_or_failed_guests_but_keeps_existing_guests() {
    for phase in [
        Phase::Crashed {
            restarts: 0,
            retry: None,
        },
        Phase::Stopped,
    ] {
        for present in [false, true] {
            let operator = operator(FakeFleet::default()).await;
            let id = paid_computer(&operator).await;
            operator.run_fleet_effects().await.unwrap();
            operator
                .repo
                .computers
                .lock()
                .unwrap()
                .get_mut(&id)
                .unwrap()
                .state
                .phase = phase.clone();
            if present {
                operator
                    .fleet
                    .instances
                    .lock()
                    .unwrap()
                    .push(FleetInstance {
                        computer_id: id,
                        status: InstanceStatus::Stopped,
                        control_plane_id: ControlPlaneId::parse("test-a".to_owned()).unwrap(),
                        created_at: Some(now() - Duration::minutes(11)),
                    });
            }
            operator.reconcile().await.unwrap();
            let computer = operator
                .repo
                .get(id)
                .await
                .unwrap()
                .unwrap()
                .into_healthy()
                .unwrap();
            assert_eq!(
                computer.state.phase,
                if present {
                    phase.clone()
                } else {
                    Phase::Provisioning { start: true }
                }
            );
        }
    }
}

#[tokio::test]
async fn a_lost_guest_is_recreated_with_a_fresh_pairing() {
    let operator = operator(FakeFleet::default()).await;
    let id = paid_computer(&operator).await;
    operator.run_fleet_effects().await.unwrap();
    // Connecting happens after the guest claims its approved pairing.
    operator.macrod_connected(HARNESS).await.unwrap();

    operator.fleet.created.lock().unwrap().remove(&id);
    operator
        .repo
        .apply(id, Event::InstanceLost, now())
        .await
        .unwrap();
    assert_eq!(operator.run_fleet_effects().await.unwrap(), 1);

    let recreated = operator
        .repo
        .get(id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(recreated.id, id);
    assert_eq!(recreated.harness_id, Some(HARNESS));
    let enrollments = operator.fleet.enrollments.lock().unwrap();
    assert_eq!(enrollments.len(), 2);
    let first = &enrollments[0].0;
    let replacement = &enrollments[1].0;
    assert_eq!(replacement.computer_id, id);
    assert_eq!(replacement.generation, EnrollmentGeneration::new(2));
    assert_ne!(replacement.pairing_id, first.pairing_id);
    assert_ne!(replacement.device_secret, first.device_secret);
    assert_eq!(
        *operator.harnesses.enrollments.lock().unwrap(),
        vec![None, Some(HARNESS)]
    );
}

#[tokio::test]
async fn reconcile_never_destroys_foreign_recent_or_unknown_age_instances() {
    let operator = operator(FakeFleet {
        instances: Mutex::new(vec![
            FleetInstance {
                computer_id: ComputerId::new_from_uuid(Uuid::from_u128(1)),
                status: InstanceStatus::Running,
                control_plane_id: ControlPlaneId::parse("test-b".to_owned()).unwrap(),
                created_at: Some(now() - Duration::hours(1)),
            },
            FleetInstance {
                computer_id: ComputerId::new_from_uuid(Uuid::from_u128(2)),
                status: InstanceStatus::Running,
                control_plane_id: ControlPlaneId::parse("test-a".to_owned()).unwrap(),
                created_at: Some(now() - Duration::minutes(9)),
            },
            FleetInstance {
                computer_id: ComputerId::new_from_uuid(Uuid::from_u128(3)),
                status: InstanceStatus::Running,
                control_plane_id: ControlPlaneId::parse("test-a".to_owned()).unwrap(),
                created_at: None,
            },
            FleetInstance {
                computer_id: ComputerId::new_from_uuid(Uuid::from_u128(4)),
                status: InstanceStatus::Running,
                control_plane_id: ControlPlaneId::parse("test-a".to_owned()).unwrap(),
                created_at: Some(now() - Duration::minutes(10)),
            },
            FleetInstance {
                computer_id: ComputerId::new_from_uuid(Uuid::from_u128(5)),
                status: InstanceStatus::Running,
                control_plane_id: ControlPlaneId::parse("test-a".to_owned()).unwrap(),
                created_at: Some(now() + Duration::minutes(1)),
            },
        ]),
        ..FakeFleet::default()
    })
    .await;
    operator.reconcile().await.unwrap();
    assert!(operator.fleet.calls.lock().unwrap().is_empty());
}

#[test]
fn control_plane_identity_rejects_missing_or_invalid_values() {
    assert!(ControlPlaneId::parse(String::new()).is_err());
    assert!(ControlPlaneId::parse(" ".to_owned()).is_err());
    assert!(ControlPlaneId::parse("test a".to_owned()).is_err());
    assert_eq!(
        ControlPlaneId::parse("local-test_a".to_owned())
            .unwrap()
            .as_str(),
        "local-test_a"
    );
}

mod enrollment;

#[tokio::test]
async fn reconcile_keeps_quarantined_guests_and_processes_healthy_computers() {
    for expected in [true, false] {
        let operator = operator(FakeFleet::default()).await;
        let healthy = paid_computer(&operator).await;
        let corrupt = ComputerId::new_from_uuid(Uuid::now_v7());
        {
            let mut computers = operator.repo.computers.lock().unwrap();
            let mut computer = computers.get(&healthy).unwrap().clone();
            computer.state.phase = Phase::Running;
            computers.insert(healthy, computer.clone());
            computer.id = corrupt;
            if !expected {
                computer.state.phase = Phase::Destroying;
            }
            computers.insert(corrupt, computer);
        }
        operator.repo.corrupt_ids.lock().unwrap().push(corrupt);
        operator.repo.events.lock().unwrap().clear();
        *operator.fleet.instances.lock().unwrap() = [healthy, corrupt]
            .into_iter()
            .map(|computer_id| FleetInstance {
                computer_id,
                status: InstanceStatus::Stopped,
                control_plane_id: ControlPlaneId::parse("test-a".to_owned()).unwrap(),
                created_at: Some(now() - Duration::minutes(11)),
            })
            .collect();

        operator.reconcile().await.unwrap();

        assert_eq!(
            *operator.repo.events.lock().unwrap(),
            vec![(healthy, Event::VmCrashed)]
        );
        assert!(
            operator
                .fleet
                .calls
                .lock()
                .unwrap()
                .iter()
                .all(|call| !call.starts_with("destroy "))
        );
    }
}
