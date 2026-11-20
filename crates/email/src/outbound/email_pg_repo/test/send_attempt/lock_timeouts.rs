//! User writes on an Outlook inbox share-lock its link, so they run beside a
//! CRM contact population, which share-locks the link for its whole
//! transaction, and give up within the lock timeout behind a mailbox worker or
//! a disconnect, which lock it exclusively.

use super::*;
use crate::domain::scheduled::{EmailSchedulingRepo, ScheduleChange};
use std::time::Duration;

fn thread() -> Uuid {
    Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap()
}

async fn outlook(pool: &Pool<Postgres>) -> anyhow::Result<()> {
    sqlx::query!(
        "UPDATE email_links SET provider='OUTLOOK' WHERE id=$1",
        link()
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// A CRM contact population holds the link this way for its whole transaction.
async fn population(pool: &Pool<Postgres>) -> anyhow::Result<sqlx::Transaction<'static, Postgres>> {
    let mut tx = pool.begin().await?;
    sqlx::query!("SELECT id FROM email_links WHERE id=$1 FOR SHARE", link())
        .fetch_one(&mut *tx)
        .await?;
    Ok(tx)
}

/// A mailbox worker or a disconnect holds the link exclusively.
async fn worker(pool: &Pool<Postgres>) -> anyhow::Result<sqlx::Transaction<'static, Postgres>> {
    let mut tx = pool.begin().await?;
    sqlx::query!("SELECT id FROM email_links WHERE id=$1 FOR UPDATE", link())
        .fetch_one(&mut *tx)
        .await?;
    Ok(tx)
}

/// Fails the test when a write waits past its 5 s lock timeout.
async fn bounded<T>(write: impl std::future::Future<Output = T>) -> T {
    tokio::time::timeout(Duration::from_secs(10), write)
        .await
        .expect("the write waited past its lock timeout")
}

async fn outlook_drafts(pool: &Pool<Postgres>) -> anyhow::Result<i64> {
    Ok(sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM email_mailbox_drafts WHERE message_id=$1"#,
        message()
    )
    .fetch_one(pool)
    .await?)
}

