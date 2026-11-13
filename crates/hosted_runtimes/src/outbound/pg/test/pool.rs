use super::*;
use crate::domain::image::GuestImage;
use crate::domain::lifecycle::ClaimBilling;
use crate::domain::models::{Claim, NewPoolComputer, POOL_HARNESS_OWNER};

const OWNER: &str = "macro|owner@example.com";

fn charge() -> ClaimBilling {
    ClaimBilling::Charge {
        price_id: stripe::PriceId::from_str("price_standard").unwrap(),
        extra_items: vec![],
    }
}

/// A host whose current image is `macro-box/test`: 24 GB, 3 awake units, sold 3x.
async fn pool_host(repo: &PgComputerRepo) -> Host {
    repo.register_host(HostRegistration {
        name: "pool-test".to_owned(),
        memory_gb: 24,
        reserve_gb: 0,
        oversell_factor: 3,
        image: GuestImage::try_new("macro-box/test").unwrap(),
    })
    .await
    .unwrap()
}

/// A standard pool computer `id` on `host`, created from `image`, booted
/// and connected, with its pool-owned harness.
async fn ready_pool_computer(
    repo: &PgComputerRepo,
    pool: &PgPool,
    host: HostId,
    id: u128,
    image: &str,
) -> ComputerId {
    let catalog = crate::domain::size::current_catalog();
    let standard = &catalog[0];
    let computer = repo
        .add_pool_computer(
            NewPoolComputer {
                id: ComputerId::new_from_uuid(Uuid::from_u128(id)),
                host,
                size: ComputerSize::Standard,
                resources: standard.resources,
                catalog_entry: standard.id.clone(),
                name: ComputerName::try_new("Macro computer").unwrap(),
            },
            8,
            now(),
        )
        .await
        .unwrap()
        .expect("the host has awake room");
    repo.record_image(computer.id, &GuestImage::try_new(image).unwrap())
        .await
        .unwrap();
    let harness_id = Uuid::from_u128(id + 0x1000);
    sqlx::query!(
        r#"
        INSERT INTO harnesses (id, kind, name, owner_user_id, created_by, computer_id)
        VALUES ($1, 'macrod', 'Macro computer', $2, $2, $3)
        "#,
        harness_id,
        POOL_HARNESS_OWNER,
        computer.id.as_uuid(),
    )
    .execute(pool)
    .await
    .unwrap();
    repo.set_harness(
        computer.id,
        harness_id::HarnessId::new_from_uuid(harness_id),
    )
    .await
    .unwrap();
    changed(repo, computer.id, Event::InstanceStarted, now()).await;
    changed(repo, computer.id, Event::MacrodConnected, now()).await;
    computer.id
}

