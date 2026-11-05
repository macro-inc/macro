use std::collections::BTreeMap;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU32, Ordering};

use uuid::Uuid;

use super::*;
use crate::domain::enrollment::{Persona, PersonaService};
use crate::domain::fakes::{FakeError, FakeRepo, FixedClock, HOST, TEAM, now};
use crate::domain::lifecycle::ComputerState;
use crate::domain::models::{HostRegistration, NewComputer};
use crate::domain::ports::HostedPairing;
use crate::domain::size::ComputerSize;

const HARNESS: Uuid = Uuid::from_u128(0x0000_0000_0000_7000_8000_0000_0000_0c0c);

#[derive(Debug, thiserror::Error)]
enum FakeFleetError {
    #[error("fleet unavailable")]
    Unavailable,
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
    host_failures: Mutex<u32>,
    host_attempts: AtomicU32,
    failures: Mutex<u32>,
    missing: bool,
    calls: Mutex<Vec<String>>,
    enrollments: Mutex<Vec<(Enrollment, bool)>>,
    instances: Mutex<Vec<(Uuid, InstanceStatus)>>,
}

impl Fleet for FakeFleet {
    type Err = FakeFleetError;

    async fn create(
        &self,
        _computer: &Computer,
        enrollment: &Enrollment,
        start: bool,
    ) -> Result<(), FakeFleetError> {
        let mut failures = self.failures.lock().unwrap();
        if *failures > 0 {
            *failures -= 1;
            return Err(FakeFleetError::Unavailable);
        }
        self.enrollments
            .lock()
            .unwrap()
            .push((enrollment.clone(), start));
        Ok(())
    }

    async fn start(&self, id: Uuid) -> Result<(), FakeFleetError> {
        self.calls.lock().unwrap().push(format!("start {id}"));
        Ok(())
    }

    async fn stop(&self, id: Uuid) -> Result<(), FakeFleetError> {
        self.calls.lock().unwrap().push(format!("stop {id}"));
        Ok(())
    }

    async fn restart(&self, id: Uuid) -> Result<(), FakeFleetError> {
        self.calls.lock().unwrap().push(format!("restart {id}"));
        if self.missing {
            return Err(FakeFleetError::Missing);
        }
        Ok(())
    }

    async fn freeze(&self, id: Uuid) -> Result<(), FakeFleetError> {
        self.calls.lock().unwrap().push(format!("freeze {id}"));
        Ok(())
    }

    async fn unfreeze(&self, id: Uuid) -> Result<(), FakeFleetError> {
        self.calls.lock().unwrap().push(format!("unfreeze {id}"));
        Ok(())
    }

    async fn suspend(&self, id: Uuid) -> Result<(), FakeFleetError> {
        self.calls.lock().unwrap().push(format!("suspend {id}"));
        Ok(())
    }

    async fn resume(&self, id: Uuid) -> Result<(), FakeFleetError> {
        self.calls.lock().unwrap().push(format!("resume {id}"));
        Ok(())
    }

    async fn destroy(&self, id: Uuid) -> Result<(), FakeFleetError> {
        self.calls.lock().unwrap().push(format!("destroy {id}"));
        Ok(())
    }

    async fn clear_enrollment(&self, id: Uuid) -> Result<(), FakeFleetError> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("clear_enrollment {id}"));
        Ok(())
    }

    async fn instances(&self) -> Result<Vec<(Uuid, InstanceStatus)>, FakeFleetError> {
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
        EnrollmentDefaults {
            service_url_overrides: BTreeMap::new(),
        },
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

#[derive(Default)]
struct FakeHarnesses {
    enrollments: Mutex<Vec<Option<Uuid>>>,
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
        Ok(HostedPairing {
            pairing_id: Uuid::from_u128(0x0000_0000_0000_7000_8000_0000_0000_0909 + generation),
            device_secret: if generation == 0 {
                "secret".to_owned()
            } else {
                format!("secret-{generation}")
            },
        })
    }

    async fn computer_for(&self, harness_id: Uuid) -> Result<Option<Uuid>, FakeError> {
        Ok((harness_id == HARNESS).then_some(Uuid::from_u128(1)))
    }

    async fn revoke(&self, _computer_id: Uuid) -> Result<(), FakeError> {
        Ok(())
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
        EnrollmentDefaults {
            service_url_overrides: BTreeMap::from([(
                "OVERRIDE_AGENT_HARNESS_SERVICE_URL".to_owned(),
                "http://10.210.0.1:8080".to_owned(),
            )]),
        },
    )
    .await
    .unwrap()
}

