use super::*;
use crate::domain::email_followup::EmailFollowup;
use chrono::{Duration, TimeZone};
use macro_db_migrator::MACRO_DB_MIGRATIONS;

mod email_collection;
const USER_A: &str = "macro|reminders-a@macro.com";
const USER_B: &str = "macro|reminders-b@macro.com";
fn user(id: &str) -> MacroUserIdStr<'_> {
    MacroUserIdStr::parse_from_str(id).unwrap()
}
fn at(y: i32, m: u32, d: u32, h: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(y, m, d, h, 0, 0).single().unwrap()
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

fn no_retry() -> DateTime<Utc> {
    at(2000, 1, 1, 0)
}
async fn create_due(pool: &PgPool, user_id: &str, remind_at: DateTime<Utc>) -> EmailFollowup {
    email_collection::snooze(
        &PgRemindersRepo::new(pool.clone()),
        user_id,
        Uuid::now_v7(),
        remind_at,
    )
    .await
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
    assert_eq!(due[0].reminder_id, past.reminder_id);
    // The firing being delivered is the reminder's next_run_at, which is what
    // keys the occurrence row.
    assert_eq!(due[0].scheduled_for, past.remind_at);
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
async fn a_fanned_out_firing_resolves_to_its_reminder_and_owner(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let reminder = create_due(&pool, USER_A, at(2026, 8, 1, 11)).await;
    let repo = PgRemindersRepo::new(pool);

    let due = repo
        .find_due_reminder(DueFiring {
            reminder_id: reminder.reminder_id,
            scheduled_for: reminder.remind_at,
        })
        .await
        .expect("read succeeds")
        .expect("firing resolves");

    assert_eq!(due.reminder_id, reminder.reminder_id);
    assert_eq!(due.owner_id.as_ref(), USER_A);
    assert_eq!(due.scheduled_for, reminder.remind_at);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_released_claim_can_be_taken_again_immediately(pool: PgPool) {
    // What makes a failed delivery retry on the queue's schedule rather than
    // waiting out the stale-claim window.
    insert_user(&pool, USER_A).await;
    let reminder = create_due(&pool, USER_A, at(2026, 8, 1, 11)).await;
    let repo = PgRemindersRepo::new(pool);

    assert!(
        repo.claim_occurrence(reminder.reminder_id, reminder.remind_at, no_retry())
            .await
            .expect("first claim succeeds")
    );
    repo.release_occurrence(reminder.reminder_id, reminder.remind_at)
        .await
        .expect("release succeeds");

    // `no_retry()` means nothing stale is reclaimable, so this can only succeed
    // because the release actually removed the claim.
    let retaken = repo
        .claim_occurrence(reminder.reminder_id, reminder.remind_at, no_retry())
        .await
        .expect("second claim succeeds");

    assert!(retaken);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn releasing_a_delivered_firing_does_not_un_send_it(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let reminder = create_due(&pool, USER_A, at(2026, 8, 1, 11)).await;
    let repo = PgRemindersRepo::new(pool.clone());

    repo.claim_occurrence(reminder.reminder_id, reminder.remind_at, no_retry())
        .await
        .expect("claim succeeds");
    repo.complete_occurrence(reminder.reminder_id, reminder.remind_at)
        .await
        .expect("complete succeeds");
    repo.release_occurrence(reminder.reminder_id, reminder.remind_at)
        .await
        .expect("release succeeds");

    // The sent row survives, so a redelivered message still loses the claim.
    let remaining: i64 =
        sqlx::query_scalar(r#"SELECT count(*) FROM reminder_occurrence WHERE reminder_id = $1"#)
            .bind(reminder.reminder_id)
            .fetch_one(&pool)
            .await
            .expect("count succeeds");
    assert_eq!(remaining, 1);

    let reclaimed = repo
        .claim_occurrence(
            reminder.reminder_id,
            reminder.remind_at,
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
        .claim_occurrence(reminder.reminder_id, reminder.remind_at, no_retry())
        .await
        .expect("first claim succeeds");
    let second = repo
        .claim_occurrence(reminder.reminder_id, reminder.remind_at, no_retry())
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
        repo.claim_occurrence(reminder.reminder_id, reminder.remind_at, no_retry())
            .await
            .expect("first claim succeeds")
    );

    // A dispatcher that claimed and then died leaves sent_at NULL. Once the
    // claim ages past the retry window another sweep must be able to take it.
    let retaken = repo
        .claim_occurrence(
            reminder.reminder_id,
            reminder.remind_at,
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

    repo.claim_occurrence(reminder.reminder_id, reminder.remind_at, no_retry())
        .await
        .expect("claim succeeds");
    repo.complete_occurrence(reminder.reminder_id, reminder.remind_at)
        .await
        .expect("complete succeeds");

    // Even with a retry window wide enough to reclaim anything unsent, a sent
    // firing must stay sent — this is what stops a duplicate notification.
    let reclaimed = repo
        .claim_occurrence(
            reminder.reminder_id,
            reminder.remind_at,
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

    repo.claim_occurrence(reminder.reminder_id, reminder.remind_at, no_retry())
        .await
        .expect("claim succeeds");
    repo.complete_occurrence(reminder.reminder_id, reminder.remind_at)
        .await
        .expect("complete succeeds");

    let sent_at: Option<DateTime<Utc>> = sqlx::query_scalar(
        r#"SELECT sent_at FROM reminder_occurrence WHERE reminder_id = $1 AND scheduled_for = $2"#,
    )
    .bind(reminder.reminder_id)
    .bind(reminder.remind_at)
    .fetch_one(&pool)
    .await
    .expect("occurrence exists");
    assert!(sent_at.is_some());

    // It must still drop out of the due set, or the next sweep sends it again —
    // that is the sent occurrence's job now, not `completed_at`.
    let due = repo
        .due_firings(at(2026, 8, 1, 12))
        .await
        .expect("query succeeds");
    assert!(due.is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn removing_snooze_retracts_only_its_email_notification(pool: PgPool) {
    use crate::domain::email_followup::{EmailFollowupRepo, FollowupState};
    insert_user(&pool, USER_A).await;
    let repo = PgRemindersRepo::new(pool.clone());
    let snooze = create_due(&pool, USER_A, at(2026, 8, 1, 11)).await;
    let removed_id = Uuid::now_v7();
    let other_id = Uuid::now_v7();
    let mail_id = Uuid::now_v7();
    let other_thread_id = Uuid::now_v7();
    for (id, event, owner, thread) in [
        (removed_id, "reminder", snooze.reminder_id, snooze.thread_id),
        (other_id, "reminder", Uuid::now_v7(), snooze.thread_id),
        (mail_id, "new_email", snooze.reminder_id, snooze.thread_id),
        (
            other_thread_id,
            "reminder",
            snooze.reminder_id,
            Uuid::now_v7(),
        ),
    ] {
        sqlx::query!(
            "INSERT INTO notification (id, notification_event_type, event_item_id, event_item_type, service_sender, metadata) VALUES ($1, $2, $3, 'email_thread', 'reminders', $4)",
            id, event, thread.to_string(), serde_json::json!({"reminderId": owner}),
        ).execute(&pool).await.unwrap();
    }
    let mut record = repo
        .reminder_followup(&user(USER_A), snooze.reminder_id)
        .await
        .unwrap()
        .unwrap();
    record.followup.state = FollowupState::Removed;
    repo.save_followup(&record, None, None).await.unwrap();
    let remaining = sqlx::query_scalar!("SELECT id FROM notification ORDER BY id")
        .fetch_all(&pool)
        .await
        .unwrap();
    let mut expected = vec![other_id, mail_id, other_thread_id];
    expected.sort();
    assert_eq!(remaining, expected);
}
