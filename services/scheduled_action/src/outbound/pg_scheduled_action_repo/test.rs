mod user_cleanup;

use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use model_owner::Owner;
use serde_json::json;
use sqlx::PgPool;

use super::*;
use crate::domain::event_runs::ConfigurationRevision;
use crate::domain::event_trigger::{ActionTrigger, EventFilter, EventFilters, EventName};
use crate::domain::models::{ActionKind, AlreadyRunningError, Schedule, ScheduledAction};
use crate::domain::ports::ScheduledActionRepo;

const USER_A: &str = "macro|sched-a@macro.com";
const USER_B: &str = "macro|sched-b@macro.com";
const DAILY_9AM: &str = "0 0 9 * * *";

fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).expect("valid user id")
}

fn user_owner(id: &'static str) -> Owner {
    Owner::User(user(id))
}

async fn insert_user(pool: &PgPool, id: &str) {
    let macro_user_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)"#,
        macro_user_id,
        id,
    )
    .execute(pool)
    .await
    .expect("macro_user should insert");
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        id,
        macro_user_id,
    )
    .execute(pool)
    .await
    .expect("user should insert");
}

fn sample_action(owner: Owner, name: &str) -> ScheduledAction {
    let now = Utc::now();
    let schedule = Schedule::from_cron(DAILY_9AM.to_string()).expect("valid cron");
    let timezone = chrono_tz::UTC;
    let next_run_at = schedule
        .next_run_after_now(timezone)
        .expect("schedule has a future firing");
    ScheduledAction {
        id: None,
        owner,
        name: name.to_string(),
        trigger: ActionTrigger::Cron { schedule, timezone },
        kind: ActionKind::Agent,
        created_at: now,
        updated_at: now,
        configuration_revision: ConfigurationRevision::INITIAL,
        event_activated_at: None,
        task: json!({}),
        claimed: None,
        next_run_at: Some(next_run_at),
        enabled: true,
    }
}

