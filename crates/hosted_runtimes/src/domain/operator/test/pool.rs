use super::*;
use crate::domain::lifecycle::{Billing, ClaimBilling};
use crate::domain::models::{Claim, NewPoolComputer};
use crate::domain::pool::{PoolKind, PoolTargets};

const ONE_STANDARD: PoolTargets = PoolTargets {
    standard: 1,
    large: 0,
    xl: 0,
};

/// Computer 1, the one [`HARNESS`] runs on, as a regular pool computer.
async fn add_pool_computer(
    operator: &ComputerOperator<FakeRepo, FakeFleet, FakeHarnesses, FixedClock, FakeSetupNotices>,
) -> ComputerId {
    add_pool_computer_of(operator, PoolKind::Regular).await
}

/// Computer 1 as a pool computer of `kind`.
async fn add_pool_computer_of(
    operator: &ComputerOperator<FakeRepo, FakeFleet, FakeHarnesses, FixedClock, FakeSetupNotices>,
    kind: PoolKind,
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
                kind,
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
    operator: &ComputerOperator<FakeRepo, FakeFleet, FakeHarnesses, FixedClock, FakeSetupNotices>,
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
                agent: None,
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

fn ada() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|ada-1@agents.macro.invalid".to_owned()).unwrap()
}

fn agent_purchase(
    resources: crate::domain::size::ComputerResources,
    catalog_entry: crate::domain::size::CatalogEntryId,
) -> NewReservation {
    NewReservation {
        id: ComputerId::new_from_uuid(Uuid::from_u128(99)),
        team_id: TEAM,
        purchase_key: crate::domain::models::PurchaseKey::try_new("invite-ada-1".to_owned())
            .unwrap(),
        name: ComputerName::try_new("Ada").unwrap(),
        size: ComputerSize::Standard,
        resources,
        catalog_entry,
        funding: crate::domain::models::Funding::Comped {
            reason: "internal team".to_owned(),
        },
        created_by: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
        extra_items: vec![],
        provision_traceparent: None,
        agent: Some(ada()),
    }
}

#[tokio::test]
async fn an_agent_pool_computer_is_created_from_the_agent_image() {
    let operator = operator(FakeFleet::default())
        .await
        .with_agent_pool(ONE_STANDARD);

    operator.fill_pool().await.unwrap();
    let pooled = pool_computers(&operator);
    assert_eq!(pooled.len(), 1);
    assert_eq!(
        operator.repo.pool_kinds.lock().unwrap().get(&pooled[0].id),
        Some(&PoolKind::Agent)
    );
    operator.run_fleet_effects().await.unwrap();

    assert_eq!(
        *operator.fleet.agent_images.lock().unwrap(),
        vec![(pooled[0].id, true)]
    );
    // Built from the agent image, so the next pass keeps it.
    operator.fill_pool().await.unwrap();
    assert_eq!(pool_computers(&operator).len(), 1);
}

