use std::str::FromStr;
mod quarantine;
mod redeploy;

mod billing_races;
mod boot;

use chrono::{Duration, TimeZone};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;

use super::*;
use crate::domain::lifecycle::{Phase, Rejected};
use crate::domain::models::{ComputerName, PurchaseKey};
use crate::domain::size::{DiskGib, MemoryGib, Vcpus};

const TEAM: Uuid = Uuid::from_u128(0x0000_0000_0000_7000_8000_0000_0000_00aa);

fn now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 4, 12, 0, 0).unwrap()
}

fn policy() -> BillingPolicy {
    BillingPolicy::from_days(14, 7).unwrap()
}

async fn insert_team(pool: &PgPool) {
    let macro_user_id = Uuid::from_u128(0x0000_0000_0000_7000_8000_0000_0000_0011);
    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, 'owner@example.com', 'owner@example.com', 'stripe_owner')
        "#,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ('macro|owner@example.com', 'owner@example.com', $1)"#,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id) VALUES ($1, 'Computers', 'macro|owner@example.com')",
        TEAM,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// A Stripe purchase of a standard computer, keyed `buy-{id}`.
fn standard(id: u128) -> NewReservation {
    NewReservation {
        id: ComputerId::new_from_uuid(Uuid::from_u128(id)),
        team_id: TEAM,
        purchase_key: PurchaseKey::try_new(format!("buy-{id}")).unwrap(),
        name: ComputerName::try_new(&format!("Computer {id}")).unwrap(),
        size: ComputerSize::Standard,
        resources: crate::domain::size::ComputerResources {
            vcpus: crate::domain::size::Vcpus::new(4),
            memory_gib: crate::domain::size::MemoryGib::new(8),
            disk_gib: crate::domain::size::DiskGib::new(100),
        },
        catalog_entry: crate::domain::size::CatalogEntryId::try_new("standard@2026-11".to_owned())
            .unwrap(),
        funding: Funding::Stripe {
            price_id: stripe::PriceId::from_str("price_standard").unwrap(),
        },
        created_by: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
        extra_items: vec![],
        provision_traceparent: None,
    }
}

fn active(id: u128) -> Billing {
    Billing::Active {
        subscription_item: format!("si_{id}").parse().unwrap(),
    }
}

async fn reserve(repo: &PgComputerRepo, purchase: NewReservation) -> Reservation {
    match repo
        .reserve(purchase, now(), now() + Duration::minutes(15))
        .await
        .unwrap()
    {
        Reserved::New(reservation) => reservation,
        other => panic!("expected a new reservation, got {other:?}"),
    }
}

/// Reserve and convert a standard computer billed on item `si_{id}`.
async fn bought(repo: &PgComputerRepo, id: u128) -> Computer {
    let reservation = reserve(repo, standard(id)).await;
    repo.convert_reservation(reservation.id, active(id), now())
        .await
        .unwrap()
        .unwrap()
}

async fn changed(
    repo: &PgComputerRepo,
    id: ComputerId,
    event: Event,
    at: DateTime<Utc>,
) -> Computer {
    match repo.apply(id, event, at).await.unwrap().unwrap() {
        Applied::Changed(computer) => *computer,
        Applied::Rejected(rejected) => panic!("rejected: {rejected:?}"),
    }
}

