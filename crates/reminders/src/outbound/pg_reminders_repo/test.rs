use chrono::{Duration, TimeZone};
use chrono_tz::America::New_York;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use sqlx::PgPool;

use super::*;
use crate::domain::models::{
    ReminderCursor, ScheduleUpdate, SoupOrder, SoupReminderQuery, entity_token,
};

const USER_A: &str = "macro|reminders-a@macro.com";
const USER_B: &str = "macro|reminders-b@macro.com";
const DAILY_9AM: &str = "0 0 9 * * *";
// `reminder.entity_id` is a uuid column, so associations use uuids.
const DOC_1: &str = "11111111-1111-4111-8111-111111111111";
const DOC_2: &str = "22222222-2222-4222-8222-222222222222";

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

/// A Soup read with no filters, newest first. Spread over it to vary one field:
/// `SoupReminderQuery { completed: Some(false), ..soup_query(100) }`.
fn soup_query(limit: i64) -> SoupReminderQuery<'static> {
    SoupReminderQuery {
        ids: &[],
        entities: &[],
        completed: None,
        fired: None,
        order: SoupOrder::LatestFirst,
        limit,
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
        entity: Some(EntityType::Document.with_entity_string(DOC_1.to_string())),
        ..new_reminder("review this", once_at(at(2026, 8, 1, 14)))
    };

    let created = repo
        .create_reminder(&user(USER_A), &new)
        .await
        .expect("reminder should insert");

    let entity = created.entity().expect("entity should be persisted");
    assert_eq!(entity.entity_type, EntityType::Document);
    assert_eq!(entity.entity_id, DOC_1);
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
        entity: Some(EntityType::Document.with_entity_string(DOC_1.to_string())),
        ..new_reminder("on doc-1", once_at(at(2026, 8, 1, 14)))
    };
    let other = NewReminder {
        entity: Some(EntityType::Document.with_entity_string(DOC_2.to_string())),
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
        entity: Some(EntityType::Document.with_entity_string(DOC_1.to_string())),
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
async fn update_can_complete_and_uncomplete_a_reminder(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool);
    let created = repo
        .create_reminder(
            &user(USER_A),
            &new_reminder("thing", once_at(at(2026, 8, 1, 14))),
        )
        .await
        .expect("insert");
    assert!(created.completed_at.is_none());

    let completed = repo
        .update_reminder(
            &user(USER_A),
            created.id,
            &ReminderUpdate {
                completed: Some(true),
                ..Default::default()
            },
        )
        .await
        .expect("update should succeed")
        .expect("reminder should exist");
    let stamp = completed.completed_at.expect("should be completed");

    // Completing twice must not move the stamp — the second call is a no-op,
    // not a re-completion.
    let again = repo
        .update_reminder(
            &user(USER_A),
            created.id,
            &ReminderUpdate {
                completed: Some(true),
                ..Default::default()
            },
        )
        .await
        .expect("update should succeed")
        .expect("reminder should exist");
    assert_eq!(again.completed_at, Some(stamp));

    let reopened = repo
        .update_reminder(
            &user(USER_A),
            created.id,
            &ReminderUpdate {
                completed: Some(false),
                ..Default::default()
            },
        )
        .await
        .expect("update should succeed")
        .expect("reminder should exist");
    assert!(reopened.completed_at.is_none(), "undo must clear the stamp");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn update_leaves_completion_alone_when_not_asked(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool);
    let created = repo
        .create_reminder(
            &user(USER_A),
            &new_reminder("thing", once_at(at(2026, 8, 1, 14))),
        )
        .await
        .expect("insert");
    repo.update_reminder(
        &user(USER_A),
        created.id,
        &ReminderUpdate {
            completed: Some(true),
            ..Default::default()
        },
    )
    .await
    .expect("complete");

    // A description-only patch must not resurrect a completed reminder.
    let renamed = repo
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
    assert!(renamed.completed_at.is_some());
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
        SELECT COUNT(*) FROM reminder r
        WHERE r.enabled
          AND r.completed_at IS NULL
          AND r.next_run_at <= $1
          AND NOT EXISTS (
              SELECT 1 FROM reminder_occurrence o
              WHERE o.reminder_id = r.id
                AND o.scheduled_for = r.next_run_at
                AND o.sent_at IS NOT NULL
          )
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
                entity: Some(EntityType::Document.with_entity_string(DOC_1.to_string())),
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
async fn a_non_uuid_entity_id_is_rejected_by_the_database(pool: PgPool) {
    insert_user(&pool, USER_A).await;

    // The column type is the guardrail now that `entity_id` is a uuid: there is
    // no blank or malformed value to check for, the cast simply fails.
    let err = sqlx::query(
        r#"INSERT INTO reminder (id, user_id, description, entity_type, entity_id, next_run_at, remind_at)
           VALUES ($1, $2, 'x', 'document', 'not-a-uuid', now(), now())"#,
    )
    .bind(macro_uuid::generate_uuid_v7())
    .bind(USER_A)
    .execute(&pool)
    .await
    .expect_err("a non-uuid entity id should not be storable");

    assert!(err.to_string().contains("uuid"), "unexpected error: {err}");
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
async fn due_firings_returns_only_firings_that_have_arrived(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let now = at(2026, 8, 1, 12);
    let past = create_due(&pool, USER_A, at(2026, 8, 1, 11)).await;
    let _future = create_due(&pool, USER_A, at(2026, 8, 1, 13)).await;
    let repo = PgRemindersRepo::new(pool);

    let due = repo.due_firings(now).await.expect("query succeeds");

    assert_eq!(due.len(), 1);
    assert_eq!(due[0].reminder_id, past.id);
    // The firing being delivered is the reminder's next_run_at, which is what
    // keys the occurrence row.
    assert_eq!(due[0].scheduled_for, past.next_run_at);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn due_firings_exclude_recurring_reminders(pool: PgPool) {
    // A recurring reminder is never completed and never has its next_run_at
    // advanced, so if the query returned it the row would stay due forever and
    // every sweep would pay for a message that delivery then refuses.
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool.clone());
    let now = at(2026, 8, 1, 12);

    repo.create_reminder(&user(USER_A), &new_reminder("standup", recurring()))
        .await
        .expect("recurring reminder should insert");
    let one_shot = create_due(&pool, USER_A, at(2026, 8, 1, 11)).await;

    let due = repo.due_firings(now).await.expect("query succeeds");

    assert_eq!(due.len(), 1);
    assert_eq!(due[0].reminder_id, one_shot.id);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn due_firings_span_users(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let now = at(2026, 8, 1, 12);
    create_due(&pool, USER_A, at(2026, 8, 1, 11)).await;
    create_due(&pool, USER_B, at(2026, 8, 1, 10)).await;
    let repo = PgRemindersRepo::new(pool);

    let due = repo.due_firings(now).await.expect("query succeeds");

    // Dispatch is the one read that is not scoped to a single caller.
    let mut owners = Vec::new();
    for firing in &due {
        let resolved = repo
            .find_due_reminder(*firing)
            .await
            .expect("read succeeds")
            .expect("firing resolves");
        owners.push(resolved.owner_id.as_ref().to_string());
    }
    assert_eq!(owners, vec![USER_B, USER_A], "soonest firing first");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn due_firings_skip_disabled_and_completed(pool: PgPool) {
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
    // Completion is the owner's act now, so set it the way they would rather
    // than by delivering the firing — delivering would exclude the row through
    // the sent occurrence instead, and prove nothing about `completed_at`.
    repo.update_reminder(
        &user(USER_A),
        completed.id,
        &ReminderUpdate {
            completed: Some(true),
            ..Default::default()
        },
    )
    .await
    .expect("complete succeeds");

    let due = repo.due_firings(now).await.expect("query succeeds");

    assert!(due.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_fanned_out_firing_resolves_to_its_reminder_and_owner(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let reminder = create_due(&pool, USER_A, at(2026, 8, 1, 11)).await;
    let repo = PgRemindersRepo::new(pool);

    let due = repo
        .find_due_reminder(DueFiring {
            reminder_id: reminder.id,
            scheduled_for: reminder.next_run_at,
        })
        .await
        .expect("read succeeds")
        .expect("firing resolves");

    assert_eq!(due.reminder.id, reminder.id);
    assert_eq!(due.owner_id.as_ref(), USER_A);
    assert_eq!(due.scheduled_for, reminder.next_run_at);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_rescheduled_reminder_no_longer_resolves_its_old_firing(pool: PgPool) {
    // The window this closes: a reminder edited between fan-out and delivery
    // must not fire at the time its owner moved it away from.
    insert_user(&pool, USER_A).await;
    let reminder = create_due(&pool, USER_A, at(2026, 8, 1, 11)).await;
    let repo = PgRemindersRepo::new(pool);
    let old_firing = DueFiring {
        reminder_id: reminder.id,
        scheduled_for: reminder.next_run_at,
    };

    repo.update_reminder(
        &user(USER_A),
        reminder.id,
        &ReminderUpdate {
            schedule: Some(ScheduleUpdate {
                schedule: once_at(at(2026, 9, 1, 11)),
                next_run_at: at(2026, 9, 1, 11),
            }),
            ..Default::default()
        },
    )
    .await
    .expect("reschedule succeeds");

    let resolved = repo
        .find_due_reminder(old_firing)
        .await
        .expect("read succeeds");

    assert!(resolved.is_none());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_disabled_or_completed_reminder_does_not_resolve_its_firing(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let disabled = create_due(&pool, USER_A, at(2026, 8, 1, 11)).await;
    let completed = create_due(&pool, USER_A, at(2026, 8, 1, 11)).await;
    let repo = PgRemindersRepo::new(pool);

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
    // Completion is the owner's act now, so set it the way they would rather
    // than by delivering the firing — delivering would exclude the row through
    // the sent occurrence instead, and prove nothing about `completed_at`.
    repo.update_reminder(
        &user(USER_A),
        completed.id,
        &ReminderUpdate {
            completed: Some(true),
            ..Default::default()
        },
    )
    .await
    .expect("complete succeeds");

    for reminder in [&disabled, &completed] {
        let resolved = repo
            .find_due_reminder(DueFiring {
                reminder_id: reminder.id,
                scheduled_for: reminder.next_run_at,
            })
            .await
            .expect("read succeeds");
        assert!(resolved.is_none());
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_released_claim_can_be_taken_again_immediately(pool: PgPool) {
    // What makes a failed delivery retry on the queue's schedule rather than
    // waiting out the stale-claim window.
    insert_user(&pool, USER_A).await;
    let reminder = create_due(&pool, USER_A, at(2026, 8, 1, 11)).await;
    let repo = PgRemindersRepo::new(pool);

    assert!(
        repo.claim_occurrence(reminder.id, reminder.next_run_at, no_retry())
            .await
            .expect("first claim succeeds")
    );
    repo.release_occurrence(reminder.id, reminder.next_run_at)
        .await
        .expect("release succeeds");

    // `no_retry()` means nothing stale is reclaimable, so this can only succeed
    // because the release actually removed the claim.
    let retaken = repo
        .claim_occurrence(reminder.id, reminder.next_run_at, no_retry())
        .await
        .expect("second claim succeeds");

    assert!(retaken);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn releasing_a_delivered_firing_does_not_un_send_it(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let reminder = create_due(&pool, USER_A, at(2026, 8, 1, 11)).await;
    let repo = PgRemindersRepo::new(pool.clone());

    repo.claim_occurrence(reminder.id, reminder.next_run_at, no_retry())
        .await
        .expect("claim succeeds");
    repo.complete_occurrence(reminder.id, reminder.next_run_at)
        .await
        .expect("complete succeeds");
    repo.release_occurrence(reminder.id, reminder.next_run_at)
        .await
        .expect("release succeeds");

    // The sent row survives, so a redelivered message still loses the claim.
    let remaining: i64 =
        sqlx::query_scalar(r#"SELECT count(*) FROM reminder_occurrence WHERE reminder_id = $1"#)
            .bind(reminder.id)
            .fetch_one(&pool)
            .await
            .expect("count succeeds");
    assert_eq!(remaining, 1);

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
async fn a_delivered_firing_stops_being_due_without_completing_the_reminder(pool: PgPool) {
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

    // Delivery is not completion. The owner has been told about the reminder;
    // they have not dealt with it, and the client shows it as outstanding until
    // they say otherwise.
    let stored = repo
        .get_reminder(&user(USER_A), reminder.id)
        .await
        .expect("read succeeds")
        .expect("reminder still exists");
    assert!(
        stored.completed_at.is_none(),
        "firing must not mark the reminder as dealt with"
    );

    // It must still drop out of the due set, or the next sweep sends it again —
    // that is the sent occurrence's job now, not `completed_at`.
    let due = repo
        .due_firings(at(2026, 8, 1, 12))
        .await
        .expect("query succeeds");
    assert!(due.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_rescheduled_reminder_becomes_due_again_after_delivery(pool: PgPool) {
    // The sent occurrence is keyed on the firing, so moving the firing makes the
    // reminder due again with nothing having to clear it.
    insert_user(&pool, USER_A).await;
    let reminder = create_due(&pool, USER_A, at(2026, 8, 1, 11)).await;
    let repo = PgRemindersRepo::new(pool.clone());

    repo.claim_occurrence(reminder.id, reminder.next_run_at, no_retry())
        .await
        .expect("claim succeeds");
    repo.complete_occurrence(reminder.id, reminder.next_run_at)
        .await
        .expect("complete succeeds");

    repo.update_reminder(
        &user(USER_A),
        reminder.id,
        &ReminderUpdate {
            schedule: Some(ScheduleUpdate {
                schedule: once_at(at(2026, 8, 2, 11)),
                next_run_at: at(2026, 8, 2, 11),
            }),
            ..Default::default()
        },
    )
    .await
    .expect("reschedule succeeds");

    let due = repo
        .due_firings(at(2026, 8, 2, 12))
        .await
        .expect("query succeeds");

    assert_eq!(due.len(), 1);
    assert_eq!(due[0].reminder_id, reminder.id);
    assert_eq!(due[0].scheduled_for, at(2026, 8, 2, 11));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_reminder_the_owner_completed_is_not_due(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let reminder = create_due(&pool, USER_A, at(2026, 8, 1, 11)).await;
    let repo = PgRemindersRepo::new(pool.clone());

    repo.update_reminder(
        &user(USER_A),
        reminder.id,
        &ReminderUpdate {
            completed: Some(true),
            ..Default::default()
        },
    )
    .await
    .expect("complete succeeds");

    let due = repo
        .due_firings(at(2026, 8, 1, 12))
        .await
        .expect("query succeeds");

    assert!(
        due.is_empty(),
        "a reminder the owner is done with never fires"
    );
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
async fn an_undecodable_row_is_isolated_to_its_own_firing(pool: PgPool) {
    // A sweep reads ids and timestamps only, so nothing it selects can fail to
    // decode: an undecodable row costs its own delivery, which dead-letters and
    // raises the DLQ alarm, and no longer touches anyone else's reminders.
    insert_user(&pool, USER_A).await;
    // Fires first, so a batch-level failure would hide the good one behind it.
    let broken = create_due(&pool, USER_A, at(2026, 8, 1, 10)).await;
    let good = create_due(&pool, USER_A, at(2026, 8, 1, 11)).await;
    let repo = PgRemindersRepo::new(pool.clone());

    // Only reachable by writing around the service: the entity id is a valid
    // uuid, so nothing stops the row landing with an unknown entity type.
    sqlx::query(
        r#"UPDATE reminder SET entity_type = 'chupacabra', entity_id = $2::uuid WHERE id = $1"#,
    )
    .bind(broken.id)
    .bind(DOC_1)
    .execute(&pool)
    .await
    .expect("update should succeed");

    let due = repo
        .due_firings(at(2026, 8, 1, 12))
        .await
        .expect("one bad row must not fail the sweep");

    assert_eq!(due.len(), 2, "the sweep never decodes, so it lists both");

    let broken_firing = DueFiring {
        reminder_id: broken.id,
        scheduled_for: broken.next_run_at,
    };
    assert!(
        repo.find_due_reminder(broken_firing).await.is_err(),
        "the bad row fails its own delivery"
    );

    let good_firing = DueFiring {
        reminder_id: good.id,
        scheduled_for: good.next_run_at,
    };
    assert!(
        repo.find_due_reminder(good_firing)
            .await
            .expect("read succeeds")
            .is_some(),
        "and leaves its neighbour deliverable"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn soup_list_returns_the_users_reminders_newest_firing_first(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let repo = PgRemindersRepo::new(pool);

    repo.create_reminder(
        &user(USER_A),
        &new_reminder("soon", once_at(at(2026, 8, 1, 14))),
    )
    .await
    .expect("insert");
    repo.create_reminder(
        &user(USER_A),
        &new_reminder("later", once_at(at(2026, 9, 1, 14))),
    )
    .await
    .expect("insert");
    repo.create_reminder(
        &user(USER_B),
        &new_reminder("someone else's", once_at(at(2026, 8, 15, 14))),
    )
    .await
    .expect("insert");

    let found = repo
        .list_reminders_for_soup(&user(USER_A), soup_query(100))
        .await
        .expect("soup list should succeed");

    // Descending, matching Soup's global ordering — and never another user's.
    let descriptions: Vec<&str> = found
        .iter()
        .map(|r| r.reminder.description.as_str())
        .collect();
    assert_eq!(descriptions, vec!["later", "soon"]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn soup_list_soonest_first_reverses_the_order(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool);

    for (description, day) in [("soon", 1), ("middle", 15), ("later", 28)] {
        repo.create_reminder(
            &user(USER_A),
            &new_reminder(description, once_at(at(2026, 8, day, 14))),
        )
        .await
        .expect("insert");
    }

    let found = repo
        .list_reminders_for_soup(
            &user(USER_A),
            SoupReminderQuery {
                order: SoupOrder::SoonestFirst,
                ..soup_query(100)
            },
        )
        .await
        .expect("soup list should succeed");

    let descriptions: Vec<&str> = found
        .iter()
        .map(|r| r.reminder.description.as_str())
        .collect();
    assert_eq!(descriptions, vec!["soon", "middle", "later"]);
}

/// The direction picks the rows, not just their order: there is no cursor
/// here, so a bounded read in the wrong direction returns a different set.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn soup_list_takes_the_limit_from_the_ordered_end(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool);

    for (description, day) in [("soon", 1), ("middle", 15), ("later", 28)] {
        repo.create_reminder(
            &user(USER_A),
            &new_reminder(description, once_at(at(2026, 8, day, 14))),
        )
        .await
        .expect("insert");
    }

    let soonest = repo
        .list_reminders_for_soup(
            &user(USER_A),
            SoupReminderQuery {
                order: SoupOrder::SoonestFirst,
                ..soup_query(1)
            },
        )
        .await
        .expect("soup list should succeed");
    assert_eq!(soonest.len(), 1);
    assert_eq!(soonest[0].reminder.description, "soon");

    let latest = repo
        .list_reminders_for_soup(&user(USER_A), soup_query(1))
        .await
        .expect("soup list should succeed");
    assert_eq!(latest.len(), 1);
    assert_eq!(latest[0].reminder.description, "later");
}

/// `fired` is what separates the Active tab from Scheduled, and it has to be
/// applied in SQL: both tabs are otherwise the same `completed = false` query,
/// so the row limit would be spent on whichever end the sort favours.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn soup_list_filters_on_whether_the_reminder_has_come_due(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool);

    repo.create_reminder(
        &user(USER_A),
        &new_reminder("already fired", once_at(at(2026, 3, 1, 9))),
    )
    .await
    .expect("insert");
    repo.create_reminder(
        &user(USER_A),
        &new_reminder("not yet", once_at(at(2099, 1, 1, 9))),
    )
    .await
    .expect("insert");

    let fired = repo
        .list_reminders_for_soup(
            &user(USER_A),
            SoupReminderQuery {
                completed: Some(false),
                fired: Some(true),
                ..soup_query(100)
            },
        )
        .await
        .expect("soup list should succeed");
    assert_eq!(fired.len(), 1);
    assert_eq!(fired[0].reminder.description, "already fired");

    let scheduled = repo
        .list_reminders_for_soup(
            &user(USER_A),
            SoupReminderQuery {
                completed: Some(false),
                fired: Some(false),
                order: SoupOrder::SoonestFirst,
                ..soup_query(100)
            },
        )
        .await
        .expect("soup list should succeed");
    assert_eq!(scheduled.len(), 1);
    assert_eq!(scheduled[0].reminder.description, "not yet");

    let both = repo
        .list_reminders_for_soup(
            &user(USER_A),
            SoupReminderQuery {
                completed: Some(false),
                ..soup_query(100)
            },
        )
        .await
        .expect("soup list should succeed");
    assert_eq!(both.len(), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn soup_list_filters_by_id(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool);

    let wanted = repo
        .create_reminder(
            &user(USER_A),
            &new_reminder("wanted", once_at(at(2026, 8, 1, 14))),
        )
        .await
        .expect("insert");
    repo.create_reminder(
        &user(USER_A),
        &new_reminder("other", once_at(at(2026, 8, 2, 14))),
    )
    .await
    .expect("insert");

    let found = repo
        .list_reminders_for_soup(
            &user(USER_A),
            SoupReminderQuery {
                ids: &[wanted.id],
                ..soup_query(100)
            },
        )
        .await
        .expect("soup list should succeed");

    assert_eq!(found.len(), 1);
    assert_eq!(found[0].reminder.id, wanted.id);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn soup_list_filters_by_entity_token(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool);

    let on_doc = NewReminder {
        entity: Some(EntityType::Document.with_entity_string(DOC_1.to_string())),
        ..new_reminder("on doc-1", once_at(at(2026, 8, 1, 14)))
    };
    let on_other_doc = NewReminder {
        entity: Some(EntityType::Document.with_entity_string(DOC_2.to_string())),
        ..new_reminder("on doc-2", once_at(at(2026, 8, 1, 14)))
    };
    // Same id, different type — proves the token is matched whole, not by id.
    let on_chat = NewReminder {
        entity: Some(EntityType::Chat.with_entity_string(DOC_1.to_string())),
        ..new_reminder("on chat doc-1", once_at(at(2026, 8, 1, 14)))
    };
    for new in [&on_doc, &on_other_doc, &on_chat] {
        repo.create_reminder(&user(USER_A), new)
            .await
            .expect("insert");
    }
    repo.create_reminder(
        &user(USER_A),
        &new_reminder("standalone", once_at(at(2026, 8, 1, 14))),
    )
    .await
    .expect("insert");

    let found = repo
        .list_reminders_for_soup(
            &user(USER_A),
            SoupReminderQuery {
                entities: &[entity_token(&EntityType::Document.with_entity_str(DOC_1))],
                ..soup_query(100)
            },
        )
        .await
        .expect("soup list should succeed");

    assert_eq!(found.len(), 1);
    assert_eq!(found[0].reminder.description, "on doc-1");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn soup_list_filters_on_completion(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool.clone());

    let fired = repo
        .create_reminder(
            &user(USER_A),
            &new_reminder("fired", once_at(at(2026, 8, 1, 14))),
        )
        .await
        .expect("insert");
    repo.create_reminder(
        &user(USER_A),
        &new_reminder("pending", once_at(at(2026, 8, 2, 14))),
    )
    .await
    .expect("insert");

    sqlx::query(r#"UPDATE reminder SET completed_at = now() WHERE id = $1"#)
        .bind(fired.id)
        .execute(&pool)
        .await
        .expect("complete should update");

    let pending = repo
        .list_reminders_for_soup(
            &user(USER_A),
            SoupReminderQuery {
                completed: Some(false),
                ..soup_query(100)
            },
        )
        .await
        .expect("soup list should succeed");
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].reminder.description, "pending");

    let completed = repo
        .list_reminders_for_soup(
            &user(USER_A),
            SoupReminderQuery {
                completed: Some(true),
                ..soup_query(100)
            },
        )
        .await
        .expect("soup list should succeed");
    assert_eq!(completed.len(), 1);
    assert_eq!(completed[0].reminder.description, "fired");

    // `None` means "no constraint", so both come back.
    let both = repo
        .list_reminders_for_soup(&user(USER_A), soup_query(100))
        .await
        .expect("soup list should succeed");
    assert_eq!(both.len(), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_retracts_the_reminders_notification(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool.clone());

    let created = repo
        .create_reminder(
            &user(USER_A),
            &new_reminder("follow up", once_at(at(2026, 8, 1, 14))),
        )
        .await
        .expect("insert");

    // Stand in for the dispatcher having fired it.
    let notification_id = macro_uuid::generate_uuid_v7();
    sqlx::query(
        r#"
        INSERT INTO notification
            (id, notification_event_type, event_item_id, event_item_type, service_sender)
        VALUES ($1, 'reminder', $2, 'reminder', 'reminders')
        "#,
    )
    .bind(notification_id)
    .bind(created.id.to_string())
    .execute(&pool)
    .await
    .expect("notification should insert");
    sqlx::query(r#"INSERT INTO user_notification (user_id, notification_id) VALUES ($1, $2)"#)
        .bind(USER_A)
        .bind(notification_id)
        .execute(&pool)
        .await
        .expect("user_notification should insert");

    assert!(
        repo.delete_reminder(&user(USER_A), created.id)
            .await
            .expect("delete should succeed")
    );

    // Otherwise the Inbox keeps a row pointing at a reminder that is gone.
    let remaining: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM notification WHERE id = $1"#)
        .bind(notification_id)
        .fetch_one(&pool)
        .await
        .expect("count should succeed");
    assert_eq!(remaining, 0, "the firing notification should be retracted");

    // `user_notification` cascades, so the junction row goes with it.
    let junction: i64 =
        sqlx::query_scalar(r#"SELECT count(*) FROM user_notification WHERE notification_id = $1"#)
            .bind(notification_id)
            .fetch_one(&pool)
            .await
            .expect("count should succeed");
    assert_eq!(junction, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_leaves_another_users_notification_alone(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let repo = PgRemindersRepo::new(pool.clone());

    let theirs = repo
        .create_reminder(
            &user(USER_B),
            &new_reminder("theirs", once_at(at(2026, 8, 1, 14))),
        )
        .await
        .expect("insert");

    let notification_id = macro_uuid::generate_uuid_v7();
    sqlx::query(
        r#"
        INSERT INTO notification
            (id, notification_event_type, event_item_id, event_item_type, service_sender)
        VALUES ($1, 'reminder', $2, 'reminder', 'reminders')
        "#,
    )
    .bind(notification_id)
    .bind(theirs.id.to_string())
    .execute(&pool)
    .await
    .expect("notification should insert");

    // USER_A cannot see the reminder, so the delete misses...
    assert!(
        !repo
            .delete_reminder(&user(USER_A), theirs.id)
            .await
            .expect("delete should succeed")
    );

    // ...and must not have retracted USER_B's notification on the way past.
    let remaining: i64 = sqlx::query_scalar(r#"SELECT count(*) FROM notification WHERE id = $1"#)
        .bind(notification_id)
        .fetch_one(&pool)
        .await
        .expect("count should succeed");
    assert_eq!(remaining, 1);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn soup_list_resolves_the_referenced_documents_file_type(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool.clone());

    let doc_id = macro_uuid::generate_uuid_v7().to_string();
    sqlx::query(
        r#"INSERT INTO "Document" (id, name, owner, "fileType") VALUES ($1, $2, $3, 'md')"#,
    )
    .bind(&doc_id)
    .bind("awesome new file")
    .bind(USER_A)
    .execute(&pool)
    .await
    .expect("document should insert");
    sqlx::query(r#"INSERT INTO document_sub_type (document_id, sub_type) VALUES ($1, 'task')"#)
        .bind(&doc_id)
        .execute(&pool)
        .await
        .expect("sub type should insert");

    let on_doc = NewReminder {
        entity: Some(EntityType::Document.with_entity_string(doc_id.clone())),
        ..new_reminder("review it", once_at(at(2026, 8, 1, 14)))
    };
    repo.create_reminder(&user(USER_A), &on_doc)
        .await
        .expect("insert");

    let found = repo
        .list_reminders_for_soup(&user(USER_A), soup_query(100))
        .await
        .expect("soup list should succeed");

    assert_eq!(found.len(), 1);
    // Without these the client cannot tell which block to open or icon, and a
    // referenced document would render as "unknown".
    let reference = found[0]
        .reference
        .as_ref()
        .expect("a referenced document resolves");
    assert_eq!(reference.file_type.as_deref(), Some("md"));
    assert_eq!(reference.sub_type.as_deref(), Some("task"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn soup_list_has_no_reference_for_a_standalone_reminder(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool);

    repo.create_reminder(
        &user(USER_A),
        &new_reminder("standalone", once_at(at(2026, 8, 1, 14))),
    )
    .await
    .expect("insert");

    let found = repo
        .list_reminders_for_soup(&user(USER_A), soup_query(100))
        .await
        .expect("soup list should succeed");

    assert_eq!(found.len(), 1);
    assert!(found[0].reference.is_none());
}