async fn paid_computer(
    operator: &ComputerOperator<FakeRepo, FakeFleet, FakeHarnesses, FixedClock>,
) -> Uuid {
    let id = Uuid::from_u128(1);
    operator
        .repo
        .reserve(
            NewComputer {
                billing: crate::domain::models::PurchaseBilling::Stripe,
                extra_items: vec![],
                id,
                team_id: TEAM,
                name: "Ada".to_owned(),
                size: ComputerSize::Standard,
                persona: None,
                created_by: "macro|owner@example.com".to_owned(),
            },
            now(),
        )
        .await
        .unwrap();
    operator
        .repo
        .apply(id, Event::PaymentConfirmed, now())
        .await
        .unwrap();
    id
}

struct IdleSessions;

impl SessionActivity for IdleSessions {
    type Err = FakeError;

    async fn is_idle_since(
        &self,
        harness_id: Uuid,
        since: DateTime<Utc>,
    ) -> Result<bool, FakeError> {
        assert_eq!(harness_id, HARNESS);
        assert_eq!(since, now() - IDLE_AFTER);
        Ok(true)
    }
}

#[tokio::test]
async fn idle_sleep_keeps_personas_running_and_freezes_session_only_computers() {
    let persona = Persona {
        name: "Agent".to_owned(),
        os_user: "agent".to_owned(),
        extra_service: PersonaService {
            unit_name: "macro-agent".to_owned(),
            exec: "/usr/local/bin/agent".to_owned(),
            env: BTreeMap::new(),
        },
        config: BTreeMap::new(),
    };
    for (persona, expected_frozen) in [(Some(persona), 0), (None, 1)] {
        let operator = operator(FakeFleet::default()).await;
        let id = paid_computer(&operator).await;
        operator
            .repo
            .computers
            .lock()
            .unwrap()
            .get_mut(&id)
            .unwrap()
            .persona = persona;
        operator.run_fleet_effects().await.unwrap();
        operator.macrod_connected(HARNESS).await.unwrap();
        operator.fleet.calls.lock().unwrap().clear();

        assert_eq!(
            operator.sleep_idle(&IdleSessions).await.unwrap(),
            expected_frozen
        );
        let computer = operator.repo.get(id).await.unwrap().unwrap();
        assert_eq!(
            computer.state.phase,
            if expected_frozen == 0 {
                Phase::Running { host: HOST }
            } else {
                Phase::Frozen { host: HOST }
            }
        );
        let freeze_effects = operator
            .repo
            .effects
            .lock()
            .unwrap()
            .iter()
            .filter(|pending| matches!(pending.effect, Effect::Freeze { .. }))
            .count();
        assert_eq!(freeze_effects, expected_frozen);
        operator.run_fleet_effects().await.unwrap();
        assert_eq!(
            *operator.fleet.calls.lock().unwrap(),
            if expected_frozen == 0 {
                vec![]
            } else {
                vec![format!("freeze {id}")]
            }
        );
    }
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
                pairing_id: Uuid::from_u128(0x0000_0000_0000_7000_8000_0000_0000_0909),
                device_secret: "secret".to_owned(),
                name: "Ada".to_owned(),
                service_url_overrides: BTreeMap::from([(
                    "OVERRIDE_AGENT_HARNESS_SERVICE_URL".to_owned(),
                    "http://10.210.0.1:8080".to_owned(),
                )]),
                persona: None,
            },
            true,
        )]
    );
    let booting = operator.repo.get(id).await.unwrap().unwrap();
    assert_eq!(booting.state.phase, Phase::Booting { host: HOST });

    assert!(operator.macrod_connected(HARNESS).await.unwrap());
    let ready = operator.repo.get(id).await.unwrap().unwrap();
    assert_eq!(ready.state.phase, Phase::Running { host: HOST });
    assert_eq!(ready.harness_id, Some(HARNESS));
    assert!(!operator.prompt_arrived(HARNESS).await.unwrap());
    assert_eq!(
        *operator.fleet.calls.lock().unwrap(),
        vec![format!("clear_enrollment {id}")]
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

    let failed = operator.repo.get(id).await.unwrap().unwrap();
    assert_eq!(failed.state.phase, Phase::Failed { host: HOST });
    // The page goes out, then nothing is left to do.
    assert_eq!(operator.run_fleet_effects().await.unwrap(), 1);
    assert_eq!(operator.run_fleet_effects().await.unwrap(), 0);
}