async fn access(pool: &PgPool, computer_id: ComputerId, user: &str) -> (Option<String>, bool) {
    let row = sqlx::query!(
        r#"
        SELECT harness_access_level(h.id, $2)::text AS level, harness_can_run(h.id, $2) AS "can_run!"
        FROM harnesses h WHERE h.computer_id = $1
        "#,
        computer_id.as_uuid(),
        user,
    )
    .fetch_one(pool)
    .await
    .unwrap();
    (row.level, row.can_run)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_purchase_takes_a_pool_computer_and_its_harness_in_one_transaction(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    let host = pool_host(&repo).await;
    let pooled = ready_pool_computer(&repo, &pool, host.id, 0xb0b, "macro-box/test").await;

    // Nobody can use a pool computer's harness, and it is no team's.
    assert_eq!(access(&pool, pooled, OWNER).await, (None, false));
    assert!(repo.list_for_team(TEAM).await.unwrap().is_empty());
    assert_eq!(repo.allocation().await.unwrap()[0].sold_units, 0);

    let claim = repo
        .claim_pool_computer(&standard(1), charge(), now() + Duration::seconds(1))
        .await
        .unwrap();

    let Claim::Taken(taken) = claim else {
        panic!("expected the pool computer, got {claim:?}");
    };
    assert_eq!(taken.id, pooled);
    assert_eq!(taken.team_id(), Some(TEAM));
    assert_eq!(taken.state.billing, Billing::Charging);
    let row = sqlx::query!(
        r#"SELECT team_id, created_by, purchase_key, name, price_id, created_at FROM hosted_runtime WHERE id = $1"#,
        pooled.as_uuid(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.team_id, Some(TEAM));
    assert_eq!(row.created_by.as_deref(), Some(OWNER));
    assert_eq!(row.purchase_key.as_deref(), Some("buy-1"));
    assert_eq!(row.name, "Computer 1");
    assert_eq!(row.price_id.as_deref(), Some("price_standard"));
    assert_eq!(row.created_at, now() + Duration::seconds(1));
    let harness = sqlx::query!(
        "SELECT name, owner_user_id FROM harnesses WHERE computer_id = $1",
        pooled.as_uuid(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(harness.name, "Computer 1");
    assert_eq!(harness.owner_user_id.as_deref(), Some(OWNER));
    // The team's owner owns it now; the purchase holds sold units.
    assert_eq!(
        access(&pool, pooled, OWNER).await,
        (Some("owner".to_owned()), true)
    );
    assert_eq!(repo.list_for_team(TEAM).await.unwrap().len(), 1);
    assert_eq!(repo.allocation().await.unwrap()[0].sold_units, 1);
    let effects: Vec<Effect> = sqlx::query_scalar!(
        "SELECT effect FROM hosted_runtime_effect WHERE computer_id = $1 ORDER BY id",
        pooled.as_uuid(),
    )
    .fetch_all(&pool)
    .await
    .unwrap()
    .into_iter()
    .map(|effect| serde_json::from_value(effect).unwrap())
    .collect();
    assert_eq!(
        effects,
        vec![
            Effect::Create {
                host: host.id,
                start: true,
                generation: crate::domain::enrollment::EnrollmentGeneration::new(1),
            },
            Effect::Charge {
                price_id: stripe::PriceId::from_str("price_standard").unwrap(),
                extra_items: vec![],
            },
            Effect::JoinTeam,
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_purchase_leaves_unsuitable_pool_computers_in_the_pool(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    let host = pool_host(&repo).await;
    let stale = ready_pool_computer(&repo, &pool, host.id, 0xb01, "macro-box/old").await;
    let dropped = ready_pool_computer(&repo, &pool, host.id, 0xb02, "macro-box/test").await;
    changed(&repo, dropped, Event::MacrodDisconnected, now()).await;

    let claim = repo
        .claim_pool_computer(&standard(1), charge(), now())
        .await
        .unwrap();

    assert_eq!(claim, Claim::Unavailable);
    for id in [stale, dropped] {
        let computer = repo.get(id).await.unwrap().unwrap().into_healthy().unwrap();
        assert_eq!(computer.owner, None);
        assert_eq!(computer.state.billing, Billing::Pool);
        assert_eq!(access(&pool, id, OWNER).await, (None, false));
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_team_takes_at_most_one_pool_computer_while_a_charge_settles(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    let host = pool_host(&repo).await;
    ready_pool_computer(&repo, &pool, host.id, 0xb01, "macro-box/test").await;
    ready_pool_computer(&repo, &pool, host.id, 0xb02, "macro-box/test").await;

    let first = repo
        .claim_pool_computer(&standard(1), charge(), now())
        .await
        .unwrap();
    let unpaid = repo
        .claim_pool_computer(&standard(2), charge(), now())
        .await
        .unwrap();
    let comped = repo
        .claim_pool_computer(
            &NewReservation {
                funding: Funding::Comped {
                    reason: "internal team".to_owned(),
                },
                ..standard(3)
            },
            ClaimBilling::Comped {
                reason: "internal team".to_owned(),
            },
            now(),
        )
        .await
        .unwrap();
    let reused_key = repo
        .claim_pool_computer(&standard(1), charge(), now())
        .await
        .unwrap();

    assert!(matches!(first, Claim::Taken(_)));
    assert_eq!(unpaid, Claim::Unavailable);
    // A comp has nothing to settle.
    assert!(matches!(comped, Claim::Taken(_)));
    // The key already bought a computer; `reserve` answers for it.
    assert_eq!(reused_key, Claim::Unavailable);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_pool_computer_is_taken_only_with_sold_units_left(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    let host = pool_host(&repo).await;
    let pooled = ready_pool_computer(&repo, &pool, host.id, 0xb01, "macro-box/test").await;
    // Nine sold units, all held by reservations.
    for id in 10..19 {
        reserve(&repo, standard(id)).await;
    }

    let claim = repo
        .claim_pool_computer(&standard(1), charge(), now())
        .await
        .unwrap();

    assert_eq!(claim, Claim::Unavailable);
    assert_eq!(
        repo.get(pooled)
            .await
            .unwrap()
            .unwrap()
            .into_healthy()
            .unwrap()
            .owner,
        None
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_pool_fills_to_its_target_within_awake_room(pool: PgPool) {
    let repo = PgComputerRepo::new(pool, policy());
    // 3 awake units: three standard computers at most.
    let host = pool_host(&repo).await;
    let catalog = crate::domain::size::current_catalog();
    let standard = &catalog[0];
    let new = |id: u128| NewPoolComputer {
        id: ComputerId::new_from_uuid(Uuid::from_u128(id)),
        host: host.id,
        size: ComputerSize::Standard,
        resources: standard.resources,
        catalog_entry: standard.id.clone(),
        name: ComputerName::try_new("Macro computer").unwrap(),
    };

    let first = repo.add_pool_computer(new(1), 1, now()).await.unwrap();
    let over_target = repo.add_pool_computer(new(2), 1, now()).await.unwrap();
    let second = repo.add_pool_computer(new(3), 3, now()).await.unwrap();
    let third = repo.add_pool_computer(new(4), 3, now()).await.unwrap();
    let no_room = repo.add_pool_computer(new(5), 9, now()).await.unwrap();

    assert!(first.is_some());
    assert_eq!(over_target, None);
    assert!(second.is_some());
    assert!(third.is_some());
    assert_eq!(no_room, None);
    assert_eq!(repo.pool_computers(host.id).await.unwrap().len(), 3);
    // Pool computers hold awake units only.
    assert_eq!(repo.allocation().await.unwrap()[0].sold_units, 0);
}