async fn entity_row_count(pool: &PgPool, id: Uuid) -> i64 {
    sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM entity WHERE id = $1"#,
        id
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn scheduled_action_row_count(pool: &PgPool, id: Uuid) -> i64 {
    sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM scheduled_action WHERE id = $1"#,
        id,
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_action_returns_id_and_is_listable_by_owner(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgScheduledActionRepo::new(pool);

    let created = repo
        .create_action(sample_action(user_owner(USER_A), "standup"))
        .await
        .expect("create should succeed");
    assert_eq!(created.id.unwrap().get_version_num(), 7);
    assert_eq!(created.owner, user_owner(USER_A));

    let listed = repo
        .get_actions(user(USER_A))
        .await
        .expect("list should succeed");
    assert_eq!(listed.len(), 1);
    assert_eq!(listed[0].name, "standup");
    assert_eq!(listed[0].id, created.id);
    assert_eq!(listed[0].owner, user_owner(USER_A));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn other_owner_list_is_empty(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let repo = PgScheduledActionRepo::new(pool);

    repo.create_action(sample_action(user_owner(USER_A), "standup"))
        .await
        .expect("create should succeed");

    let owner_listed = repo
        .get_actions(user(USER_A))
        .await
        .expect("owner list should succeed");
    assert_eq!(owner_listed.len(), 1);

    let listed = repo
        .get_actions(user(USER_B))
        .await
        .expect("list should succeed");
    assert!(listed.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn update_action_changes_name_schedule_and_enabled(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgScheduledActionRepo::new(pool);

    let created = repo
        .create_action(sample_action(user_owner(USER_A), "standup"))
        .await
        .expect("create should succeed");

    let schedule = Schedule::from_cron("0 0 18 * * *".to_string()).expect("valid cron");
    let next_run_at = schedule
        .next_run_after_now(chrono_tz::UTC)
        .expect("schedule has a future firing");
    let updated = repo
        .update_action(ScheduledAction {
            configuration_revision: created.configuration_revision.next().unwrap(),
            name: "evening standup".to_string(),
            trigger: ActionTrigger::Cron {
                schedule,
                timezone: chrono_tz::UTC,
            },
            enabled: false,
            next_run_at: Some(next_run_at),
            ..created
        })
        .await
        .expect("update should succeed");

    assert_eq!(updated.name, "evening standup");
    let ActionTrigger::Cron { schedule, .. } = updated.trigger else {
        panic!("expected cron trigger");
    };
    assert_eq!(schedule.as_str(), "0 0 18 * * *");
    assert!(!updated.enabled);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn replacement_is_fenced_against_claims_and_stale_revisions(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgScheduledActionRepo::new(pool);
    let action = repo.create_action(event_action()).await.unwrap();
    let id = action.id.unwrap();
    let mut replacement = action.clone();
    replacement.configuration_revision = action.configuration_revision.next().unwrap();
    replacement.name = "replacement".into();

    // Claim after management read, before its write.
    let token = repo.claim_action(&id).await.unwrap();
    let error = repo.update_action(replacement.clone()).await.unwrap_err();
    assert!(matches!(
        error.downcast_ref(),
        Some(ActionPolicyError::UpdateConflict)
    ));
    let disabled = repo
        .update_action(ScheduledAction {
            enabled: false,
            configuration_revision: replacement.configuration_revision,
            ..action
        })
        .await
        .unwrap();
    assert!(disabled.claimed.is_some());
    repo.release_action(&id, token).await.unwrap();

    // The earlier replacement is stale even after execution has finished.
    let error = repo.update_action(replacement).await.unwrap_err();
    assert!(matches!(
        error.downcast_ref(),
        Some(ActionPolicyError::UpdateConflict)
    ));
    let current = repo.get_action(&id, user(USER_A)).await.unwrap().unwrap();
    assert!(!current.enabled);
    assert_eq!(
        current.configuration_revision,
        disabled.configuration_revision
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn second_claim_returns_already_running(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgScheduledActionRepo::new(pool);

    let created = repo
        .create_action(sample_action(user_owner(USER_A), "standup"))
        .await
        .expect("create should succeed");
    let id = created.id.expect("create returns Some(id)");

    repo.claim_action(&id)
        .await
        .expect("first claim should succeed");
    let error = repo
        .claim_action(&id)
        .await
        .expect_err("second claim should fail");
    assert!(error.downcast_ref::<AlreadyRunningError>().is_some());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn release_is_fenced_to_its_own_execution(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgScheduledActionRepo::new(pool);
    let action = repo
        .create_action(sample_action(user_owner(USER_A), "fenced"))
        .await
        .unwrap();
    let id = action.id.unwrap();
    let old = repo.claim_action(&id).await.unwrap();
    repo.release_action(&id, crate::domain::event_runs::ClaimToken::generate())
        .await
        .unwrap();
    assert!(repo.claim_action(&id).await.is_err());
    repo.release_action(&id, old).await.unwrap();
    let current = repo.claim_action(&id).await.unwrap();
    assert_ne!(old, current);
    repo.release_action(&id, old).await.unwrap();
    assert!(repo.claim_action(&id).await.is_err());
    repo.release_action(&id, current).await.unwrap();
    assert!(repo.claim_action(&id).await.is_ok());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_action_removes_row_from_owner_list(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgScheduledActionRepo::new(pool.clone());

    let created = repo
        .create_action(sample_action(user_owner(USER_A), "standup"))
        .await
        .expect("create should succeed");
    let id = created.id.expect("create returns Some(id)");

    repo.delete_action(&id, user(USER_A))
        .await
        .expect("delete should succeed");

    let listed = repo
        .get_actions(user(USER_A))
        .await
        .expect("list should succeed");
    assert!(listed.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn create_action_registers_entity_row(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgScheduledActionRepo::new(pool.clone());

    let created = repo
        .create_action(sample_action(user_owner(USER_A), "standup"))
        .await
        .expect("create should succeed");
    let id = created.id.expect("create returns Some(id)");

    let row = sqlx::query!(
        r#"
        SELECT
            owner_type::text AS "owner_type!",
            owner_id,
            entity_type,
            deleted_at
        FROM entity
        WHERE id = $1
        "#,
        id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(row.entity_type, "scheduled_action");
    assert_eq!(row.owner_type, "user");
    assert_eq!(row.owner_id, USER_A);
    assert_eq!(row.deleted_at, None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_action_removes_entity_row(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgScheduledActionRepo::new(pool.clone());

    let created = repo
        .create_action(sample_action(user_owner(USER_A), "standup"))
        .await
        .expect("create should succeed");
    let id = created.id.expect("create returns Some(id)");

    repo.delete_action(&id, user(USER_A))
        .await
        .expect("delete should succeed");

    assert_eq!(entity_row_count(&pool, id).await, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_action_succeeds_when_entity_row_is_missing(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgScheduledActionRepo::new(pool.clone());

    let created = repo
        .create_action(sample_action(user_owner(USER_A), "standup"))
        .await
        .expect("create should succeed");
    let id = created.id.expect("create returns Some(id)");

    sqlx::query!("DELETE FROM entity WHERE id = $1", id)
        .execute(&pool)
        .await
        .expect("entity row should delete");

    repo.delete_action(&id, user(USER_A))
        .await
        .expect("delete should succeed");

    assert_eq!(entity_row_count(&pool, id).await, 0);
    assert_eq!(scheduled_action_row_count(&pool, id).await, 0);
}

fn event_action() -> ScheduledAction {
    let filters = EventFilters::try_from(vec![
        EventFilter::new(vec![EventName::DocumentCreated], None).unwrap(),
    ])
    .unwrap();
    ScheduledAction {
        trigger: ActionTrigger::Events { filters },
        next_run_at: None,
        event_activated_at: Some(Utc::now()),
        ..sample_action(user_owner(USER_A), "document routine")
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn event_round_trip_and_bookkeeping_does_not_advance_configuration(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgScheduledActionRepo::new(pool);
    let created = repo.create_action(event_action()).await.unwrap();
    let id = created.id.unwrap();
    assert_eq!(id.get_version_num(), 7);
    let before = repo.get_action(&id, user(USER_A)).await.unwrap().unwrap();
    assert!(matches!(before.trigger, ActionTrigger::Events { .. }));
    assert_eq!(before.next_run_at, None);
    assert!(before.event_activated_at.is_some());
    repo.update_next_run_at(&id).await.unwrap();
    let after = repo.get_action(&id, user(USER_A)).await.unwrap().unwrap();
    assert_eq!(after.updated_at, before.updated_at);
    assert_eq!(after.next_run_at, None);
    let token = repo.claim_action(&id).await.unwrap();
    repo.release_action(&id, token).await.unwrap();
    repo.update_last_executed(&id, Utc::now()).await.unwrap();
    let after = repo.get_action(&id, user(USER_A)).await.unwrap().unwrap();
    assert_eq!(after.configuration_revision, before.configuration_revision);
    assert_eq!(after.event_activated_at, before.event_activated_at);
    assert_eq!(
        serde_json::to_value(&after.trigger).unwrap(),
        serde_json::to_value(&before.trigger).unwrap()
    );

    let filters = EventFilters::try_from(vec![
        EventFilter::new(
            vec![EventName::ChannelMessagePosted],
            Some(vec![macro_uuid::generate_uuid_v7()]),
        )
        .unwrap(),
    ])
    .unwrap();
    let updated = repo
        .update_action(ScheduledAction {
            trigger: ActionTrigger::Events {
                filters: filters.clone(),
            },
            enabled: false,
            configuration_revision: after.configuration_revision.next().unwrap(),
            ..after
        })
        .await
        .unwrap();
    let ActionTrigger::Events {
        filters: stored_filters,
    } = updated.trigger
    else {
        panic!("expected event trigger");
    };
    assert_eq!(stored_filters, filters);
    assert!(!updated.enabled);
    assert_eq!(updated.next_run_at, None);
    assert_eq!(updated.configuration_revision.get(), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn lookup_update_and_delete_are_owner_scoped(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let repo = PgScheduledActionRepo::new(pool.clone());
    for action in [sample_action(user_owner(USER_A), "cron"), event_action()] {
        let created = repo.create_action(action).await.unwrap();
        let id = created.id.unwrap();
        assert!(repo.get_action(&id, user(USER_B)).await.unwrap().is_none());
        let mut foreign_update = created.clone();
        foreign_update.owner = user_owner(USER_B);
        foreign_update.configuration_revision = created.configuration_revision.next().unwrap();
        assert!(repo.update_action(foreign_update).await.is_err());
        repo.delete_action(&id, user(USER_B)).await.unwrap();
        assert!(repo.get_action(&id, user(USER_A)).await.unwrap().is_some());
        assert_eq!(entity_row_count(&pool, id).await, 1);
        repo.delete_action(&id, user(USER_A)).await.unwrap();
        assert!(repo.get_action(&id, user(USER_A)).await.unwrap().is_none());
        assert_eq!(entity_row_count(&pool, id).await, 0);
    }
    assert!(
        repo.get_action(&macro_uuid::generate_uuid_v7(), user(USER_A))
            .await
            .unwrap()
            .is_none()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn trigger_transitions_replace_all_trigger_columns(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgScheduledActionRepo::new(pool);
    let cron = repo
        .create_action(sample_action(user_owner(USER_A), "cron"))
        .await
        .unwrap();
    let events = event_action();
    let event = repo
        .update_action(ScheduledAction {
            trigger: events.trigger,
            next_run_at: None,
            event_activated_at: events.event_activated_at,
            configuration_revision: cron.configuration_revision.next().unwrap(),
            ..cron
        })
        .await
        .unwrap();
    assert!(matches!(event.trigger, ActionTrigger::Events { .. }));
    assert_eq!(event.configuration_revision.get(), 2);
    assert!(
        repo.get_next_unclaimed_actions(10)
            .await
            .unwrap()
            .is_empty()
    );
    let cron_config = sample_action(user_owner(USER_A), "cron again");
    let cron = repo
        .update_action(ScheduledAction {
            trigger: cron_config.trigger,
            next_run_at: cron_config.next_run_at,
            event_activated_at: None,
            configuration_revision: event.configuration_revision.next().unwrap(),
            ..event
        })
        .await
        .unwrap();
    assert!(matches!(cron.trigger, ActionTrigger::Cron { .. }));
    assert_eq!(cron.configuration_revision.get(), 3);
    assert_eq!(cron.event_activated_at, None);
    assert!(cron.next_run_at.is_some());
    assert_eq!(repo.get_next_unclaimed_actions(10).await.unwrap().len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn polling_returns_only_enabled_unclaimed_cron_rows(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgScheduledActionRepo::new(pool);
    repo.create_action(event_action()).await.unwrap();
    let disabled = ScheduledAction {
        enabled: false,
        ..sample_action(user_owner(USER_A), "disabled")
    };
    repo.create_action(disabled).await.unwrap();
    let claimed = repo
        .create_action(sample_action(user_owner(USER_A), "claimed"))
        .await
        .unwrap();
    repo.claim_action(&claimed.id.unwrap()).await.unwrap();
    let cron = repo
        .create_action(sample_action(user_owner(USER_A), "cron"))
        .await
        .unwrap();
    let candidates = repo.get_next_unclaimed_actions(1).await.unwrap();
    assert_eq!(candidates.len(), 1);
    assert_eq!(candidates[0].id, cron.id);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deployed_cron_insert_remains_valid(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let next_run_at = Utc::now();
    // Exactly the deployed writer's columns: no new discriminator, revision,
    // activation, filters or application-generated ID.
    let row = sqlx::query!(
        r#"
        INSERT INTO scheduled_action (owner, name, schedule, kind, timezone, task, next_run_at, enabled)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, trigger_type, configuration_revision, event_filters, event_activated_at
        "#,
        USER_A, "legacy", DAILY_9AM, "Agent", "UTC", json!({}), next_run_at, true,
    ).fetch_one(&pool).await.unwrap();
    assert_eq!(row.trigger_type, "cron");
    assert_eq!(row.configuration_revision, 1);
    assert_eq!(row.event_filters, None);
    assert_eq!(row.event_activated_at, None);
    let repo = PgScheduledActionRepo::new(pool);
    let action = repo
        .get_action(&row.id, user(USER_A))
        .await
        .unwrap()
        .unwrap();
    assert!(matches!(action.trigger, ActionTrigger::Cron { .. }));
    assert!(action.next_run_at.is_some());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn database_rejects_invalid_trigger_shapes(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let now = Utc::now();
    let filters = json!([{ "events": ["document.created"] }]);
    // SQL CHECK must reject NULL/unknown discriminators, mixed triggers, absent
    // cron fields, absent event activation/filters, and non-array/empty filters.
    let cases = [
        (
            Some("unknown"),
            Some(DAILY_9AM),
            Some("UTC"),
            Some(now),
            None,
            None,
            1,
        ),
        (Some("cron"), None, Some("UTC"), Some(now), None, None, 1),
        (
            Some("cron"),
            Some(DAILY_9AM),
            None,
            Some(now),
            None,
            None,
            1,
        ),
        (
            Some("cron"),
            Some(DAILY_9AM),
            Some("UTC"),
            None,
            None,
            None,
            1,
        ),
        (
            Some("cron"),
            Some(DAILY_9AM),
            Some("UTC"),
            Some(now),
            Some(filters.clone()),
            None,
            1,
        ),
        (
            Some("cron"),
            Some(DAILY_9AM),
            Some("UTC"),
            Some(now),
            None,
            Some(now),
            1,
        ),
        (Some("events"), None, None, None, None, Some(now), 1),
        (
            Some("events"),
            None,
            None,
            None,
            Some(filters.clone()),
            None,
            1,
        ),
        (
            Some("events"),
            Some(DAILY_9AM),
            None,
            None,
            Some(filters.clone()),
            Some(now),
            1,
        ),
        (
            Some("events"),
            None,
            Some("UTC"),
            None,
            Some(filters.clone()),
            Some(now),
            1,
        ),
        (
            Some("events"),
            None,
            None,
            Some(now),
            Some(filters.clone()),
            Some(now),
            1,
        ),
        (
            Some("events"),
            None,
            None,
            None,
            Some(json!(null)),
            Some(now),
            1,
        ),
        (
            Some("events"),
            None,
            None,
            None,
            Some(json!({})),
            Some(now),
            1,
        ),
        (
            Some("events"),
            None,
            None,
            None,
            Some(json!([])),
            Some(now),
            1,
        ),
        (
            Some("events"),
            None,
            None,
            None,
            Some(json!(vec![filters.clone(); 33])),
            Some(now),
            1,
        ),
        (
            Some("events"),
            None,
            None,
            None,
            Some(filters),
            Some(now),
            0,
        ),
        (None, Some(DAILY_9AM), Some("UTC"), Some(now), None, None, 1),
    ];
    for (trigger_type, schedule, timezone, next_run_at, filters, activated_at, revision) in cases {
        let id = macro_uuid::generate_uuid_v7();
        let error = sqlx::query!(
            r#"
            INSERT INTO scheduled_action
                (id, owner, name, kind, task, enabled, trigger_type, schedule, timezone,
                 next_run_at, event_filters, event_activated_at, configuration_revision)
            VALUES ($1, $2, 'invalid', 'Agent', '{}', true, $3, $4, $5, $6, $7, $8, $9)
            "#,
            id,
            USER_A,
            trigger_type,
            schedule,
            timezone,
            next_run_at,
            filters,
            activated_at,
            revision,
        )
        .execute(&pool)
        .await
        .expect_err("invalid shape must fail");
        let code = error.as_database_error().unwrap().code().unwrap();
        assert!(
            code == "23514" || code == "23502",
            "expected constraint violation: {error}"
        );
    }
}
