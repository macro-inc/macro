use super::*;
use crate::domain::lifecycle::{Billing, ClaimBilling};
use crate::domain::models::{Claim, NewPoolComputer};
use crate::domain::pool::PoolTargets;

const ONE_STANDARD: PoolTargets = PoolTargets {
    standard: 1,
    large: 0,
    xl: 0,
};

/// Computer 1, the one [`HARNESS`] runs on, as a pool computer.
async fn add_pool_computer(
    operator: &ComputerOperator<FakeRepo, FakeFleet, FakeHarnesses, FixedClock>,
) -> ComputerId {
    let catalog = crate::domain::size::current_catalog();
    let id = ComputerId::new_from_uuid(Uuid::from_u128(1));
    operator
        .repo
        .add_pool_computer(
            NewPoolComputer {
                id,
                host: crate::domain::fakes::HOST,
                size: ComputerSize::Standard,
                resources: catalog[0].resources,
                catalog_entry: catalog[0].id.clone(),
                name: ComputerName::try_new("Macro computer").unwrap(),
            },
            1,
            now(),
        )
        .await
        .unwrap()
        .unwrap();
    id
}

fn pool_computers(
    operator: &ComputerOperator<FakeRepo, FakeFleet, FakeHarnesses, FixedClock>,
) -> Vec<Computer> {
    operator
        .repo
        .computers
        .lock()
        .unwrap()
        .values()
        .filter(|computer| computer.owner.is_none() && computer.state.is_live())
        .cloned()
        .collect()
}

#[tokio::test]
async fn a_purchased_pool_computer_joins_its_team_and_the_pool_refills() {
    let operator = operator(FakeFleet::default()).await.with_pool(ONE_STANDARD);
    let id = add_pool_computer(&operator).await;
    operator.run_fleet_effects().await.unwrap();

    // Up and connected in the pool: setup that is the team's waits.
    assert!(operator.macrod_connected(HARNESS).await.unwrap());
    let pooled = operator
        .repo
        .get(id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(pooled.state.phase, Phase::Running);
    assert_eq!(pooled.state.billing, Billing::Pool);
    assert_eq!(pooled.enrolled_at, None);
    assert_eq!(*operator.harnesses.default_agents.lock().unwrap(), vec![]);

    let claim = operator
        .repo
        .claim_pool_computer(
            &NewReservation {
                id: ComputerId::new_from_uuid(Uuid::from_u128(99)),
                team_id: TEAM,
                purchase_key: crate::domain::models::PurchaseKey::try_new(
                    "buy-dialog-1".to_owned(),
                )
                .unwrap(),
                name: ComputerName::try_new("Ada").unwrap(),
                size: ComputerSize::Standard,
                resources: pooled.resources,
                catalog_entry: pooled.catalog_entry.clone(),
                funding: crate::domain::models::Funding::Comped {
                    reason: "internal team".to_owned(),
                },
                created_by: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
                extra_items: vec![],
                provision_traceparent: None,
            },
            ClaimBilling::Comped {
                reason: "internal team".to_owned(),
            },
            now(),
        )
        .await
        .unwrap();
    assert!(matches!(claim, Claim::Taken(_)));
    assert!(pool_computers(&operator).is_empty());

    operator.run_fleet_effects().await.unwrap();

    let joined = operator
        .repo
        .get(id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(joined.enrolled_at, Some(now()));
    assert_eq!(joined.default_agent_id, Some(DEFAULT_AGENT));
    assert_eq!(
        *operator.harnesses.default_agents.lock().unwrap(),
        vec![(id, HARNESS)]
    );
    assert_eq!(
        *operator.harnesses.reconnects.lock().unwrap(),
        vec![HARNESS]
    );
    let refill = pool_computers(&operator);
    assert_eq!(refill.len(), 1);
    assert_eq!(refill[0].size, ComputerSize::Standard);
    assert_ne!(refill[0].id, id);
}

#[tokio::test]
async fn reconcile_replaces_a_pool_computer_built_from_an_older_image() {
    let operator = operator(FakeFleet::default()).await.with_pool(ONE_STANDARD);
    let id = add_pool_computer(&operator).await;
    operator
        .repo
        .record_image(id, &GuestImage::try_new("macro-box/2026-10-01").unwrap())
        .await
        .unwrap();

    operator.reconcile().await.unwrap();

    let drained = operator
        .repo
        .get(id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(drained.state.phase, Phase::Destroying);
    let refill = pool_computers(&operator);
    assert_eq!(refill.len(), 1);
    assert_ne!(refill[0].id, id);
}

#[tokio::test]
async fn filling_a_full_pool_creates_nothing_and_a_disabled_pool_drains() {
    let operator = operator(FakeFleet::default()).await.with_pool(ONE_STANDARD);
    operator.fill_pool().await.unwrap();
    operator.fill_pool().await.unwrap();
    let pooled = pool_computers(&operator);
    assert_eq!(pooled.len(), 1);
    assert_eq!(pooled[0].state.phase, Phase::Provisioning { start: true });

    let operator = ComputerOperator {
        pool: PoolTargets::NONE,
        ..operator
    };
    operator.fill_pool().await.unwrap();

    assert!(pool_computers(&operator).is_empty());
}
