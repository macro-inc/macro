use super::*;
use crate::domain::ports::DueTimer;

#[tokio::test]
async fn the_operator_leaves_another_hosts_effects_and_timers_alone() {
    let operator = operator(FakeFleet::default()).await;
    let id = paid_computer(&operator).await;
    // Another control plane's host holds the computer.
    operator
        .repo
        .computers
        .lock()
        .unwrap()
        .get_mut(&id)
        .unwrap()
        .host = HostId::new(Uuid::from_u128(0xdead));
    operator.repo.timers.lock().unwrap().push(DueTimer {
        computer_id: id,
        kind: TimerKind::RetentionExpired,
        fire_at: now(),
    });

    assert_eq!(operator.run_fleet_effects().await.unwrap(), 0);
    assert_eq!(operator.fire_timers().await.unwrap(), 0);

    assert!(operator.fleet.enrollments.lock().unwrap().is_empty());
    assert!(operator.fleet.calls.lock().unwrap().is_empty());
}

/// The home host and one Firecracker row, each with its own fake fleet.
#[derive(Default)]
pub(super) struct TwoHosts {
    pub(super) home: FakeFleet,
    pub(super) microvm: std::sync::Arc<FakeFleet>,
}

impl crate::domain::ports::Fleets for TwoHosts {
    type Fleet = FakeFleet;
    type Err = std::convert::Infallible;

    fn home(&self) -> Option<&FakeFleet> {
        Some(&self.home)
    }

    fn drives(&self, host: &crate::domain::models::HostRecord) -> bool {
        host.connection.is_some()
    }

    fn fleet(
        &self,
        _host: &crate::domain::models::HostRecord,
    ) -> Result<crate::domain::ports::FleetHandle<'_, FakeFleet>, Self::Err> {
        Ok(crate::domain::ports::FleetHandle::Host(
            std::sync::Arc::clone(&self.microvm),
        ))
    }
}

pub(super) const MICROVM: HostId = HostId::new(Uuid::from_u128(0x0f00));

pub(super) async fn two_host_operator()
-> ComputerOperator<FakeRepo, TwoHosts, FakeHarnesses, FixedClock, FakeSetupNotices> {
    let repo = FakeRepo {
        sold_units: 9,
        ..FakeRepo::default()
    };
    repo.other_hosts
        .lock()
        .unwrap()
        .push(crate::domain::models::HostRecord {
            id: MICROVM,
            name: crate::domain::models::HostName::try_new("microvm-1").unwrap(),
            connection: Some(crate::domain::models::HostConnection {
                endpoint: "https://10.0.0.2:8443".parse().unwrap(),
                server_certificate_pem: "pinned".to_owned(),
            }),
            max_concurrent_starts: 1,
        });
    ComputerOperator::start(
        repo,
        TwoHosts {
            microvm: std::sync::Arc::new(FakeFleet {
                host_name: Some("microvm-1"),
                ..Default::default()
            }),
            ..Default::default()
        },
        FakeHarnesses::default(),
        FakeSetupNotices::default(),
        FixedClock,
        std::sync::Arc::new(crate::domain::fakes::FixedDeployment),
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn a_computer_on_a_firecracker_row_is_created_through_that_hosts_fleet() {
    let operator = two_host_operator().await;
    let id = paid_computer(&operator).await;
    // As if the purchase had been placed on the Firecracker host.
    operator
        .repo
        .computers
        .lock()
        .unwrap()
        .get_mut(&id)
        .unwrap()
        .host = MICROVM;
    for pending in operator.repo.effects.lock().unwrap().iter_mut() {
        if let Effect::Create { host, .. } = &mut pending.effect {
            *host = MICROVM;
        }
    }

    assert_eq!(operator.run_fleet_effects().await.unwrap(), 1);

    assert_eq!(operator.fleet.microvm.enrollments.lock().unwrap().len(), 1);
    assert!(operator.fleet.home.enrollments.lock().unwrap().is_empty());
}

#[tokio::test]
async fn reconcile_registers_each_driven_row_through_its_own_fleet() {
    let operator = two_host_operator().await;

    operator.reconcile().await.unwrap();

    assert_eq!(
        *operator.repo.registered.lock().unwrap(),
        vec![
            crate::domain::models::HostName::try_new("runtime-dev-1").unwrap(),
            crate::domain::models::HostName::try_new("microvm-1").unwrap(),
        ]
    );
    assert_eq!(
        operator.fleet.microvm.host_attempts.load(Ordering::SeqCst),
        1
    );
}