#[tokio::test]
async fn an_agent_purchase_takes_only_an_agent_pool_computer() {
    let operator = operator(FakeFleet::default()).await;
    let id = add_pool_computer(&operator).await;
    operator.run_fleet_effects().await.unwrap();
    assert!(operator.macrod_connected(HARNESS).await.unwrap());
    let pooled = operator
        .repo
        .get(id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();

    let claim = operator
        .repo
        .claim_pool_computer(
            &agent_purchase(pooled.resources, pooled.catalog_entry.clone()),
            ClaimBilling::Comped {
                reason: "internal team".to_owned(),
            },
            now(),
        )
        .await
        .unwrap();

    assert!(matches!(claim, Claim::Unavailable));
    assert_eq!(pool_computers(&operator).len(), 1);
}

/// An agent pool computer taken for Ada, after its first handover attempt.
async fn taken_for_ada(
    operator: &ComputerOperator<FakeRepo, FakeFleet, FakeHarnesses, FixedClock, FakeSetupNotices>,
) -> ComputerId {
    let id = add_pool_computer_of(operator, PoolKind::Agent).await;
    operator.run_fleet_effects().await.unwrap();
    assert!(operator.macrod_connected(HARNESS).await.unwrap());
    // A pool computer enrolls with no agent.
    assert_eq!(operator.fleet.enrollments.lock().unwrap()[0].0.agent, None);
    let pooled = operator
        .repo
        .get(id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();

    let claim = operator
        .repo
        .claim_pool_computer(
            &agent_purchase(pooled.resources, pooled.catalog_entry.clone()),
            ClaimBilling::Comped {
                reason: "internal team".to_owned(),
            },
            now(),
        )
        .await
        .unwrap();
    assert!(matches!(claim, Claim::Taken(_)));
    assert_eq!(operator.repo.agents.lock().unwrap().get(&id), Some(&ada()));
    operator.run_fleet_effects().await.unwrap();
    id
}

fn join_team_pending(
    operator: &ComputerOperator<FakeRepo, FakeFleet, FakeHarnesses, FixedClock, FakeSetupNotices>,
    id: ComputerId,
) -> bool {
    operator
        .repo
        .effects
        .lock()
        .unwrap()
        .iter()
        .any(|pending| pending.computer_id == id && pending.effect == Effect::JoinTeam)
}

#[tokio::test]
async fn a_taken_agent_pool_computer_hands_over_once_its_agent_is_online() {
    let operator = operator(FakeFleet::default())
        .await
        .with_agent_pool(ONE_STANDARD);
    let id = taken_for_ada(&operator).await;

    // The handover asks for the agent to be delivered, with no credential,
    // and waits for it to report online.
    let generation = operator
        .repo
        .get(id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap()
        .enrollment_generation;
    assert_eq!(
        *operator.harnesses.delivered_agents.lock().unwrap(),
        vec![(HARNESS, id, generation)]
    );
    assert_eq!(
        *operator.harnesses.reconnects.lock().unwrap(),
        vec![HARNESS]
    );
    assert!(
        join_team_pending(&operator, id),
        "the handover retries until the agent is online"
    );
    assert_eq!(*operator.harnesses.default_agents.lock().unwrap(), vec![]);

    // Not online yet: the retry asks again, without a second reconnect.
    operator.repo.effect_run_after.lock().unwrap().clear();
    operator.run_fleet_effects().await.unwrap();
    assert_eq!(operator.harnesses.delivered_agents.lock().unwrap().len(), 2);
    assert_eq!(
        *operator.harnesses.reconnects.lock().unwrap(),
        vec![HARNESS]
    );

    operator.repo.online_agents.lock().unwrap().insert(ada());
    operator.repo.effect_run_after.lock().unwrap().clear();
    operator.run_fleet_effects().await.unwrap();

    assert_eq!(operator.harnesses.delivered_agents.lock().unwrap().len(), 2);
    assert!(!join_team_pending(&operator, id), "the handover is done");
    let computer = operator
        .repo
        .get(id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(computer.state.failure, None);
}

#[tokio::test]
async fn an_agent_that_never_comes_online_fails_its_computer_with_that_reason() {
    let operator = operator(FakeFleet::default())
        .await
        .with_agent_pool(ONE_STANDARD);
    let id = taken_for_ada(&operator).await;

    for _ in 1..MAX_EFFECT_ATTEMPTS {
        operator.repo.effect_run_after.lock().unwrap().clear();
        operator.run_fleet_effects().await.unwrap();
    }

    assert!(!join_team_pending(&operator, id));
    let computer = operator
        .repo
        .get(id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(computer.state.failure, Some(Failure::AgentNotStarted));
    assert_eq!(
        operator.harnesses.delivered_agents.lock().unwrap().len(),
        MAX_EFFECT_ATTEMPTS as usize
    );
}