#[tokio::test]
async fn reconcile_turns_a_missing_instance_into_a_crash_and_removes_orphans() {
    let orphan = Uuid::from_u128(0x0000_0000_0000_7000_8000_0000_0000_dead);
    let operator = operator(FakeFleet {
        instances: Mutex::new(vec![(orphan, InstanceStatus::Running)]),
        ..FakeFleet::default()
    })
    .await;
    let id = paid_computer(&operator).await;
    {
        let mut computers = operator.repo.computers.lock().unwrap();
        let computer = computers.get_mut(&id).unwrap();
        computer.state = ComputerState {
            phase: Phase::Running { host: HOST },
            macrod_connected: true,
            ..computer.state.clone()
        };
    }

    operator.reconcile().await.unwrap();

    let crashed = operator.repo.get(id).await.unwrap().unwrap();
    assert_eq!(crashed.state.phase, Phase::Restarting { host: HOST });
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
    let lost = operator.repo.get(id).await.unwrap().unwrap();
    assert_eq!(
        lost.state.phase,
        Phase::Provisioning {
            host: HOST,
            start: true
        }
    );
    assert!(!lost.state.macrod_connected);
    assert_eq!(lost.harness_id, Some(HARNESS));
    assert_eq!(operator.run_fleet_effects().await.unwrap(), 1);
    let recreated = operator.repo.get(id).await.unwrap().unwrap();
    assert_eq!(recreated.id, id);
    assert_eq!(recreated.harness_id, Some(HARNESS));
    assert_eq!(recreated.state.phase, Phase::Booting { host: HOST });
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
async fn reconcile_recreates_missing_cold_or_failed_guests_but_keeps_existing_guests() {
    for phase in [
        Phase::Failed { host: HOST },
        Phase::Stopped { host: HOST },
        Phase::Suspended {
            host: HOST,
            saved_state: true,
        },
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
                    .push((id, InstanceStatus::Stopped));
            }
            operator.reconcile().await.unwrap();
            let computer = operator.repo.get(id).await.unwrap().unwrap();
            assert_eq!(
                computer.state.phase,
                if present {
                    phase.clone()
                } else {
                    Phase::Provisioning {
                        host: HOST,
                        start: true,
                    }
                }
            );
        }
    }
}

#[tokio::test]
async fn a_lost_guest_is_recreated_with_the_saved_persona_and_fresh_pairing() {
    let operator = operator(FakeFleet::default()).await;
    let id = paid_computer(&operator).await;
    let first_persona = Persona {
        name: "Agent".to_owned(),
        os_user: "agent".to_owned(),
        extra_service: PersonaService {
            unit_name: "macro-agent".to_owned(),
            exec: "/usr/local/bin/agent".to_owned(),
            env: BTreeMap::from([("AGENT_MODE".to_owned(), "hosted".to_owned())]),
        },
        config: BTreeMap::from([
            (
                "REPO_URL".to_owned(),
                "https://example.com/initial.git".to_owned(),
            ),
            ("AGENT_ID".to_owned(), "initial-agent".to_owned()),
        ]),
    };
    operator
        .repo
        .computers
        .lock()
        .unwrap()
        .get_mut(&id)
        .unwrap()
        .persona = Some(first_persona.clone());
    operator.run_fleet_effects().await.unwrap();
    // Connecting happens after the guest claims its approved pairing.
    operator.macrod_connected(HARNESS).await.unwrap();

    // The saved persona can change after enrollment; recreate must read the row.
    let saved_persona = Persona {
        config: BTreeMap::from([
            (
                "REPO_URL".to_owned(),
                "https://example.com/saved.git".to_owned(),
            ),
            ("AGENT_ID".to_owned(), "saved-agent".to_owned()),
        ]),
        ..first_persona.clone()
    };
    operator
        .repo
        .computers
        .lock()
        .unwrap()
        .get_mut(&id)
        .unwrap()
        .persona = Some(saved_persona.clone());
    operator
        .repo
        .apply(id, Event::InstanceLost, now())
        .await
        .unwrap();
    assert_eq!(operator.run_fleet_effects().await.unwrap(), 1);

    let recreated = operator.repo.get(id).await.unwrap().unwrap();
    assert_eq!(recreated.id, id);
    assert_eq!(recreated.harness_id, Some(HARNESS));
    assert_eq!(recreated.persona, Some(saved_persona.clone()));
    let enrollments = operator.fleet.enrollments.lock().unwrap();
    assert_eq!(enrollments.len(), 2);
    let first = &enrollments[0].0;
    let replacement = &enrollments[1].0;
    let mut first_persona = first_persona;
    let mut saved_persona = saved_persona;
    for persona in [&mut first_persona, &mut saved_persona] {
        persona
            .config
            .insert("MACRO_COMPUTER_ID".to_owned(), id.to_string());
        persona
            .config
            .insert("MACRO_TEAM_ID".to_owned(), recreated.team_id.to_string());
    }
    assert_eq!(first.persona, Some(first_persona));
    assert_eq!(replacement.persona, Some(saved_persona));
    assert_eq!(replacement.computer_id, id);
    assert_ne!(replacement.pairing_id, first.pairing_id);
    assert_ne!(replacement.device_secret, first.device_secret);
    assert_eq!(
        *operator.harnesses.enrollments.lock().unwrap(),
        vec![None, Some(HARNESS)]
    );
}
