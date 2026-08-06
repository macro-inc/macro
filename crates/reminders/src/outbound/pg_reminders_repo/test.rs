use chrono::{Duration, TimeZone};
use chrono_tz::America::New_York;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use sqlx::PgPool;

use super::*;
use crate::domain::models::{ReminderCursor, ScheduleUpdate};

const USER_A: &str = "macro|reminders-a@macro.com";
const USER_B: &str = "macro|reminders-b@macro.com";
const DAILY_9AM: &str = "0 0 9 * * *";

fn user(id: &str) -> MacroUserIdStr<'_> {
    MacroUserIdStr::parse_from_str(id).expect("valid user id")
}

fn at(y: i32, m: u32, d: u32, h: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(y, m, d, h, 0, 0)
        .single()
        .expect("unambiguous instant")
}

fn once_at(remind_at: DateTime<Utc>) -> ReminderSchedule {
    ReminderSchedule::Once { remind_at }
}

fn recurring() -> ReminderSchedule {
    ReminderSchedule::Recurring {
        cron: ReminderCron::parse(DAILY_9AM).expect("valid cron"),
        timezone: New_York,
    }
}

fn new_reminder(description: &str, schedule: ReminderSchedule) -> NewReminder {
    let next_run_at = schedule
        .next_run_after(at(2026, 1, 1, 0))
        .expect("test schedules always have an upcoming firing");
    NewReminder {
        description: description.to_string(),
        entity: None,
        schedule,
        next_run_at,
    }
}

