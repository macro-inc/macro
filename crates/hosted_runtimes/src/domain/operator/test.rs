use std::collections::BTreeMap;
use std::sync::Mutex;

use uuid::Uuid;

use super::*;
use crate::domain::fakes::{FakeError, FakeRepo, FixedClock, HOST, TEAM, now};
use crate::domain::lifecycle::ComputerState;
use crate::domain::models::{HostRegistration, NewComputer};
use crate::domain::ports::HostedPairing;
use crate::domain::size::ComputerSize;

const HARNESS: Uuid = Uuid::from_u128(0x0000_0000_0000_7000_8000_0000_0000_0c0c);

/// Records fleet calls; `create` fails `failures` times first.
#[derive(Default)]
struct FakeFleet {
    failures: Mutex<u32>,
    calls: Mutex<Vec<String>>,
    enrollments: Mutex<Vec<(Enrollment, bool)>>,
    instances: Mutex<Vec<(Uuid, InstanceStatus)>>,
}

impl Fleet for FakeFleet {
    type Err = FakeError;

    async fn create(
        &self,
        _computer: &Computer,
        enrollment: &Enrollment,
        start: bool,
    ) -> Result<(), FakeError> {
        let mut failures = self.failures.lock().unwrap();
        if *failures > 0 {
            *failures -= 1;
            return Err(FakeError);
        }
        self.enrollments
            .lock()
            .unwrap()
            .push((enrollment.clone(), start));
        Ok(())
    }

    async fn start(&self, id: Uuid) -> Result<(), FakeError> {
        self.calls.lock().unwrap().push(format!("start {id}"));
        Ok(())
    }

    async fn stop(&self, id: Uuid) -> Result<(), FakeError> {
        self.calls.lock().unwrap().push(format!("stop {id}"));
        Ok(())
    }

    async fn restart(&self, id: Uuid) -> Result<(), FakeError> {
        self.calls.lock().unwrap().push(format!("restart {id}"));
        Ok(())
    }

    async fn freeze(&self, id: Uuid) -> Result<(), FakeError> {
        self.calls.lock().unwrap().push(format!("freeze {id}"));
        Ok(())
    }

    async fn unfreeze(&self, id: Uuid) -> Result<(), FakeError> {
        self.calls.lock().unwrap().push(format!("unfreeze {id}"));
        Ok(())
    }

    async fn suspend(&self, id: Uuid) -> Result<(), FakeError> {
        self.calls.lock().unwrap().push(format!("suspend {id}"));
        Ok(())
    }

    async fn resume(&self, id: Uuid) -> Result<(), FakeError> {
        self.calls.lock().unwrap().push(format!("resume {id}"));
        Ok(())
    }

    async fn destroy(&self, id: Uuid) -> Result<(), FakeError> {
        self.calls.lock().unwrap().push(format!("destroy {id}"));
        Ok(())
    }

    async fn clear_enrollment(&self, id: Uuid) -> Result<(), FakeError> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("clear_enrollment {id}"));
        Ok(())
    }

    async fn instances(&self) -> Result<Vec<(Uuid, InstanceStatus)>, FakeError> {
        Ok(self.instances.lock().unwrap().clone())
    }

    async fn host(&self) -> Result<HostRegistration, FakeError> {
        Ok(HostRegistration {
            name: "runtime-dev-1".to_owned(),
            memory_gb: 31,
            reserve_gb: 7,
            oversell_factor: 3,
        })
    }
}

struct FakeHarnesses;

impl Harnesses for FakeHarnesses {
    type Err = FakeError;

    async fn create_hosted_pairing(
        &self,
        _computer: &Computer,
    ) -> Result<HostedPairing, FakeError> {
        Ok(HostedPairing {
            pairing_id: Uuid::from_u128(0x0000_0000_0000_7000_8000_0000_0000_0909),
            device_secret: "secret".to_owned(),
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
        FakeHarnesses,
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
