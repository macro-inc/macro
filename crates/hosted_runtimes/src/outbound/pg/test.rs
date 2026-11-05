use chrono::{Duration, TimeZone};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;

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
        id: Uuid::from_u128(id),
        team_id: TEAM,
        name: format!("Computer {id}"),
        size: ComputerSize::Standard,
        persona: None,
        created_by: "macro|owner@example.com".to_owned(),
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
        repo.sold_out_sizes().await.unwrap(),
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
        .apply(Uuid::from_u128(1), Event::PaymentConfirmed, now())
        .await
        .unwrap()
        .unwrap();
    let second = repo
        .apply(Uuid::from_u128(2), Event::PaymentConfirmed, now())
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
    let leased = repo
        .lease_effects(EffectWorker::Fleet, 10, now(), now() + Duration::minutes(1))
        .await
        .unwrap();
    assert_eq!(
        leased
            .iter()
            .map(|pending| (pending.computer_id, pending.effect.clone()))
            .collect::<Vec<_>>(),
        vec![
            (
                Uuid::from_u128(1),
                Effect::Create {
                    host: host.id,
                    start: true
                }
            ),
            (
                Uuid::from_u128(2),
                Effect::Create {
                    host: host.id,
                    start: false
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
    let id = Uuid::from_u128(1);
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

    let due = repo
        .due_timers(now() + Duration::hours(1), 10)
        .await
        .unwrap();
    assert_eq!(due.len(), 1);
    assert_eq!(due[0].kind, TimerKind::ReservationExpired);

    let mut stale = due[0].clone();
    stale.fire_at -= Duration::seconds(1);
    assert_eq!(repo.fire_timer(stale, now()).await.unwrap(), None);

    let expired = repo
        .fire_timer(due[0].clone(), now() + Duration::hours(1))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(expired.state.phase, Phase::Destroyed);
    assert_eq!(repo.list_for_team(TEAM).await.unwrap(), vec![]);
    assert_eq!(repo.sold_out_sizes().await.unwrap(), vec![]);
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
    let id = Uuid::from_u128(1);
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
            .map(|c| c.id)
            .collect::<Vec<_>>(),
        vec![id]
    );
    assert_eq!(repo.coldest_frozen(host.id).await.unwrap(), None);
    repo.apply(id, Event::SessionsIdle, now()).await.unwrap();
    assert!(repo.running().await.unwrap().is_empty());
    assert_eq!(repo.coldest_frozen(host.id).await.unwrap(), Some(id));
}