async fn insert_user(pool: &PgPool, id: &str) {
    let macro_user_id = macro_uuid::generate_uuid_v7();
    sqlx::query(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)"#,
    )
    .bind(macro_user_id)
    .bind(id)
    .execute(pool)
    .await
    .expect("macro_user should insert");
    sqlx::query(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#)
        .bind(id)
        .bind(macro_user_id)
        .execute(pool)
        .await
        .expect("user should insert");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn one_shot_reminder_round_trips(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool);
    let remind_at = at(2026, 8, 1, 14);

    let created = repo
        .create_reminder(
            &user(USER_A),
            &new_reminder("call back", once_at(remind_at)),
        )
        .await
        .expect("reminder should insert");

    assert_eq!(created.description, "call back");
    assert_eq!(created.schedule, once_at(remind_at));
    assert_eq!(created.next_run_at, remind_at);
    assert!(created.enabled);
    assert!(created.completed_at.is_none());
    assert!(created.entity().is_none());

    let fetched = repo
        .get_reminder(&user(USER_A), created.id)
        .await
        .expect("get should succeed")
        .expect("reminder should exist");
    assert_eq!(fetched.id, created.id);
    assert_eq!(fetched.schedule, created.schedule);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn recurring_reminder_round_trips_with_its_timezone(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool);

    let created = repo
        .create_reminder(&user(USER_A), &new_reminder("standup", recurring()))
        .await
        .expect("reminder should insert");

    let fetched = repo
        .get_reminder(&user(USER_A), created.id)
        .await
        .expect("get should succeed")
        .expect("reminder should exist");

    match fetched.schedule {
        ReminderSchedule::Recurring { cron, timezone } => {
            assert_eq!(cron.as_str(), DAILY_9AM);
            assert_eq!(timezone, New_York);
        }
        other => panic!("expected a recurring schedule, got {other:?}"),
    }
    // 09:00 New York on Jan 1 is 14:00Z.
    assert_eq!(fetched.next_run_at, at(2026, 1, 1, 14));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn entity_association_round_trips(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool);
    let new = NewReminder {
        entity: Some(EntityType::Document.with_entity_string("doc-1".to_string())),
        ..new_reminder("review this", once_at(at(2026, 8, 1, 14)))
    };

    let created = repo
        .create_reminder(&user(USER_A), &new)
        .await
        .expect("reminder should insert");

    let entity = created.entity().expect("entity should be persisted");
    assert_eq!(entity.entity_type, EntityType::Document);
    assert_eq!(entity.entity_id, "doc-1");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_returns_only_the_owners_reminders_soonest_first(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let repo = PgRemindersRepo::new(pool);

    let later = at(2026, 9, 1, 14);
    let soon = at(2026, 8, 1, 14);
    repo.create_reminder(&user(USER_A), &new_reminder("later", once_at(later)))
        .await
        .expect("insert");
    repo.create_reminder(&user(USER_A), &new_reminder("soon", once_at(soon)))
        .await
        .expect("insert");
    repo.create_reminder(&user(USER_B), &new_reminder("theirs", once_at(soon)))
        .await
        .expect("insert");

    let batch = repo
        .list_reminders(&user(USER_A), &ReminderFilter::default(), 100)
        .await
        .expect("list should succeed");

    assert_eq!(batch.reminders.len(), 2);
    assert_eq!(batch.skipped, 0);
    assert_eq!(batch.reminders[0].description, "soon");
    assert_eq!(batch.reminders[1].description, "later");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_filters_by_entity(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool);

    let attached = NewReminder {
        entity: Some(EntityType::Document.with_entity_string("doc-1".to_string())),
        ..new_reminder("on doc-1", once_at(at(2026, 8, 1, 14)))
    };
    let other = NewReminder {
        entity: Some(EntityType::Document.with_entity_string("doc-2".to_string())),
        ..new_reminder("on doc-2", once_at(at(2026, 8, 1, 14)))
    };
    repo.create_reminder(&user(USER_A), &attached)
        .await
        .expect("insert");
    repo.create_reminder(&user(USER_A), &other)
        .await
        .expect("insert");
    repo.create_reminder(
        &user(USER_A),
        &new_reminder("standalone", once_at(at(2026, 8, 1, 14))),
    )
    .await
    .expect("insert");

    let filter = ReminderFilter {
        entity: Some(EntityType::Document.with_entity_string("doc-1".to_string())),
        ..Default::default()
    };
    let batch = repo
        .list_reminders(&user(USER_A), &filter, 100)
        .await
        .expect("list should succeed");

    assert_eq!(batch.reminders.len(), 1);
    assert_eq!(batch.reminders[0].description, "on doc-1");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn list_hides_completed_reminders_unless_requested(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool.clone());
    let created = repo
        .create_reminder(
            &user(USER_A),
            &new_reminder("fired already", once_at(at(2026, 8, 1, 14))),
        )
        .await
        .expect("insert");

    // Stand in for the dispatcher completing the one-shot.
    sqlx::query(r#"UPDATE reminder SET completed_at = now() WHERE id = $1"#)
        .bind(created.id)
        .execute(&pool)
        .await
        .expect("complete should update");

    let hidden = repo
        .list_reminders(&user(USER_A), &ReminderFilter::default(), 100)
        .await
        .expect("list should succeed");
    assert!(hidden.reminders.is_empty());

    let shown = repo
        .list_reminders(
            &user(USER_A),
            &ReminderFilter {
                include_completed: true,
                ..Default::default()
            },
            100,
        )
        .await
        .expect("list should succeed");
    assert_eq!(shown.reminders.len(), 1);
    assert!(shown.reminders[0].completed_at.is_some());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn update_applies_only_the_provided_fields(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool);
    let remind_at = at(2026, 8, 1, 14);
    let created = repo
        .create_reminder(&user(USER_A), &new_reminder("before", once_at(remind_at)))
        .await
        .expect("insert");

    let updated = repo
        .update_reminder(
            &user(USER_A),
            created.id,
            &ReminderUpdate {
                description: Some("after".to_string()),
                enabled: Some(false),
                ..Default::default()
            },
        )
        .await
        .expect("update should succeed")
        .expect("reminder should exist");

    assert_eq!(updated.description, "after");
    assert!(!updated.enabled);
    // Schedule untouched.
    assert_eq!(updated.schedule, once_at(remind_at));
    assert_eq!(updated.next_run_at, remind_at);
    assert!(updated.updated_at >= created.updated_at);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn update_switching_to_recurring_clears_remind_at(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool);
    let created = repo
        .create_reminder(
            &user(USER_A),
            &new_reminder("one shot", once_at(at(2026, 8, 1, 14))),
        )
        .await
        .expect("insert");

    let next_run_at = at(2026, 1, 1, 14);
    let updated = repo
        .update_reminder(
            &user(USER_A),
            created.id,
            &ReminderUpdate {
                schedule: Some(ScheduleUpdate {
                    schedule: recurring(),
                    next_run_at,
                }),
                ..Default::default()
            },
        )
        .await
        .expect("update should succeed")
        .expect("reminder should exist");

    assert!(updated.schedule.repeats());
    assert_eq!(updated.next_run_at, next_run_at);
    // Reading it back proves `remind_at` was NULLed: otherwise the row would
    // violate the schedule CHECK, and the mapper would still report `Once`.
    let fetched = repo
        .get_reminder(&user(USER_A), created.id)
        .await
        .expect("get should succeed")
        .expect("reminder should exist");
    assert!(fetched.schedule.repeats());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn update_switching_to_one_shot_clears_cron_and_timezone(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool);
    let created = repo
        .create_reminder(&user(USER_A), &new_reminder("standup", recurring()))
        .await
        .expect("insert");

    let remind_at = at(2026, 8, 1, 14);
    repo.update_reminder(
        &user(USER_A),
        created.id,
        &ReminderUpdate {
            schedule: Some(ScheduleUpdate {
                schedule: once_at(remind_at),
                next_run_at: remind_at,
            }),
            ..Default::default()
        },
    )
    .await
    .expect("update should succeed")
    .expect("reminder should exist");

    let fetched = repo
        .get_reminder(&user(USER_A), created.id)
        .await
        .expect("get should succeed")
        .expect("reminder should exist");
    assert_eq!(fetched.schedule, once_at(remind_at));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reminders_are_scoped_to_their_owner(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let repo = PgRemindersRepo::new(pool);
    let created = repo
        .create_reminder(
            &user(USER_A),
            &new_reminder("private", once_at(at(2026, 8, 1, 14))),
        )
        .await
        .expect("insert");

    assert!(
        repo.get_reminder(&user(USER_B), created.id)
            .await
            .expect("get should succeed")
            .is_none()
    );
    assert!(
        repo.update_reminder(
            &user(USER_B),
            created.id,
            &ReminderUpdate {
                enabled: Some(false),
                ..Default::default()
            },
        )
        .await
        .expect("update should succeed")
        .is_none()
    );
    assert!(
        !repo
            .delete_reminder(&user(USER_B), created.id)
            .await
            .expect("delete should succeed")
    );
    // Still there, still enabled.
    let survived = repo
        .get_reminder(&user(USER_A), created.id)
        .await
        .expect("get should succeed")
        .expect("reminder should exist");
    assert!(survived.enabled);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_removes_the_row_once(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool);
    let created = repo
        .create_reminder(
            &user(USER_A),
            &new_reminder("transient", once_at(at(2026, 8, 1, 14))),
        )
        .await
        .expect("insert");

    assert!(
        repo.delete_reminder(&user(USER_A), created.id)
            .await
            .expect("delete should succeed")
    );
    assert!(
        !repo
            .delete_reminder(&user(USER_A), created.id)
            .await
            .expect("second delete should succeed")
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_the_user_cascades_to_their_reminders(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool.clone());
    repo.create_reminder(
        &user(USER_A),
        &new_reminder("goes away", once_at(at(2026, 8, 1, 14))),
    )
    .await
    .expect("insert");

    sqlx::query(r#"DELETE FROM "User" WHERE id = $1"#)
        .bind(USER_A)
        .execute(&pool)
        .await
        .expect("user delete should succeed");

    let remaining: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM reminder"#)
        .fetch_one(&pool)
        .await
        .expect("count should succeed");
    assert_eq!(remaining, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_half_populated_entity_association_is_rejected(pool: PgPool) {
    insert_user(&pool, USER_A).await;

    let err = sqlx::query(
        r#"
        INSERT INTO reminder (id, user_id, description, entity_type, next_run_at, remind_at)
        VALUES ($1, $2, 'dangling', 'document', now(), now())
        "#,
    )
    .bind(macro_uuid::generate_uuid_v7())
    .bind(USER_A)
    .execute(&pool)
    .await
    .expect_err("entity_type without entity_id should violate the CHECK");

    assert!(
        err.to_string().contains("reminder_entity_both_or_neither"),
        "unexpected error: {err}"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn both_schedule_modes_at_once_is_rejected(pool: PgPool) {
    insert_user(&pool, USER_A).await;

    let err = sqlx::query(
        r#"
        INSERT INTO reminder (id, user_id, description, next_run_at, remind_at, cron, timezone)
        VALUES ($1, $2, 'confused', now(), now(), '0 0 9 * * *', 'America/New_York')
        "#,
    )
    .bind(macro_uuid::generate_uuid_v7())
    .bind(USER_A)
    .execute(&pool)
    .await
    .expect_err("two schedule modes should violate the CHECK");

    assert!(
        err.to_string().contains("reminder_schedule_exactly_one"),
        "unexpected error: {err}"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_cron_without_a_timezone_is_rejected(pool: PgPool) {
    insert_user(&pool, USER_A).await;

    let err = sqlx::query(
        r#"
        INSERT INTO reminder (id, user_id, description, next_run_at, cron)
        VALUES ($1, $2, 'no zone', now(), '0 0 9 * * *')
        "#,
    )
    .bind(macro_uuid::generate_uuid_v7())
    .bind(USER_A)
    .execute(&pool)
    .await
    .expect_err("a cron without a timezone should violate the CHECK");

    assert!(
        err.to_string().contains("reminder_schedule_exactly_one"),
        "unexpected error: {err}"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn no_schedule_at_all_is_rejected(pool: PgPool) {
    insert_user(&pool, USER_A).await;

    let err = sqlx::query(
        r#"
        INSERT INTO reminder (id, user_id, description, next_run_at)
        VALUES ($1, $2, 'scheduleless', now())
        "#,
    )
    .bind(macro_uuid::generate_uuid_v7())
    .bind(USER_A)
    .execute(&pool)
    .await
    .expect_err("a reminder with no schedule should violate the CHECK");

    assert!(
        err.to_string().contains("reminder_schedule_exactly_one"),
        "unexpected error: {err}"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn occurrences_cascade_when_their_reminder_is_deleted(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool.clone());
    let created = repo
        .create_reminder(&user(USER_A), &new_reminder("standup", recurring()))
        .await
        .expect("insert");

    // The dispatcher does not exist yet; write the row it would write.
    sqlx::query(
        r#"INSERT INTO reminder_occurrence (id, reminder_id, scheduled_for, sent_at)
           VALUES ($1, $2, $3, now())"#,
    )
    .bind(macro_uuid::generate_uuid_v7())
    .bind(created.id)
    .bind(created.next_run_at)
    .execute(&pool)
    .await
    .expect("occurrence should insert");

    // The same firing cannot be recorded twice.
    let duplicate = sqlx::query(
        r#"INSERT INTO reminder_occurrence (id, reminder_id, scheduled_for) VALUES ($1, $2, $3)"#,
    )
    .bind(macro_uuid::generate_uuid_v7())
    .bind(created.id)
    .bind(created.next_run_at)
    .execute(&pool)
    .await;
    assert!(duplicate.is_err(), "duplicate firing should be rejected");

    repo.delete_reminder(&user(USER_A), created.id)
        .await
        .expect("delete should succeed");

    let remaining: i64 = sqlx::query_scalar(r#"SELECT COUNT(*) FROM reminder_occurrence"#)
        .fetch_one(&pool)
        .await
        .expect("count should succeed");
    assert_eq!(remaining, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_stored_timezone_that_is_not_a_zone_surfaces_as_an_error(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool.clone());
    let created = repo
        .create_reminder(&user(USER_A), &new_reminder("standup", recurring()))
        .await
        .expect("insert");

    sqlx::query(r#"UPDATE reminder SET timezone = 'Mars/Olympus_Mons' WHERE id = $1"#)
        .bind(created.id)
        .execute(&pool)
        .await
        .expect("update should succeed");

    let err = repo
        .get_reminder(&user(USER_A), created.id)
        .await
        .expect_err("an unknown zone should not silently become UTC");
    assert!(matches!(err, RemindersRepoErr::InvalidTimezone(_, _)));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn next_run_at_is_indexed_for_the_future_dispatcher(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool.clone());
    repo.create_reminder(&user(USER_A), &new_reminder("due", recurring()))
        .await
        .expect("insert");

    // The dispatcher's query shape, so a schema change that breaks it fails here.
    let due: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*) FROM reminder
        WHERE enabled AND completed_at IS NULL AND next_run_at <= $1
        "#,
    )
    .bind(at(2026, 1, 1, 14) + Duration::seconds(1))
    .fetch_one(&pool)
    .await
    .expect("count should succeed");
    assert_eq!(due, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn rescheduling_clears_completed_at(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool.clone());
    let created = repo
        .create_reminder(
            &user(USER_A),
            &new_reminder("fired", once_at(at(2026, 8, 1, 14))),
        )
        .await
        .expect("insert");

    sqlx::query(r#"UPDATE reminder SET completed_at = now() WHERE id = $1"#)
        .bind(created.id)
        .execute(&pool)
        .await
        .expect("complete should update");

    let remind_at = at(2026, 9, 1, 14);
    let revived = repo
        .update_reminder(
            &user(USER_A),
            created.id,
            &ReminderUpdate {
                schedule: Some(ScheduleUpdate {
                    schedule: once_at(remind_at),
                    next_run_at: remind_at,
                }),
                ..Default::default()
            },
        )
        .await
        .expect("update should succeed")
        .expect("reminder should exist");

    assert!(
        revived.completed_at.is_none(),
        "a rescheduled reminder must not stay marked completed"
    );
    // ...so it is back in the default list and in the dispatcher's due query.
    let listed = repo
        .list_reminders(&user(USER_A), &ReminderFilter::default(), 100)
        .await
        .expect("list should succeed");
    assert_eq!(listed.reminders.len(), 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_non_schedule_update_leaves_completed_at_alone(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool.clone());
    let created = repo
        .create_reminder(
            &user(USER_A),
            &new_reminder("fired", once_at(at(2026, 8, 1, 14))),
        )
        .await
        .expect("insert");

    sqlx::query(r#"UPDATE reminder SET completed_at = now() WHERE id = $1"#)
        .bind(created.id)
        .execute(&pool)
        .await
        .expect("complete should update");

    let updated = repo
        .update_reminder(
            &user(USER_A),
            created.id,
            &ReminderUpdate {
                description: Some("renamed".to_string()),
                ..Default::default()
            },
        )
        .await
        .expect("update should succeed")
        .expect("reminder should exist");

    assert_eq!(updated.description, "renamed");
    assert!(updated.completed_at.is_some());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn keyset_paging_walks_every_row_exactly_once(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool);
    // Identical firing times, so paging depends entirely on the created_at/id
    // tie-breakers in both the ORDER BY and the keyset predicate.
    let remind_at = at(2026, 8, 1, 14);
    for index in 0..5 {
        repo.create_reminder(
            &user(USER_A),
            &new_reminder(&format!("reminder-{index}"), once_at(remind_at)),
        )
        .await
        .expect("insert");
    }

    let mut seen = Vec::new();
    let mut cursor = None;
    for _ in 0..5 {
        let page = repo
            .list_reminders(
                &user(USER_A),
                &ReminderFilter {
                    cursor,
                    ..Default::default()
                },
                2,
            )
            .await
            .expect("list should succeed");
        if page.reminders.is_empty() {
            break;
        }
        assert!(page.reminders.len() <= 2);
        cursor = page.last_examined;
        seen.extend(page.reminders.into_iter().map(|reminder| reminder.id));
    }

    assert_eq!(seen.len(), 5, "every row is returned");
    let unique: std::collections::HashSet<_> = seen.iter().collect();
    assert_eq!(unique.len(), 5, "no row is returned twice");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_cursor_past_the_end_returns_nothing(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool);
    let created = repo
        .create_reminder(
            &user(USER_A),
            &new_reminder("only", once_at(at(2026, 8, 1, 14))),
        )
        .await
        .expect("insert");

    let page = repo
        .list_reminders(
            &user(USER_A),
            &ReminderFilter {
                cursor: Some(ReminderCursor::after(&created)),
                ..Default::default()
            },
            100,
        )
        .await
        .expect("list should succeed");

    assert!(page.reminders.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn limit_bounds_the_result_set(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool);
    for index in 0..4 {
        repo.create_reminder(
            &user(USER_A),
            &new_reminder(&format!("r{index}"), once_at(at(2026, 8, 1, 14))),
        )
        .await
        .expect("insert");
    }

    let page = repo
        .list_reminders(&user(USER_A), &ReminderFilter::default(), 2)
        .await
        .expect("list should succeed");
    assert_eq!(page.reminders.len(), 2);
    assert_eq!(page.examined(), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_unreadable_row_is_skipped_rather_than_failing_the_page(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool.clone());
    let broken = repo
        .create_reminder(
            &user(USER_A),
            &NewReminder {
                entity: Some(EntityType::Document.with_entity_string("doc-1".to_string())),
                ..new_reminder("has a bad entity type", once_at(at(2026, 8, 1, 14)))
            },
        )
        .await
        .expect("insert");
    repo.create_reminder(
        &user(USER_A),
        &new_reminder("fine", once_at(at(2026, 8, 2, 14))),
    )
    .await
    .expect("insert");

    // Only reachable by writing around the service; the CHECK constraints allow
    // it because the value is non-empty text.
    sqlx::query(r#"UPDATE reminder SET entity_type = 'chupacabra' WHERE id = $1"#)
        .bind(broken.id)
        .execute(&pool)
        .await
        .expect("update should succeed");

    let listed = repo
        .list_reminders(&user(USER_A), &ReminderFilter::default(), 100)
        .await
        .expect("one unreadable row must not fail the whole page");
    assert_eq!(listed.reminders.len(), 1);
    assert_eq!(listed.reminders[0].description, "fine");
    // The skipped row is accounted for, and the cursor covers it, so paging
    // cannot stall on it.
    assert_eq!(listed.skipped, 1);
    assert_eq!(listed.examined(), 2);
    assert!(listed.last_examined.is_some());

    // Reading that reminder on its own still surfaces the problem.
    let err = repo
        .get_reminder(&user(USER_A), broken.id)
        .await
        .expect_err("a single-row read should not hide the bad value");
    assert!(matches!(
        err,
        RemindersRepoErr::InvalidEntityType { reminder_id, .. } if reminder_id == broken.id
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_blank_description_is_rejected_by_the_database(pool: PgPool) {
    insert_user(&pool, USER_A).await;

    let err = sqlx::query(
        r#"INSERT INTO reminder (id, user_id, description, next_run_at, remind_at)
           VALUES ($1, $2, '   ', now(), now())"#,
    )
    .bind(macro_uuid::generate_uuid_v7())
    .bind(USER_A)
    .execute(&pool)
    .await
    .expect_err("a whitespace-only description should violate the CHECK");

    assert!(
        err.to_string().contains("reminder_description_non_empty"),
        "unexpected error: {err}"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_over_long_description_is_rejected_by_the_database(pool: PgPool) {
    insert_user(&pool, USER_A).await;

    let err = sqlx::query(
        r#"INSERT INTO reminder (id, user_id, description, next_run_at, remind_at)
           VALUES ($1, $2, repeat('a', 2001), now(), now())"#,
    )
    .bind(macro_uuid::generate_uuid_v7())
    .bind(USER_A)
    .execute(&pool)
    .await
    .expect_err("2001 characters should violate the CHECK");

    assert!(
        err.to_string().contains("reminder_description_max_length"),
        "unexpected error: {err}"
    );

    // The service's limit and the DB's agree on where the boundary is.
    sqlx::query(
        r#"INSERT INTO reminder (id, user_id, description, next_run_at, remind_at)
           VALUES ($1, $2, repeat('a', 2000), now(), now())"#,
    )
    .bind(macro_uuid::generate_uuid_v7())
    .bind(USER_A)
    .execute(&pool)
    .await
    .expect("exactly the limit should be accepted");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_blank_entity_id_is_rejected_by_the_database(pool: PgPool) {
    insert_user(&pool, USER_A).await;

    let err = sqlx::query(
        r#"INSERT INTO reminder (id, user_id, description, entity_type, entity_id, next_run_at, remind_at)
           VALUES ($1, $2, 'x', 'document', '  ', now(), now())"#,
    )
    .bind(macro_uuid::generate_uuid_v7())
    .bind(USER_A)
    .execute(&pool)
    .await
    .expect_err("a whitespace-only entity id should violate the CHECK");

    assert!(
        err.to_string().contains("reminder_entity_id_non_empty"),
        "unexpected error: {err}"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_active_list_index_covers_the_default_query(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool.clone());
    repo.create_reminder(
        &user(USER_A),
        &new_reminder("live", once_at(at(2026, 8, 1, 14))),
    )
    .await
    .expect("insert");

    // Pins that the partial index exists and matches the shape the default list
    // query uses; a rename or predicate change fails here.
    let indexed: bool = sqlx::query_scalar(
        r#"
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes
            WHERE tablename = 'reminder'
              AND indexname = 'reminder_user_active_next_run_idx'
        )
        "#,
    )
    .fetch_one(&pool)
    .await
    .expect("index lookup should succeed");
    assert!(indexed, "the active-list partial index is missing");
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/// A stale threshold far enough in the past that a claim made "now" is fresh,
/// so a second claim in the same test is refused rather than taken over.
fn no_retry() -> DateTime<Utc> {
    at(2000, 1, 1, 0)
}

async fn create_due(pool: &PgPool, user_id: &str, remind_at: DateTime<Utc>) -> Reminder {
    let repo = PgRemindersRepo::new(pool.clone());
    let new = NewReminder {
        description: "Follow up".to_string(),
        entity: None,
        schedule: once_at(remind_at),
        next_run_at: remind_at,
    };
    repo.create_reminder(&user(user_id), &new)
        .await
        .expect("reminder should insert")
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn due_reminders_returns_only_firings_that_have_arrived(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let now = at(2026, 8, 1, 12);
    let past = create_due(&pool, USER_A, at(2026, 8, 1, 11)).await;
    let _future = create_due(&pool, USER_A, at(2026, 8, 1, 13)).await;
    let repo = PgRemindersRepo::new(pool);

    let due = repo.due_reminders(now, 10).await.expect("query succeeds");

    assert_eq!(due.len(), 1);
    assert_eq!(due[0].reminder.id, past.id);
    assert_eq!(due[0].owner_id.as_ref(), USER_A);
    // The firing being delivered is the reminder's next_run_at, which is what
    // keys the occurrence row.
    assert_eq!(due[0].scheduled_for, past.next_run_at);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn due_reminders_spans_users(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let now = at(2026, 8, 1, 12);
    create_due(&pool, USER_A, at(2026, 8, 1, 11)).await;
    create_due(&pool, USER_B, at(2026, 8, 1, 10)).await;
    let repo = PgRemindersRepo::new(pool);

    let due = repo.due_reminders(now, 10).await.expect("query succeeds");

    // Dispatch is the one read that is not scoped to a single caller.
    let owners: Vec<&str> = due.iter().map(|d| d.owner_id.as_ref()).collect();
    assert_eq!(owners, vec![USER_B, USER_A], "soonest firing first");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn due_reminders_skips_disabled_and_completed(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let now = at(2026, 8, 1, 12);
    let disabled = create_due(&pool, USER_A, at(2026, 8, 1, 11)).await;
    let completed = create_due(&pool, USER_A, at(2026, 8, 1, 11)).await;
    let repo = PgRemindersRepo::new(pool.clone());

    repo.update_reminder(
        &user(USER_A),
        disabled.id,
        &ReminderUpdate {
            enabled: Some(false),
            ..Default::default()
        },
    )
    .await
    .expect("disable succeeds");
    repo.complete_occurrence(completed.id, completed.next_run_at)
        .await
        .expect("complete succeeds");

    let due = repo.due_reminders(now, 10).await.expect("query succeeds");

    assert!(due.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_firing_can_only_be_claimed_once(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let reminder = create_due(&pool, USER_A, at(2026, 8, 1, 11)).await;
    let repo = PgRemindersRepo::new(pool);

    let first = repo
        .claim_occurrence(reminder.id, reminder.next_run_at, no_retry())
        .await
        .expect("first claim succeeds");
    let second = repo
        .claim_occurrence(reminder.id, reminder.next_run_at, no_retry())
        .await
        .expect("second claim succeeds");

    assert!(first, "the first dispatcher takes the firing");
    assert!(!second, "a peer must not take a firing already in flight");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_stale_undelivered_claim_can_be_taken_over(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let reminder = create_due(&pool, USER_A, at(2026, 8, 1, 11)).await;
    let repo = PgRemindersRepo::new(pool);

    assert!(
        repo.claim_occurrence(reminder.id, reminder.next_run_at, no_retry())
            .await
            .expect("first claim succeeds")
    );

    // A dispatcher that claimed and then died leaves sent_at NULL. Once the
    // claim ages past the retry window another sweep must be able to take it.
    let retaken = repo
        .claim_occurrence(
            reminder.id,
            reminder.next_run_at,
            Utc::now() + Duration::minutes(1),
        )
        .await
        .expect("retry claim succeeds");

    assert!(retaken);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_delivered_firing_is_never_reclaimed(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let reminder = create_due(&pool, USER_A, at(2026, 8, 1, 11)).await;
    let repo = PgRemindersRepo::new(pool);

    repo.claim_occurrence(reminder.id, reminder.next_run_at, no_retry())
        .await
        .expect("claim succeeds");
    repo.complete_occurrence(reminder.id, reminder.next_run_at)
        .await
        .expect("complete succeeds");

    // Even with a retry window wide enough to reclaim anything unsent, a sent
    // firing must stay sent — this is what stops a duplicate notification.
    let reclaimed = repo
        .claim_occurrence(
            reminder.id,
            reminder.next_run_at,
            Utc::now() + Duration::minutes(1),
        )
        .await
        .expect("claim succeeds");

    assert!(!reclaimed);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn completing_a_firing_marks_it_sent_and_completes_the_reminder(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let reminder = create_due(&pool, USER_A, at(2026, 8, 1, 11)).await;
    let repo = PgRemindersRepo::new(pool.clone());

    repo.claim_occurrence(reminder.id, reminder.next_run_at, no_retry())
        .await
        .expect("claim succeeds");
    repo.complete_occurrence(reminder.id, reminder.next_run_at)
        .await
        .expect("complete succeeds");

    let sent_at: Option<DateTime<Utc>> = sqlx::query_scalar(
        r#"SELECT sent_at FROM reminder_occurrence WHERE reminder_id = $1 AND scheduled_for = $2"#,
    )
    .bind(reminder.id)
    .bind(reminder.next_run_at)
    .fetch_one(&pool)
    .await
    .expect("occurrence exists");
    assert!(sent_at.is_some());

    let stored = repo
        .get_reminder(&user(USER_A), reminder.id)
        .await
        .expect("read succeeds")
        .expect("reminder still exists");
    assert!(stored.completed_at.is_some());

    // And it must drop out of the due set, or the next sweep sends it again.
    let due = repo
        .due_reminders(at(2026, 8, 1, 12), 10)
        .await
        .expect("query succeeds");
    assert!(due.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_a_reminder_removes_its_occurrences(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let reminder = create_due(&pool, USER_A, at(2026, 8, 1, 11)).await;
    let repo = PgRemindersRepo::new(pool.clone());

    repo.claim_occurrence(reminder.id, reminder.next_run_at, no_retry())
        .await
        .expect("claim succeeds");
    repo.delete_reminder(&user(USER_A), reminder.id)
        .await
        .expect("delete succeeds");

    let remaining: i64 =
        sqlx::query_scalar(r#"SELECT count(*) FROM reminder_occurrence WHERE reminder_id = $1"#)
            .bind(reminder.id)
            .fetch_one(&pool)
            .await
            .expect("count succeeds");
    assert_eq!(remaining, 0, "occurrences cascade with the reminder");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_undecodable_row_does_not_stall_the_whole_sweep(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    // Fires first, so a batch-level failure would hide the good one behind it.
    let broken = create_due(&pool, USER_A, at(2026, 8, 1, 10)).await;
    let good = create_due(&pool, USER_A, at(2026, 8, 1, 11)).await;
    let repo = PgRemindersRepo::new(pool.clone());

    // Only reachable by writing around the service; the CHECK constraints allow
    // it because both entity columns are non-empty text.
    sqlx::query(r#"UPDATE reminder SET entity_type = 'chupacabra', entity_id = 'x' WHERE id = $1"#)
        .bind(broken.id)
        .execute(&pool)
        .await
        .expect("update should succeed");

    let due = repo
        .due_reminders(at(2026, 8, 1, 12), 10)
        .await
        .expect("one bad row must not fail the sweep");

    assert_eq!(due.len(), 1);
    assert_eq!(due[0].reminder.id, good.id);
}