async fn host(
    repo: &PgComputerRepo,
    name: &str,
    memory_gb: u32,
    reserve_gb: u32,
    oversell_factor: u32,
) -> Host {
    repo.register_host(HostRegistration {
        name: name.to_owned(),
        memory_gb,
        reserve_gb,
        oversell_factor,
    })
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reserve_holds_sold_units_until_the_host_is_sold_out(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool, policy());
    // 31 GB, 7 reserved: 3 awake units, sold 3x.
    let host = host(&repo, "runtime-dev-1", 31, 7, 3).await;
    assert_eq!(
        (host.awake_capacity_units, host.sold_capacity_units),
        (3, 9)
    );

    for id in 1..=4 {
        bought(&repo, id).await;
    }
    for id in 5..=9 {
        reserve(&repo, standard(id)).await;
    }
    let tenth = repo
        .reserve(standard(10), now(), now() + Duration::minutes(15))
        .await;

    assert!(matches!(tenth, Err(ReserveError::SoldOut)));
    assert_eq!(
        repo.sold_out_sizes(&crate::domain::size::current_catalog(), now())
            .await
            .unwrap(),
        vec![
            ComputerSize::Standard,
            ComputerSize::Large,
            ComputerSize::Xl
        ]
    );
    // Expired reservations still hold capacity: one may yet settle as
    // charged and become a computer.
    assert_eq!(
        repo.sold_out_sizes(
            &crate::domain::size::current_catalog(),
            now() + Duration::minutes(15)
        )
        .await
        .unwrap(),
        vec![
            ComputerSize::Standard,
            ComputerSize::Large,
            ComputerSize::Xl
        ]
    );
    assert!(matches!(
        repo.reserve(
            standard(10),
            now() + Duration::minutes(16),
            now() + Duration::minutes(31)
        )
        .await,
        Err(ReserveError::SoldOut)
    ));
}