async fn attempts(pool: &Pool<Postgres>) -> anyhow::Result<i64> {
    Ok(sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM email_send_attempts WHERE message_id=$1 AND NOT cancelled"#,
        message()
    )
    .fetch_one(pool)
    .await?)
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn a_draft_save_runs_beside_a_population_and_gives_up_behind_a_worker(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    outlook(&pool).await?;
    let repo = EmailPgRepo::new(pool.clone());
    let draft = prepared();
    let save = || {
        repo.insert_message(
            &draft.message,
            &draft.contacts,
            link(),
            draft.new_thread.clone(),
            true,
        )
    };

    let held = worker(&pool).await?;
    let blocked = bounded(save()).await;
    assert!(
        matches!(blocked, Err(EmailErr::Contended)),
        "{:?}",
        blocked.err()
    );
    assert_eq!(outlook_drafts(&pool).await?, 0);
    held.rollback().await?;

    let held = population(&pool).await?;
    bounded(save()).await?;
    held.rollback().await?;
    assert_eq!(outlook_drafts(&pool).await?, 1);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn a_send_admission_runs_beside_a_population_and_gives_up_behind_a_worker(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    outlook(&pool).await?;
    let repo = EmailPgRepo::new(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());

    let held = worker(&pool).await?;
    let blocked = bounded(repo.admit_send(&actor(), link(), attempt, prepared())).await;
    assert!(
        matches!(blocked, Err(EmailErr::Contended)),
        "{:?}",
        blocked.err()
    );
    assert_eq!(attempts(&pool).await?, 0);
    held.rollback().await?;

    let held = population(&pool).await?;
    bounded(repo.admit_send(&actor(), link(), attempt, prepared())).await?;
    held.rollback().await?;
    assert_eq!(attempts(&pool).await?, 1);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn concurrent_admissions_of_one_draft_still_send_it_once(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    outlook(&pool).await?;
    // Both admissions queue behind a worker, so they take their share locks
    // together when it commits and meet only at the draft's own row.
    let held = worker(&pool).await?;
    let admit = |pool: Pool<Postgres>| {
        tokio::spawn(async move {
            EmailPgRepo::new(pool)
                .admit_send(
                    &actor(),
                    link(),
                    SendAttemptId(macro_uuid::generate_uuid_v7()),
                    prepared(),
                )
                .await
        })
    };
    let first = admit(pool.clone());
    let second = admit(pool.clone());
    wait_for_lock_waiters(&pool, 2).await?;
    held.commit().await?;

    let (first, second) = (bounded(first).await?, bounded(second).await?);
    let admitted = [&first, &second].into_iter().filter(|r| r.is_ok()).count();
    assert_eq!(admitted, 1, "{:?} {:?}", first.err(), second.err());
    let refused = [first, second].into_iter().find_map(Result::err);
    assert!(
        matches!(
            refused,
            Some(EmailErr::DraftGenerationConflict(_) | EmailErr::MessageDeliveryConflict(_))
        ),
        "{refused:?}"
    );
    assert_eq!(attempts(&pool).await?, 1);
    Ok(())
}

/// Waits until `count` sessions in this test's database wait on a lock.
async fn wait_for_lock_waiters(pool: &Pool<Postgres>, count: i64) -> anyhow::Result<()> {
    tokio::time::timeout(Duration::from_secs(4), async {
        loop {
            let waiting = sqlx::query_scalar!(
                r#"SELECT count(*) AS "count!" FROM pg_stat_activity
                    WHERE datname = current_database() AND wait_event_type = 'Lock'"#
            )
            .fetch_one(pool)
            .await?;
            if waiting >= count {
                return Ok::<_, anyhow::Error>(());
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await??;
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn undo_send_runs_beside_a_population_and_gives_up_behind_a_worker(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    outlook(&pool).await?;
    let repo = EmailPgRepo::new(pool.clone());
    let attempt = SendAttemptId(macro_uuid::generate_uuid_v7());
    repo.admit_send(&actor(), link(), attempt, prepared())
        .await?;

    let held = worker(&pool).await?;
    let blocked = bounded(repo.cancel_send(&actor(), link(), attempt)).await;
    assert!(
        matches!(blocked, Err(EmailErr::Contended)),
        "{:?}",
        blocked.err()
    );
    assert_eq!(attempts(&pool).await?, 1);
    held.rollback().await?;

    let held = population(&pool).await?;
    bounded(repo.cancel_send(&actor(), link(), attempt)).await?;
    held.rollback().await?;
    assert_eq!(attempts(&pool).await?, 0);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn scheduling_runs_beside_a_population_and_gives_up_behind_a_worker(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    outlook(&pool).await?;
    let repo = EmailPgRepo::new(pool.clone());
    let actor = actor();
    let schedule = || {
        repo.change_schedule(
            link(),
            message(),
            &actor,
            ScheduleChange::Set(Utc::now() + chrono::Duration::hours(1)),
            None,
            0,
        )
    };
    let scheduled = || async {
        sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM email_scheduled_messages WHERE message_id=$1"#,
            message()
        )
        .fetch_one(&pool)
        .await
    };

    let held = worker(&pool).await?;
    let blocked = bounded(schedule()).await;
    assert!(
        matches!(blocked, Err(EmailErr::Contended)),
        "{:?}",
        blocked.err()
    );
    assert_eq!(scheduled().await?, 0);
    held.rollback().await?;

    let held = population(&pool).await?;
    bounded(schedule()).await?;
    held.rollback().await?;
    assert_eq!(scheduled().await?, 1);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn a_discard_runs_beside_a_population_and_gives_up_behind_a_worker(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    outlook(&pool).await?;
    let repo = EmailPgRepo::new(pool.clone());
    let actor = actor();
    let links = [link()];
    let discard =
        || repo.delete_draft_message(message(), thread(), &links, Some(actor.as_ref()), 0);

    let held = worker(&pool).await?;
    let blocked = bounded(discard()).await;
    assert!(
        matches!(blocked, Err(EmailErr::Contended)),
        "{:?}",
        blocked.err()
    );
    assert_eq!(outlook_drafts(&pool).await?, 0);
    held.rollback().await?;

    let held = population(&pool).await?;
    let deleted = bounded(discard()).await?;
    held.rollback().await?;
    assert!(deleted.is_some());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn a_sender_block_gives_up_behind_a_population(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = EmailPgRepo::new(pool.clone());
    let actor = actor();
    let block = || repo.commit_sender_policy(&actor, link(), "sender@example.com", true, None);
    let filters = || async {
        sqlx::query_scalar!(
            r#"SELECT count(*) AS "count!" FROM email_mailbox_settings_work WHERE link_id=$1"#,
            link()
        )
        .fetch_one(&pool)
        .await
    };

    // The settings worker serializes on the exclusive link lock, so a sender
    // block still waits for a population, then gives up.
    let held = population(&pool).await?;
    let blocked = bounded(block()).await;
    assert!(matches!(blocked, Err(EmailErr::Contended)), "{blocked:?}");
    assert_eq!(filters().await?, 0);
    held.rollback().await?;

    bounded(block()).await?;
    assert_eq!(filters().await?, 1);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn a_draft_save_recomputes_its_thread_after_another_write_to_it(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    outlook(&pool).await?;
    // A first save settles the thread, so the next save's recompute reaches
    // the thread row only in the statement that writes its aggregate.
    let draft = prepared();
    EmailPgRepo::new(pool.clone())
        .insert_message(&draft.message, &draft.contacts, link(), None, true)
        .await?;
    // Another write in the thread marks its received message unread and
    // holds the thread while the draft save runs beside it.
    let mut other = pool.begin().await?;
    sqlx::query!(
        "UPDATE email_messages SET is_read = false WHERE id = 'ee000001-0000-0000-0000-000000000001'"
    )
    .execute(&mut *other)
    .await?;
    sqlx::query!(
        "SELECT id FROM email_threads WHERE id = $1 FOR UPDATE",
        thread()
    )
    .fetch_one(&mut *other)
    .await?;
    let save = tokio::spawn({
        let pool = pool.clone();
        async move {
            let draft = prepared();
            EmailPgRepo::new(pool)
                .insert_message(&draft.message, &draft.contacts, link(), None, true)
                .await
                .map(|_| ())
        }
    });
    wait_for_lock_waiters(&pool, 1).await?;
    other.commit().await?;
    bounded(save).await??;

    let read = sqlx::query_scalar!("SELECT is_read FROM email_threads WHERE id = $1", thread())
        .fetch_one(&pool)
        .await?;
    assert!(
        !read,
        "the save recomputed the thread without the unread message"
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("email_draft"))
)]
async fn new_drafts_saved_together_in_one_thread_both_commit(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    outlook(&pool).await?;
    // Another writer holds the thread, so both saves insert their message,
    // which key-share-locks the thread, before either reaches the recompute.
    let mut held = pool.begin().await?;
    sqlx::query!(
        "SELECT id FROM email_threads WHERE id = $1 FOR NO KEY UPDATE",
        thread()
    )
    .fetch_one(&mut *held)
    .await?;
    let save = |pool: Pool<Postgres>| {
        tokio::spawn(async move {
            let mut draft = prepared();
            draft.message.db_id = macro_uuid::generate_uuid_v7();
            draft.message.send_time = None;
            EmailPgRepo::new(pool)
                .insert_message(&draft.message, &draft.contacts, link(), None, true)
                .await
                // The settled ids prove the save was accepted, not refused.
                .map(|settled| settled.is_some())
        })
    };
    let (first, second) = (save(pool.clone()), save(pool.clone()));
    wait_for_lock_waiters(&pool, 2).await?;
    held.commit().await?;

    let (first, second) = (bounded(first).await?, bounded(second).await?);
    assert!(
        matches!((&first, &second), (Ok(true), Ok(true))),
        "{first:?} {second:?}"
    );
    Ok(())
}
