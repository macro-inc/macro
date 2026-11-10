use std::str::FromStr;
mod quarantine;
mod redeploy;

mod boot;

use chrono::{Duration, TimeZone};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;

use super::*;
use crate::domain::models::ComputerName;
use crate::domain::size::{DiskGib, MemoryGib, Vcpus};

mod purchase;

const TEAM: Uuid = Uuid::from_u128(0x0000_0000_0000_7000_8000_0000_0000_00aa);

fn now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 4, 12, 0, 0).unwrap()
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

fn standard(id: u128) -> NewComputer {
    NewComputer {
        billing: crate::domain::models::PurchaseBilling::Stripe,
        extra_items: vec![],
        id: ComputerId::new_from_uuid(Uuid::from_u128(id)),
        team_id: TEAM,
        name: ComputerName::try_new(&format!("Computer {id}")).unwrap(),
        size: ComputerSize::Standard,
        resources: crate::domain::size::ComputerResources {
            vcpus: crate::domain::size::Vcpus::new(4),
            memory_gib: crate::domain::size::MemoryGib::new(8),
            disk_gib: crate::domain::size::DiskGib::new(100),
        },
        catalog_entry: crate::domain::size::CatalogEntryId::try_new("standard@2026-11".to_owned())
            .unwrap(),
        price_id: Some(stripe::PriceId::from_str("price_standard").unwrap()),
        created_by: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reserve_holds_sold_units_until_the_host_is_sold_out(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool);
    // 31 GB, 7 reserved: 3 awake units, sold 3x.
    let host = repo
        .register_host(HostRegistration {
            name: "runtime-dev-1".to_owned(),
            memory_gb: 31,
            reserve_gb: 7,
            oversell_factor: 3,
        })
        .await
        .unwrap();
    assert_eq!(
        (host.awake_capacity_units, host.sold_capacity_units),
        (3, 9)
    );

    for id in 1..=9 {
        repo.reserve(standard(id), now()).await.unwrap();
    }
    let tenth = repo.reserve(standard(10), now()).await;

    assert!(matches!(tenth, Err(ReserveError::SoldOut)));
    assert_eq!(
        repo.sold_out_sizes(&crate::domain::size::current_catalog())
            .await
            .unwrap(),
        vec![
            ComputerSize::Standard,
            ComputerSize::Large,
            ComputerSize::Xl
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn apply_stores_state_effects_and_timers_and_wakes_only_with_room(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool);
    let host = repo
        .register_host(HostRegistration {
            name: "small".to_owned(),
            memory_gb: 15,
            reserve_gb: 7,
            oversell_factor: 2,
        })
        .await
        .unwrap();
    assert_eq!(host.awake_capacity_units, 1);
    repo.reserve(standard(1), now()).await.unwrap();
    repo.reserve(standard(2), now()).await.unwrap();

    let first = repo
        .apply(
            ComputerId::new_from_uuid(Uuid::from_u128(1)),
            Event::PaymentConfirmed,
            now(),
        )
        .await
        .unwrap()
        .unwrap();
    let second = repo
        .apply(
            ComputerId::new_from_uuid(Uuid::from_u128(2)),
            Event::PaymentConfirmed,
            now(),
        )
        .await
        .unwrap()
        .unwrap();

    assert_eq!(
        first.state.phase,
        Phase::Provisioning {
            host: host.id,
            start: true
        }
    );
    assert_eq!(
        second.state.phase,
        Phase::Provisioning {
            host: host.id,
            start: false
        }
    );
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
                ComputerId::new_from_uuid(Uuid::from_u128(1)),
                Effect::Create {
                    host: host.id,
                    start: true,
                    generation: crate::domain::enrollment::EnrollmentGeneration::new(1),
                }
            ),
            (
                ComputerId::new_from_uuid(Uuid::from_u128(2)),
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
    let repo = PgComputerRepo::new(pool);
    repo.register_host(HostRegistration {
        name: "runtime-dev-1".to_owned(),
        memory_gb: 31,
        reserve_gb: 7,
        oversell_factor: 3,
    })
    .await
    .unwrap();
    let id = ComputerId::new_from_uuid(Uuid::from_u128(1));
    repo.reserve(standard(1), now()).await.unwrap();
    repo.apply(id, Event::PaymentConfirmed, now())
        .await
        .unwrap();
    repo.apply(id, Event::InstanceStarted, now()).await.unwrap();
    repo.apply(id, Event::MacrodConnected, now()).await.unwrap();
    repo.apply(id, Event::SessionsIdle, now()).await.unwrap();
    repo.apply(id, Event::PromptArrived, now()).await.unwrap();

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
    assert!(matches!(second[0].effect, Effect::Freeze { .. }));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_replaced_timer_does_not_fire(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool);
    repo.register_host(HostRegistration {
        name: "runtime-dev-1".to_owned(),
        memory_gb: 31,
        reserve_gb: 7,
        oversell_factor: 3,
    })
    .await
    .unwrap();
    repo.reserve(standard(1), now()).await.unwrap();

    repo.apply(
        ComputerId::new_from_uuid(Uuid::from_u128(1)),
        Event::PaymentConfirmed,
        now(),
    )
    .await
    .unwrap();
    repo.apply(
        ComputerId::new_from_uuid(Uuid::from_u128(1)),
        Event::InstanceStarted,
        now(),
    )
    .await
    .unwrap();
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
    assert!(matches!(crashed.state.phase, Phase::Restarting { .. }));
    assert_eq!(repo.list_for_team(TEAM).await.unwrap().len(), 1);
    assert_eq!(
        repo.sold_out_sizes(&crate::domain::size::current_catalog())
            .await
            .unwrap(),
        vec![]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn lifecycle_selectors_read_the_nested_phase_tag(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool);
    let host = repo
        .register_host(HostRegistration {
            name: "selector-host".into(),
            memory_gb: 31,
            reserve_gb: 7,
            oversell_factor: 3,
        })
        .await
        .unwrap();
    let id = ComputerId::new_from_uuid(Uuid::from_u128(1));
    repo.reserve(standard(1), now()).await.unwrap();
    assert!(repo.instances_expected(host.id).await.unwrap().is_empty());
    repo.apply(id, Event::PaymentConfirmed, now())
        .await
        .unwrap();
    assert_eq!(repo.instances_expected(host.id).await.unwrap().len(), 1);
    repo.apply(id, Event::InstanceStarted, now()).await.unwrap();
    repo.apply(id, Event::MacrodConnected, now()).await.unwrap();
    assert_eq!(
        repo.running()
            .await
            .unwrap()
            .iter()
            .map(|c| c.id())
            .collect::<Vec<_>>(),
        vec![id]
    );
    assert_eq!(repo.coldest_frozen(host.id).await.unwrap(), None);
    repo.apply(id, Event::SessionsIdle, now()).await.unwrap();
    assert!(repo.running().await.unwrap().is_empty());
    assert_eq!(repo.coldest_frozen(host.id).await.unwrap(), Some(id));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reserve_atomically_schedules_confirmation_and_failed_payment_frees_capacity(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone());
    let host = repo
        .register_host(HostRegistration {
            name: "payment-host".to_owned(),
            memory_gb: 15,
            reserve_gb: 7,
            oversell_factor: 1,
        })
        .await
        .unwrap();
    let mut purchase = standard(1);
    purchase.extra_items = vec![crate::domain::models::SubscriptionItem {
        price_id: stripe::PriceId::from_str("price_seat").unwrap(),
        quantity: 1,
    }];
    let computer = repo.reserve(purchase, now()).await.unwrap();
    assert_eq!(
        computer.state.phase,
        Phase::PendingPayment {
            host: host.id,
            since: now()
        }
    );
    assert!(
        repo.due_timers(now() + Duration::days(1), 10)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(
        repo.lease_effects(
            EffectWorker::Billing,
            10,
            now(),
            now() + Duration::minutes(1)
        )
        .await
        .unwrap()
        .is_empty()
    );
    let effects = repo
        .lease_effects(
            EffectWorker::Billing,
            10,
            now() + Duration::minutes(2),
            now() + Duration::minutes(3),
        )
        .await
        .unwrap();
    assert_eq!(effects.len(), 1);
    assert_eq!(
        effects[0].computer_id,
        ComputerId::new_from_uuid(Uuid::from_u128(1))
    );
    assert_eq!(
        effects[0].effect,
        Effect::ConfirmPayment {
            extra_items: vec![crate::domain::models::SubscriptionItem {
                price_id: stripe::PriceId::from_str("price_seat").unwrap(),
                quantity: 1
            }]
        }
    );
    repo.apply(
        ComputerId::new_from_uuid(Uuid::from_u128(1)),
        Event::PurchaseFailed,
        now(),
    )
    .await
    .unwrap();
    let row = sqlx::query!(
        "SELECT holds_units, awake, host_id FROM hosted_runtime WHERE id = $1",
        Uuid::from_u128(1)
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(!row.holds_units);
    assert!(!row.awake);
    assert_eq!(row.host_id, None);
    assert_eq!(
        repo.list_for_team(TEAM).await.unwrap()[0].status().status,
        crate::domain::models::ComputerStatusKind::PaymentFailed
    );
    assert!(repo.instances_expected(host.id).await.unwrap().is_empty());
    repo.reserve(standard(2), now()).await.unwrap();
    repo.apply(
        ComputerId::new_from_uuid(Uuid::from_u128(1)),
        Event::ReleaseNow,
        now(),
    )
    .await
    .unwrap();
    let removal_count = sqlx::query_scalar!("SELECT COUNT(*) FROM hosted_runtime_effect WHERE computer_id = $1 AND effect->>'effect' = 'remove_billing_item'", Uuid::from_u128(1)).fetch_one(&pool).await.unwrap();
    assert_eq!(removal_count, Some(0));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn payment_resolution_is_serialized_per_computer_across_repositories(pool: PgPool) {
    let repo = PgComputerRepo::new(pool.clone());
    let id = ComputerId::new_from_uuid(Uuid::from_u128(42));
    let guard = repo.lock_payment(id).await.unwrap();
    let mut competing = pool.begin().await.unwrap();
    let key = format!("computer-payment:{id}");
    let locked = sqlx::query_scalar!(
        r#"SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS "locked!""#,
        key
    )
    .fetch_one(&mut *competing)
    .await
    .unwrap();
    assert!(!locked);
    let other = PgComputerRepo::new(pool.clone())
        .lock_payment(ComputerId::new_from_uuid(Uuid::from_u128(43)))
        .await
        .unwrap();
    other.commit().await.unwrap();
    guard.commit().await.unwrap();
    let locked = sqlx::query_scalar!(
        r#"SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0)) AS "locked!""#,
        key
    )
    .fetch_one(&mut *competing)
    .await
    .unwrap();
    assert!(locked);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn payment_provenance_migration_backfills_legacy_rows_and_preserves_resolved_values(
    pool: PgPool,
) {
    use crate::domain::lifecycle::PaymentOutcome;

    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool.clone());
    repo.register_host(HostRegistration {
        name: "migration-test".to_owned(),
        memory_gb: 64,
        reserve_gb: 8,
        oversell_factor: 3,
    })
    .await
    .unwrap();
    for id in 1..=5 {
        repo.reserve(standard(id), now()).await.unwrap();
    }
    repo.apply(
        ComputerId::new_from_uuid(Uuid::from_u128(2)),
        Event::PurchaseFailed,
        now(),
    )
    .await
    .unwrap();
    repo.apply(
        ComputerId::new_from_uuid(Uuid::from_u128(3)),
        Event::PaymentConfirmed,
        now(),
    )
    .await
    .unwrap();
    repo.apply(
        ComputerId::new_from_uuid(Uuid::from_u128(4)),
        Event::PaymentConfirmed,
        now(),
    )
    .await
    .unwrap();
    repo.apply(
        ComputerId::new_from_uuid(Uuid::from_u128(4)),
        Event::ReleaseNow,
        now(),
    )
    .await
    .unwrap();
    repo.apply(
        ComputerId::new_from_uuid(Uuid::from_u128(5)),
        Event::PurchaseFailed,
        now(),
    )
    .await
    .unwrap();
    repo.apply(
        ComputerId::new_from_uuid(Uuid::from_u128(5)),
        Event::ReleaseNow,
        now(),
    )
    .await
    .unwrap();

    sqlx::query!(
        "UPDATE hosted_runtime SET state = state - 'payment' WHERE id <> $1",
        Uuid::from_u128(5),
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query_file!(
        "../macro_db_client/migrations/20261105132859_hosted_runtime_payment_provenance.sql"
    )
    .execute(&pool)
    .await
    .unwrap();

    for (id, expected) in [
        (1, PaymentOutcome::Pending),
        (2, PaymentOutcome::Unbilled),
        (3, PaymentOutcome::Paid),
        (4, PaymentOutcome::Paid),
        (5, PaymentOutcome::Unbilled),
    ] {
        let computer = repo
            .get(ComputerId::new_from_uuid(Uuid::from_u128(id)))
            .await
            .unwrap()
            .unwrap()
            .into_healthy()
            .unwrap();
        assert_eq!(computer.state.payment, expected);
        assert_eq!(computer.status().payment.unwrap(), expected);
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn comped_reservation_commits_provisioning_without_payment_recovery(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool);
    repo.register_host(HostRegistration {
        name: "test-host".to_owned(),
        memory_gb: 32,
        reserve_gb: 4,
        oversell_factor: 2,
    })
    .await
    .unwrap();
    let mut request = standard(19);
    request.price_id = None;
    request.billing = crate::domain::models::PurchaseBilling::Comped {
        reason: "internal team".to_owned(),
    };
    let reserved = repo.reserve(request, now()).await.unwrap();
    assert!(matches!(reserved.state.phase, Phase::Provisioning { .. }));
    assert_eq!(reserved.price_id, None);
    let comped = repo
        .get(reserved.id)
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
        .unwrap();
    assert!(matches!(comped.state.phase, Phase::Provisioning { .. }));
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
    let effects = repo
        .lease_effects(EffectWorker::Fleet, 10, now(), now() + Duration::minutes(1))
        .await
        .unwrap();
    assert_eq!(effects.len(), 1);
    assert!(matches!(effects[0].effect, Effect::Create { .. }));
    assert_eq!(
        comped.state.payment,
        crate::domain::lifecycle::PaymentOutcome::Comped
    );
    assert_eq!(
        repo.get(reserved.id)
            .await
            .unwrap()
            .unwrap()
            .into_healthy()
            .unwrap()
            .status()
            .comp_reason
            .as_deref(),
        Some("internal team")
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn capacity_counts_recorded_resources_independently_of_size(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool);
    repo.register_host(HostRegistration {
        name: "resource-host".to_owned(),
        memory_gb: 24,
        reserve_gb: 0,
        oversell_factor: 1,
    })
    .await
    .unwrap();
    let mut request = standard(50);
    request.resources = ComputerResources {
        vcpus: Vcpus::new(6),
        memory_gib: MemoryGib::new(12),
        disk_gib: DiskGib::new(150),
    };
    repo.reserve(request, now()).await.unwrap();
    let stored = repo
        .get(ComputerId::new_from_uuid(Uuid::from_u128(50)))
        .await
        .unwrap()
        .unwrap()
        .into_healthy()
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
    assert_eq!(stored.price_id.unwrap().as_str(), "price_standard");
    assert_eq!(
        repo.sold_out_sizes(&crate::domain::size::current_catalog())
            .await
            .unwrap(),
        vec![ComputerSize::Large, ComputerSize::Xl]
    );
    repo.reserve(standard(51), now()).await.unwrap();
    assert!(matches!(
        repo.reserve(standard(52), now()).await,
        Err(ReserveError::SoldOut)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reservation_rejects_a_missing_purchaser(pool: PgPool) {
    insert_team(&pool).await;
    let repo = PgComputerRepo::new(pool);
    repo.register_host(HostRegistration {
        name: "reference-host".to_owned(),
        memory_gb: 24,
        reserve_gb: 0,
        oversell_factor: 1,
    })
    .await
    .unwrap();
    let mut request = standard(70);
    request.created_by = MacroUserIdStr::try_from("macro|missing@example.com".to_owned()).unwrap();
    let error = repo.reserve(request, now()).await.unwrap_err();
    let ReserveError::Storage(PgComputerError::Sqlx(sqlx::Error::Database(error))) = error else {
        panic!("expected a database foreign key error, got {error:?}");
    };
    assert_eq!(error.code().as_deref(), Some("23503"));
    assert_eq!(error.constraint(), Some("hosted_runtime_created_by_fkey"));
}

mod enrollment;

mod capacity;
mod waiting;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn fleet_attachment_tracks_host_heartbeat_freshness(pool: PgPool) {
    use crate::domain::models::{FleetAttachment, HOST_HEARTBEAT_FRESHNESS};
    use crate::domain::ports::FleetAttachmentSource;
    let repo = PgComputerRepo::new(pool);
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