/// Edge case (a), storage side: a purchase key finds its reservation while
/// the charge is confirmed, and the computer once it is converted.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_reused_purchase_key_finds_its_reservation_then_its_computer(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool, policy());
    host(&repo, "runtime-dev-1", 31, 7, 3).await;
    let reservation = reserve(&repo, standard(1)).await;

    let retry = NewReservation {
        id: ComputerId::new_from_uuid(Uuid::from_u128(2)),
        ..standard(1)
    };
    let pending = repo
        .reserve(retry.clone(), now(), now() + Duration::minutes(15))
        .await
        .unwrap();
    assert_eq!(pending, Reserved::Pending(reservation.clone()));

    repo.convert_reservation(reservation.id, active(1), now())
        .await
        .unwrap()
        .unwrap();
    let Reserved::Purchased(record) = repo
        .reserve(retry, now(), now() + Duration::minutes(15))
        .await
        .unwrap()
    else {
        panic!("expected the purchased computer");
    };
    assert_eq!(record.id(), reservation.id);
    assert!(repo.team_reservations(TEAM).await.unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn converting_a_reservation_inserts_the_computer_and_its_creation_once(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    let host = host(&repo, "runtime-dev-1", 31, 7, 3).await;
    let mut purchase = standard(1);
    purchase.extra_items = vec![crate::domain::models::SubscriptionItem {
        price_id: stripe::PriceId::from_str("price_seat").unwrap(),
        quantity: 1,
    }];
    let reservation = reserve(&repo, purchase).await;
    assert_eq!(
        repo.reservation(reservation.id).await.unwrap(),
        Some(reservation.clone())
    );
    assert_eq!(
        repo.reservations_created_before(now(), 10).await.unwrap(),
        vec![reservation.clone()]
    );
    assert!(repo.instances_expected(host.id).await.unwrap().is_empty());

    let computer = repo
        .convert_reservation(reservation.id, active(1), now())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        repo.convert_reservation(reservation.id, active(1), now())
            .await
            .unwrap(),
        None
    );

    assert_eq!(computer.state.phase, Phase::Provisioning { start: true });
    assert_eq!(computer.state.billing, active(1));
    assert_eq!(computer.host, host.id);
    let stored = repo
        .get(reservation.id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(stored, computer);
    let effects = repo
        .lease_effects(EffectWorker::Fleet, 10, now(), now() + Duration::minutes(1))
        .await
        .unwrap();
    assert_eq!(
        effects
            .iter()
            .map(|pending| pending.effect.clone())
            .collect::<Vec<_>>(),
        vec![Effect::Create {
            host: host.id,
            start: true,
            generation: crate::domain::enrollment::EnrollmentGeneration::new(1),
        }]
    );
    assert_eq!(repo.instances_expected(host.id).await.unwrap().len(), 1);
    assert!(repo.reservation(reservation.id).await.unwrap().is_none());
    let row = sqlx::query!(
        r#"SELECT purchase_key, awake, enrollment_generation FROM hosted_runtime WHERE id = $1"#,
        reservation.id.as_uuid()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.purchase_key, "buy-1");
    assert!(row.awake);
    assert_eq!(row.enrollment_generation, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_deleted_reservation_frees_its_capacity(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool, policy());
    host(&repo, "tiny", 15, 7, 1).await;
    let reservation = reserve(&repo, standard(1)).await;
    assert!(matches!(
        repo.reserve(standard(2), now(), now() + Duration::minutes(15))
            .await,
        Err(ReserveError::SoldOut)
    ));

    assert!(repo.delete_reservation(reservation.id).await.unwrap());
    assert!(!repo.delete_reservation(reservation.id).await.unwrap());

    reserve(&repo, standard(2)).await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn apply_stores_state_effects_and_timers_and_wakes_only_with_room(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool, policy());
    let host = host(&repo, "small", 15, 7, 2).await;
    assert_eq!(host.awake_capacity_units, 1);

    let first = bought(&repo, 1).await;
    let second = bought(&repo, 2).await;

    assert_eq!(first.state.phase, Phase::Provisioning { start: true });
    assert_eq!(second.state.phase, Phase::Provisioning { start: false });
    let mut leased = repo
        .lease_effects(EffectWorker::Fleet, 10, now(), now() + Duration::minutes(1))
        .await
        .unwrap();
    leased.sort_by_key(|pending| pending.computer_id.as_uuid());
    assert_eq!(
        leased
            .iter()
            .map(|pending| (pending.computer_id, pending.effect.clone()))
            .collect::<Vec<_>>(),
        vec![
            (
                first.id,
                Effect::Create {
                    host: host.id,
                    start: true,
                    generation: crate::domain::enrollment::EnrollmentGeneration::new(1),
                }
            ),
            (
                second.id,
                Effect::Create {
                    host: host.id,
                    start: false,
                    generation: crate::domain::enrollment::EnrollmentGeneration::new(1),
                }
            ),
        ]
    );
    // Leased effects stay hidden until their lease runs out.
    assert_eq!(
        repo.lease_effects(EffectWorker::Fleet, 10, now(), now() + Duration::minutes(1))
            .await
            .unwrap(),
        vec![]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_computers_effects_run_one_at_a_time_in_order(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool, policy());
    host(&repo, "runtime-dev-1", 31, 7, 3).await;
    let id = bought(&repo, 1).await.id;
    changed(&repo, id, Event::InstanceStarted, now()).await;
    changed(&repo, id, Event::MacrodConnected, now()).await;
    changed(&repo, id, Event::PowerOff, now()).await;
    changed(&repo, id, Event::PowerOn, now()).await;

    let first = repo
        .lease_effects(EffectWorker::Fleet, 10, now(), now() + Duration::minutes(1))
        .await
        .unwrap();
    assert_eq!(first.len(), 1);
    assert!(matches!(first[0].effect, Effect::Create { .. }));
    repo.complete_effect(first[0].id).await.unwrap();

    let second = repo
        .lease_effects(EffectWorker::Fleet, 10, now(), now() + Duration::minutes(1))
        .await
        .unwrap();
    assert_eq!(second.len(), 1);
    assert!(matches!(second[0].effect, Effect::Stop { .. }));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_replaced_timer_does_not_fire(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool, policy());
    host(&repo, "runtime-dev-1", 31, 7, 3).await;
    let id = bought(&repo, 1).await.id;
    changed(&repo, id, Event::InstanceStarted, now()).await;
    let due = repo
        .due_timers(now() + Duration::hours(1), 10)
        .await
        .unwrap();
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].kind, TimerKind::MacrodMissing);

    let mut stale = due[0].clone();
    stale.fire_at -= Duration::seconds(1);
    assert_eq!(repo.fire_timer(stale, None, now()).await.unwrap(), None);

    let crashed = repo
        .fire_timer(due[0].clone(), None, now() + Duration::hours(1))
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(
        crashed.state.phase,
        Phase::Crashed { retry: Some(_), .. }
    ));
    assert_eq!(repo.list_for_team(TEAM).await.unwrap().len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_released_computer_frees_its_units_and_leaves_the_team_list(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    let host = host(&repo, "tiny", 15, 7, 1).await;
    let id = bought(&repo, 1).await.id;
    assert!(matches!(
        repo.reserve(standard(2), now(), now() + Duration::minutes(15))
            .await,
        Err(ReserveError::SoldOut)
    ));

    let released = changed(&repo, id, Event::ReleaseNow, now()).await;

    assert_eq!(released.state.phase, Phase::Destroying);
    assert!(repo.list_for_team(TEAM).await.unwrap().is_empty());
    assert!(repo.instances_expected(host.id).await.unwrap().is_empty());
    let billing = repo
        .lease_effects(
            EffectWorker::Billing,
            10,
            now(),
            now() + Duration::minutes(1),
        )
        .await
        .unwrap();
    assert_eq!(
        billing
            .iter()
            .map(|pending| pending.effect.clone())
            .collect::<Vec<_>>(),
        vec![Effect::RemoveBillingItem {
            subscription_item: "si_1".parse().unwrap(),
        }]
    );
    reserve(&repo, standard(2)).await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_rejected_request_writes_nothing(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    host(&repo, "runtime-dev-1", 31, 7, 3).await;
    let id = bought(&repo, 1).await.id;
    let version = sqlx::query_scalar!(
        "SELECT version FROM hosted_runtime WHERE id = $1",
        id.as_uuid()
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(
        repo.apply(id, Event::OperatorRetry, now()).await.unwrap(),
        Some(Applied::Rejected(Rejected::NotFailed))
    );

    assert_eq!(
        sqlx::query_scalar!(
            "SELECT version FROM hosted_runtime WHERE id = $1",
            id.as_uuid()
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        version
    );
}

/// Edge case (c), storage side: a team row deleted after its computers
/// were released leaves their rows for the release effects to finish.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_a_team_keeps_its_released_computers_for_their_effects(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    host(&repo, "runtime-dev-1", 31, 7, 3).await;
    let id = bought(&repo, 1).await.id;
    let pending = reserve(&repo, standard(2)).await;

    crate::domain::service::TeamComputerRelease::new(
        repo.clone(),
        crate::domain::service::SystemClock,
    )
    .release_team(TEAM)
    .await
    .unwrap();
    sqlx::query!("DELETE FROM team WHERE id = $1", TEAM)
        .execute(&pool)
        .await
        .unwrap();

    let effects = sqlx::query_scalar!(
        r#"SELECT effect->>'effect' AS "effect!" FROM hosted_runtime_effect WHERE computer_id = $1 ORDER BY id"#,
        id.as_uuid()
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(
        effects,
        vec!["create", "remove_billing_item", "destroy", "revoke_harness"]
    );
    assert!(repo.reservation(pending.id).await.unwrap().is_none());
    assert!(repo.get(id).await.unwrap().is_some());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_comped_reservation_converts_with_its_reason(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool, policy());
    host(&repo, "test-host", 32, 4, 2).await;
    let mut purchase = standard(19);
    purchase.funding = Funding::Comped {
        reason: "internal team".to_owned(),
    };
    let reservation = reserve(&repo, purchase).await;
    let comped = repo
        .convert_reservation(
            reservation.id,
            Billing::Comped {
                reason: "internal team".to_owned(),
            },
            now(),
        )
        .await
        .unwrap()
        .unwrap();

    let stored = repo
        .get(comped.id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert_eq!(
        stored.funding,
        Funding::Comped {
            reason: "internal team".to_owned()
        }
    );
    assert_eq!(
        stored.status(0, now(), policy()).comp_reason.as_deref(),
        Some("internal team")
    );
    assert!(
        repo.lease_effects(
            EffectWorker::Billing,
            10,
            now() + Duration::days(1),
            now() + Duration::days(2),
        )
        .await
        .unwrap()
        .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn capacity_counts_recorded_resources_independently_of_size(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool, policy());
    host(&repo, "resource-host", 24, 0, 1).await;
    let mut purchase = standard(50);
    purchase.resources = ComputerResources {
        vcpus: Vcpus::new(6),
        memory_gib: MemoryGib::new(12),
        disk_gib: DiskGib::new(150),
    };
    let reservation = reserve(&repo, purchase).await;
    let stored = repo
        .convert_reservation(reservation.id, active(50), now())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.size, ComputerSize::Standard);
    assert_eq!(
        stored.resources,
        ComputerResources {
            vcpus: Vcpus::new(6),
            memory_gib: MemoryGib::new(12),
            disk_gib: DiskGib::new(150)
        }
    );
    assert_eq!(stored.catalog_entry.as_str(), "standard@2026-11");
    assert_eq!(
        repo.sold_out_sizes(&crate::domain::size::current_catalog(), now())
            .await
            .unwrap(),
        vec![ComputerSize::Large, ComputerSize::Xl]
    );
    reserve(&repo, standard(51)).await;
    assert!(matches!(
        repo.reserve(standard(52), now(), now() + Duration::minutes(15))
            .await,
        Err(ReserveError::SoldOut)
    ));
}

/// Should-fix S4: a buyer can delete their account. The computer and the
/// reservation keep the buyer's id for attribution, with no foreign key.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_the_buyer_keeps_computers_and_reservations(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone(), policy());
    host(&repo, "reference-host", 24, 0, 1).await;
    let buyer_macro_user = Uuid::from_u128(0x0000_0000_0000_7000_8000_0000_0000_0022);
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, 'buyer@example.com', 'buyer@example.com', 'stripe_buyer')",
        buyer_macro_user,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ('macro|buyer@example.com', 'buyer@example.com', $1)"#,
        buyer_macro_user,
    )
    .execute(&pool)
    .await
    .unwrap();
    let buyer = MacroUserIdStr::try_from("macro|buyer@example.com".to_owned()).unwrap();
    let reservation = reserve(
        &repo,
        NewReservation {
            created_by: buyer.clone(),
            ..standard(70)
        },
    )
    .await;
    let computer = repo
        .convert_reservation(reservation.id, active(70), now())
        .await
        .unwrap()
        .unwrap();
    let pending = reserve(
        &repo,
        NewReservation {
            created_by: buyer,
            ..standard(71)
        },
    )
    .await;
    sqlx::query!(r#"DELETE FROM "User" WHERE id = 'macro|buyer@example.com'"#)
        .execute(&pool)
        .await
        .unwrap();
    assert_eq!(
        repo.get(computer.id).await.unwrap().unwrap().id(),
        computer.id
    );
    assert_eq!(
        repo.reservation(pending.id)
            .await
            .unwrap()
            .unwrap()
            .created_by
            .as_ref(),
        "macro|buyer@example.com"
    );
}

mod enrollment;

mod capacity;
mod waiting;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn fleet_attachment_tracks_host_heartbeat_freshness(pool: PgPool) {
    use crate::domain::models::{FleetAttachment, HOST_HEARTBEAT_FRESHNESS};
    use crate::domain::ports::FleetAttachmentSource;
    let repo = PgComputerRepo::new(pool, policy());
    assert_eq!(
        repo.attachment(now()).await.unwrap(),
        FleetAttachment::Detached
    );
    let host = repo
        .register_host(HostRegistration {
            name: "heartbeat-test".to_owned(),
            memory_gb: 32,
            reserve_gb: 8,
            oversell_factor: 2,
        })
        .await
        .unwrap();
    assert_eq!(
        repo.attachment(Utc::now()).await.unwrap(),
        FleetAttachment::Attached
    );
    repo.heartbeat_host(host.id, now()).await.unwrap();
    assert_eq!(
        repo.attachment(now() + HOST_HEARTBEAT_FRESHNESS - Duration::milliseconds(1))
            .await
            .unwrap(),
        FleetAttachment::Attached
    );
    assert_eq!(
        repo.attachment(now() + HOST_HEARTBEAT_FRESHNESS)
            .await
            .unwrap(),
        FleetAttachment::Detached
    );
    repo.heartbeat_host(host.id, now() + HOST_HEARTBEAT_FRESHNESS)
        .await
        .unwrap();
    assert_eq!(
        repo.attachment(now() + HOST_HEARTBEAT_FRESHNESS)
            .await
            .unwrap(),
        FleetAttachment::Attached
    );
}

/// The sign-in refresh visits awake computers that have a harness.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn awake_computers_are_those_awake_with_a_harness(pool: PgPool) {
    sqlx::raw_sql(
        r#"
        INSERT INTO hosted_runtime_host (id, name, awake_capacity_units, sold_capacity_units)
        VALUES ('00000000-0000-7000-8000-00000000b0b0', 'awake-host', 9, 9);
        INSERT INTO harnesses (id, name, owner_user_id, created_by, computer_id)
        VALUES
            ('00000000-0000-7000-8000-0000000000a1', 'Awake', 'macro|owner@example.com',
                'macro|owner@example.com', '00000000-0000-7000-8000-0000000000c1'),
            ('00000000-0000-7000-8000-0000000000a2', 'Asleep', 'macro|owner@example.com',
                'macro|owner@example.com', '00000000-0000-7000-8000-0000000000c2');
        INSERT INTO hosted_runtime
            (id, team_id, name, size, vcpus, memory_gib, disk_gib, catalog_entry, state,
             created_by, price_id, purchase_key, host_id, awake, harness_id)
        VALUES
            ('00000000-0000-7000-8000-0000000000c1', '00000000-0000-7000-8000-0000000000aa',
                'Awake', 'standard', 4, 8, 100, 'standard@2026-11', '{}',
                'macro|owner@example.com', 'price_standard', 'buy-1',
                '00000000-0000-7000-8000-00000000b0b0', true,
                '00000000-0000-7000-8000-0000000000a1'),
            ('00000000-0000-7000-8000-0000000000c2', '00000000-0000-7000-8000-0000000000aa',
                'Asleep', 'standard', 4, 8, 100, 'standard@2026-11', '{}',
                'macro|owner@example.com', 'price_standard', 'buy-2',
                '00000000-0000-7000-8000-00000000b0b0', false,
                '00000000-0000-7000-8000-0000000000a2'),
            ('00000000-0000-7000-8000-0000000000c3', '00000000-0000-7000-8000-0000000000aa',
                'Unenrolled', 'standard', 4, 8, 100, 'standard@2026-11', '{}',
                'macro|owner@example.com', 'price_standard', 'buy-3',
                '00000000-0000-7000-8000-00000000b0b0', true, NULL);
        "#,
    )
    .execute(&pool)
    .await
    .unwrap();
    let repo = PgComputerRepo::new(pool, policy());

    assert_eq!(
        repo.awake_computers().await.unwrap(),
        vec![(
            HarnessId::new_from_uuid(Uuid::from_u128(0x0000_0000_0000_7000_8000_0000_0000_00a1)),
            ComputerId::new_from_uuid(Uuid::from_u128(0x0000_0000_0000_7000_8000_0000_0000_00c1)),
        )]
    );
}

/// A pool timeout reaches the domain as unavailable storage, which the
/// passes skip quietly; any other database error is still a failure.
#[test]
fn only_a_pool_timeout_is_unavailable_storage() {
    let timed_out = crate::domain::service::ComputerError::Internal(
        rootcause::Report::new(PgComputerError::from(sqlx::Error::PoolTimedOut)).into_dynamic(),
    );
    let missing = crate::domain::service::ComputerError::Internal(
        rootcause::Report::new(PgComputerError::from(sqlx::Error::RowNotFound)).into_dynamic(),
    );

    assert!(timed_out.is_storage_unavailable());
    assert!(!missing.is_storage_unavailable());
}
