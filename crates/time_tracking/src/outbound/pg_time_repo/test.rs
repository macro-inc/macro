use std::sync::{Arc, Mutex};

use chrono::{TimeDelta, TimeZone};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use tokio::sync::oneshot;

use super::*;
use crate::domain::models::EntrySpan;

const AUTHOR: &str = "macro|author@example.com";
const EDITOR: &str = "macro|editor@example.com";
const TASK: &str = "00000000-0000-0000-0000-0000000000a1";
const OTHER_TASK: &str = "00000000-0000-0000-0000-0000000000a2";
const NOTE_DOCUMENT: &str = "00000000-0000-0000-0000-0000000000b1";
const TRASHED_TASK: &str = "00000000-0000-0000-0000-0000000000c1";

/// Holds the first writer that reaches its checkpoint until the test releases it.
pub(super) struct Pause {
    checkpoint: Checkpoint,
    reached: Mutex<Option<oneshot::Sender<()>>>,
    release: Mutex<Option<oneshot::Receiver<()>>>,
}

impl Pause {
    pub(super) async fn wait(&self, checkpoint: Checkpoint) {
        if checkpoint != self.checkpoint {
            return;
        }
        let reached = self.reached.lock().unwrap().take();
        let release = self.release.lock().unwrap().take();
        if let (Some(reached), Some(release)) = (reached, release) {
            reached.send(()).unwrap();
            release.await.unwrap();
        }
    }
}

fn paused(
    pool: PgPool,
    checkpoint: Checkpoint,
) -> (
    PgTimeTrackingRepository,
    oneshot::Receiver<()>,
    oneshot::Sender<()>,
) {
    let (reached_tx, reached_rx) = oneshot::channel();
    let (release_tx, release_rx) = oneshot::channel();
    let repo = PgTimeTrackingRepository {
        pool,
        pause: Some(Arc::new(Pause {
            checkpoint,
            reached: Mutex::new(Some(reached_tx)),
            release: Mutex::new(Some(release_rx)),
        })),
    };
    (repo, reached_rx, release_tx)
}

fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

fn at(hour: u32, minute: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 20, hour, minute, 0)
        .single()
        .unwrap()
}

fn day(date: u32) -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 11, date).unwrap()
}

fn typed(id: u128, user_id: &str, task_id: &str, minutes: u16) -> NewEntryRow {
    NewEntryRow {
        id: Uuid::from_u128(id),
        task_id: task_id.to_string(),
        user_id: user(user_id),
        values: EntryValues {
            date: day(20),
            minutes,
            note: Some("drafting".to_string()),
            span: None,
        },
        source: TimeEntrySource::Manual,
    }
}

fn timer(id: u128, task_id: &str, started_at: DateTime<Utc>) -> RunningTimer {
    RunningTimer {
        id: Uuid::from_u128(id),
        task_id: task_id.to_string(),
        started_at,
    }
}

fn timer_entry(timer: &RunningTimer, user_id: &str, ended_at: DateTime<Utc>) -> NewEntryRow {
    NewEntryRow {
        id: timer.id,
        task_id: timer.task_id.clone(),
        user_id: user(user_id),
        values: EntryValues {
            date: timer.started_at.date_naive(),
            minutes: u16::try_from((ended_at - timer.started_at).num_minutes()).unwrap(),
            note: None,
            span: Some(EntrySpan {
                started_at: timer.started_at,
                ended_at,
            }),
        },
        source: TimeEntrySource::Timer,
    }
}

async fn stored_sum(pool: &PgPool, task_id: &str) -> i64 {
    sqlx::query_scalar!(
        r#"SELECT COALESCE(sum(minutes), 0)::bigint AS "sum!" FROM time_entry WHERE task_id = $1"#,
        task_id,
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn stored_total(pool: &PgPool, task_id: &str) -> u32 {
    time_logged::read_task_time_logged(pool, task_id)
        .await
        .unwrap()
}

fn inserted(outcome: InsertEntryOutcome) -> LoggedTime {
    match outcome {
        InsertEntryOutcome::Inserted(logged) => logged,
        other => panic!("expected an insert, got {other:?}"),
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_tracking"))
)]
async fn a_replayed_create_stores_one_entry(pool: PgPool) -> anyhow::Result<()> {
    let repo = PgTimeTrackingRepository::new(pool.clone());
    let row = typed(1, AUTHOR, TASK, 45);

    let first = inserted(repo.insert_entry(&row).await?);
    let replay = repo
        .insert_entry(&NewEntryRow {
            values: EntryValues {
                minutes: 90,
                ..row.values.clone()
            },
            ..row.clone()
        })
        .await?;

    assert_eq!(replay, InsertEntryOutcome::Existing(first.entry.clone()));
    assert_eq!(first.total_minutes, 45);
    assert_eq!(stored_sum(&pool, TASK).await, 45);
    assert_eq!(stored_total(&pool, TASK).await, 45);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_tracking"))
)]
async fn the_total_is_the_sum_after_create_edit_and_delete(pool: PgPool) -> anyhow::Result<()> {
    let repo = PgTimeTrackingRepository::new(pool.clone());
    let first = inserted(repo.insert_entry(&typed(1, AUTHOR, TASK, 45)).await?);
    let second = inserted(repo.insert_entry(&typed(2, EDITOR, TASK, 30)).await?);
    assert_eq!(second.total_minutes, 75);

    let edited = repo
        .update_entry(
            Uuid::from_u128(1),
            &user(AUTHOR),
            &EntryValues {
                date: day(19),
                minutes: 60,
                note: None,
                span: Some(EntrySpan {
                    started_at: at(9, 0),
                    ended_at: at(10, 0),
                }),
            },
            first.entry.updated_at,
        )
        .await?;
    let UpdateEntryOutcome::Written(edited) = edited else {
        panic!("expected the edit to be written");
    };
    assert_eq!(edited.total_minutes, 90);
    assert_eq!(edited.entry.date, day(19));
    assert_eq!(edited.entry.note, None);
    assert_eq!(edited.entry.started_at, Some(at(9, 0)));
    assert!(edited.entry.updated_at >= edited.entry.created_at);

    let deleted = repo.delete_entry(Uuid::from_u128(2), &user(EDITOR)).await?;
    assert_eq!(deleted, DeleteEntryOutcome::Deleted(60));
    assert_eq!(stored_sum(&pool, TASK).await, 60);
    assert_eq!(stored_total(&pool, TASK).await, 60);

    let last = repo.delete_entry(Uuid::from_u128(1), &user(AUTHOR)).await?;
    assert_eq!(last, DeleteEntryOutcome::Deleted(0));
    assert_eq!(stored_total(&pool, TASK).await, 0);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_tracking"))
)]
async fn only_the_author_row_is_changed_or_deleted(pool: PgPool) -> anyhow::Result<()> {
    let repo = PgTimeTrackingRepository::new(pool.clone());
    let row = typed(1, AUTHOR, TASK, 45);
    let stored = inserted(repo.insert_entry(&row).await?);

    let edit = repo
        .update_entry(row.id, &user(EDITOR), &row.values, stored.entry.updated_at)
        .await?;
    let delete = repo.delete_entry(row.id, &user(EDITOR)).await?;

    assert_eq!(edit, UpdateEntryOutcome::EntryMissing);
    assert_eq!(delete, DeleteEntryOutcome::EntryMissing);
    assert_eq!(stored_sum(&pool, TASK).await, 45);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_tracking"))
)]
async fn an_edit_of_an_entry_changed_since_it_was_read_writes_nothing(
    pool: PgPool,
) -> anyhow::Result<()> {
    let repo = PgTimeTrackingRepository::new(pool.clone());
    let row = typed(1, AUTHOR, TASK, 45);
    let stored = inserted(repo.insert_entry(&row).await?);
    let other_device = EntryValues {
        minutes: 75,
        ..row.values.clone()
    };
    let UpdateEntryOutcome::Written(newer) = repo
        .update_entry(
            row.id,
            &user(AUTHOR),
            &other_device,
            stored.entry.updated_at,
        )
        .await?
    else {
        panic!("expected the first edit to be written");
    };

    let stale = repo
        .update_entry(
            row.id,
            &user(AUTHOR),
            &EntryValues {
                note: Some("reviewed".to_string()),
                ..row.values.clone()
            },
            stored.entry.updated_at,
        )
        .await?;

    assert_eq!(stale, UpdateEntryOutcome::Changed);
    assert_eq!(repo.entry(row.id).await?, Some(newer.entry));
    assert_eq!(stored_total(&pool, TASK).await, 75);
    Ok(())
}

/// Two writers on one task: the first has read the task's sum and not yet
/// stored it when the second starts. Without the task lock the second sums
/// without the first's uncommitted entry, stores its own total, and the
/// first then overwrites it with a sum that misses the second's entry.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_tracking"))
)]
async fn concurrent_writers_on_one_task_store_the_full_total(pool: PgPool) -> anyhow::Result<()> {
    let (first_writer, first_reached, release_first) =
        paused(pool.clone(), Checkpoint::TotalSummed);
    let second_writer = PgTimeTrackingRepository::new(pool.clone());

    let first = tokio::spawn(async move {
        first_writer
            .insert_entry(&typed(1, AUTHOR, TASK, 15))
            .await
            .map(inserted)
    });
    first_reached.await?;
    let second = tokio::spawn(async move {
        second_writer
            .insert_entry(&typed(2, EDITOR, TASK, 15))
            .await
            .map(inserted)
    });

    // Whether the second writer must wait decides the order, without timing:
    // if the task's lock is free, let the second writer finish first, which
    // is the interleaving that loses an entry; otherwise it is blocked behind
    // the first, which can go on.
    let mut probe = pool.begin().await?;
    let lock_is_free = sqlx::query_scalar!(
        r#"SELECT pg_try_advisory_xact_lock(hashtextextended('time_entry:' || $1, 0)) AS "free!""#,
        TASK,
    )
    .fetch_one(&mut *probe)
    .await?;
    probe.rollback().await?;
    let second = if lock_is_free {
        let finished = second.await??;
        release_first.send(()).unwrap();
        first.await??;
        finished
    } else {
        release_first.send(()).unwrap();
        first.await??;
        second.await??
    };

    assert_eq!(stored_sum(&pool, TASK).await, 30);
    assert_eq!(stored_total(&pool, TASK).await, 30);
    assert_eq!(second.total_minutes, 30);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_tracking"))
)]
async fn entries_page_newest_day_first(pool: PgPool) -> anyhow::Result<()> {
    let repo = PgTimeTrackingRepository::new(pool.clone());
    for (id, date) in [(1, 18), (2, 20), (3, 20), (4, 19)] {
        let row = typed(id, AUTHOR, TASK, 10);
        inserted(
            repo.insert_entry(&NewEntryRow {
                values: EntryValues {
                    date: day(date),
                    ..row.values.clone()
                },
                ..row
            })
            .await?,
        );
    }
    inserted(repo.insert_entry(&typed(5, AUTHOR, OTHER_TASK, 10)).await?);

    let first = repo.entries(TASK, 2, None).await?;
    let cursor = first.last().map(|entry| TimeEntryCursor {
        date: entry.date,
        id: entry.id,
    });
    let rest = repo.entries(TASK, 10, cursor).await?;

    let ids = |entries: &[TimeEntry]| {
        entries
            .iter()
            .map(|entry| entry.id.as_u128())
            .collect::<Vec<_>>()
    };
    assert_eq!(ids(&first), vec![3, 2]);
    assert_eq!(ids(&rest), vec![4, 1]);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_tracking"))
)]
async fn trashed_tasks_and_documents_that_are_not_tasks_take_no_time(
    pool: PgPool,
) -> anyhow::Result<()> {
    let repo = PgTimeTrackingRepository::new(pool.clone());
    let row = typed(1, AUTHOR, TASK, 45);
    let stored = inserted(repo.insert_entry(&row).await?);

    for task_id in [
        TRASHED_TASK,
        NOTE_DOCUMENT,
        "00000000-0000-0000-0000-0000000000ff",
    ] {
        assert_eq!(
            repo.insert_entry(&typed(2, AUTHOR, task_id, 10)).await?,
            InsertEntryOutcome::TaskUnavailable,
            "{task_id}"
        );
        assert_eq!(
            repo.start_timer(&user(AUTHOR), &timer(0x71, task_id, at(9, 0)), None)
                .await?,
            StartTimerOutcome::TaskUnavailable,
            "{task_id}"
        );
    }

    sqlx::query!(
        r#"UPDATE "Document" SET "deletedAt" = now() WHERE id = $1"#,
        TASK
    )
    .execute(&pool)
    .await?;
    assert_eq!(
        repo.update_entry(row.id, &user(AUTHOR), &row.values, stored.entry.updated_at)
            .await?,
        UpdateEntryOutcome::TaskUnavailable
    );
    assert_eq!(
        repo.delete_entry(row.id, &user(AUTHOR)).await?,
        DeleteEntryOutcome::TaskUnavailable
    );
    assert_eq!(stored_total(&pool, TASK).await, 45);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_tracking"))
)]
async fn a_person_has_at_most_one_running_timer(pool: PgPool) -> anyhow::Result<()> {
    let repo = PgTimeTrackingRepository::new(pool.clone());
    let running = timer(0x71, TASK, at(9, 0));
    assert_eq!(
        repo.start_timer(&user(AUTHOR), &running, None).await?,
        StartTimerOutcome::Started(None)
    );

    let unseen = repo
        .start_timer(&user(AUTHOR), &timer(0x72, OTHER_TASK, at(9, 5)), None)
        .await?;
    let second_row = sqlx::query!(
        "INSERT INTO time_timer (user_id, id, task_id, started_at) VALUES ($1, $2, $3, now())",
        AUTHOR,
        Uuid::from_u128(0x73),
        OTHER_TASK,
    )
    .execute(&pool)
    .await;

    assert_eq!(unseen, StartTimerOutcome::TimerChanged);
    assert!(second_row.is_err(), "the table allows one timer per person");
    assert_eq!(repo.timer(&user(AUTHOR)).await?, Some(running));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_tracking"))
)]
async fn a_start_while_running_saves_the_first_timer_in_the_same_transaction(
    pool: PgPool,
) -> anyhow::Result<()> {
    let repo = PgTimeTrackingRepository::new(pool.clone());
    let first = timer(0x71, TASK, at(9, 0));
    repo.start_timer(&user(AUTHOR), &first, None).await?;

    let second = timer(0x72, OTHER_TASK, at(9, 42));
    let outcome = repo
        .start_timer(
            &user(AUTHOR),
            &second,
            Some(&timer_entry(&first, AUTHOR, at(9, 42))),
        )
        .await?;

    let StartTimerOutcome::Started(Some(stopped)) = outcome else {
        panic!("expected the first timer saved, got {outcome:?}");
    };
    assert_eq!(stopped.entry.id, first.id);
    assert_eq!(stopped.entry.source, TimeEntrySource::Timer);
    assert_eq!(stopped.entry.minutes, 42);
    assert_eq!(stopped.total_minutes, 42);
    assert_eq!(stored_total(&pool, TASK).await, 42);
    assert_eq!(repo.timer(&user(AUTHOR)).await?, Some(second.clone()));

    // Expecting a timer that is no longer the running one changes nothing:
    // neither the stop of the expected timer nor the new start is kept.
    let stale = repo
        .start_timer(
            &user(AUTHOR),
            &timer(0x73, TASK, at(10, 0)),
            Some(&timer_entry(
                &timer(0x79, TASK, at(9, 0)),
                AUTHOR,
                at(10, 0),
            )),
        )
        .await?;
    assert_eq!(stale, StartTimerOutcome::TimerChanged);
    assert_eq!(repo.timer(&user(AUTHOR)).await?, Some(second));
    assert_eq!(stored_sum(&pool, TASK).await, 42);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_tracking"))
)]
async fn a_stopped_timer_id_cannot_start_again(pool: PgPool) -> anyhow::Result<()> {
    let repo = PgTimeTrackingRepository::new(pool.clone());
    let first = timer(0x71, TASK, at(9, 0));
    repo.start_timer(&user(AUTHOR), &first, None).await?;
    repo.stop_timer(&timer_entry(&first, AUTHOR, at(9, 30)))
        .await?;

    assert_eq!(
        repo.start_timer(&user(AUTHOR), &first, None).await?,
        StartTimerOutcome::IdTaken
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_tracking"))
)]
async fn a_stop_sent_twice_saves_one_entry(pool: PgPool) -> anyhow::Result<()> {
    let repo = PgTimeTrackingRepository::new(pool.clone());
    let running = timer(0x71, TASK, at(9, 0));
    repo.start_timer(&user(AUTHOR), &running, None).await?;
    let row = timer_entry(&running, AUTHOR, at(9, 50));

    let first = repo.stop_timer(&row).await?;
    let second = repo.stop_timer(&row).await?;

    let StopTimerOutcome::Stopped(logged) = first else {
        panic!("expected the first stop to save");
    };
    assert_eq!(logged.entry.minutes, 50);
    assert_eq!(second, StopTimerOutcome::TimerGone);
    assert_eq!(stored_sum(&pool, TASK).await, 50);
    assert_eq!(repo.entry(running.id).await?, Some(logged.entry));
    assert_eq!(repo.timer(&user(AUTHOR)).await?, None);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_tracking"))
)]
async fn a_timer_on_a_task_trashed_meanwhile_still_stops(pool: PgPool) -> anyhow::Result<()> {
    let repo = PgTimeTrackingRepository::new(pool.clone());
    let running = timer(0x71, TASK, at(9, 0));
    repo.start_timer(&user(AUTHOR), &running, None).await?;
    sqlx::query!(
        r#"UPDATE "Document" SET "deletedAt" = now() WHERE id = $1"#,
        TASK
    )
    .execute(&pool)
    .await?;

    let stopped = repo
        .stop_timer(&timer_entry(&running, AUTHOR, at(9, 20)))
        .await?;

    assert!(matches!(stopped, StopTimerOutcome::Stopped(logged) if logged.total_minutes == 20));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_tracking"))
)]
async fn discarding_saves_nothing_and_only_touches_ones_own_timer(
    pool: PgPool,
) -> anyhow::Result<()> {
    let repo = PgTimeTrackingRepository::new(pool.clone());
    let running = timer(0x71, TASK, at(9, 0));
    repo.start_timer(&user(AUTHOR), &running, None).await?;

    repo.discard_timer(&user(EDITOR), running.id).await?;
    assert_eq!(repo.timer(&user(AUTHOR)).await?, Some(running.clone()));

    repo.discard_timer(&user(AUTHOR), running.id).await?;
    assert_eq!(repo.timer(&user(AUTHOR)).await?, None);
    assert_eq!(repo.entry(running.id).await?, None);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_tracking"))
)]
async fn purging_a_task_deletes_its_entries_and_timers(pool: PgPool) -> anyhow::Result<()> {
    let repo = PgTimeTrackingRepository::new(pool.clone());
    inserted(repo.insert_entry(&typed(1, AUTHOR, TASK, 45)).await?);
    inserted(repo.insert_entry(&typed(2, AUTHOR, OTHER_TASK, 10)).await?);
    repo.start_timer(&user(EDITOR), &timer(0x71, TASK, at(9, 0)), None)
        .await?;

    sqlx::query!(
        r#"DELETE FROM document_sub_type WHERE document_id = $1"#,
        TASK
    )
    .execute(&pool)
    .await?;
    sqlx::query!(r#"DELETE FROM "Document" WHERE id = $1"#, TASK)
        .execute(&pool)
        .await?;

    assert_eq!(repo.entry(Uuid::from_u128(1)).await?, None);
    assert_eq!(repo.timer(&user(EDITOR)).await?, None);
    assert!(repo.entry(Uuid::from_u128(2)).await?.is_some());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_tracking"))
)]
async fn a_deleted_account_keeps_its_entries_and_loses_its_timer(
    pool: PgPool,
) -> anyhow::Result<()> {
    let repo = PgTimeTrackingRepository::new(pool.clone());
    inserted(repo.insert_entry(&typed(1, EDITOR, TASK, 45)).await?);
    repo.start_timer(&user(EDITOR), &timer(0x71, OTHER_TASK, at(9, 0)), None)
        .await?;

    sqlx::query!(r#"DELETE FROM "User" WHERE id = $1"#, EDITOR)
        .execute(&pool)
        .await?;

    assert!(repo.entry(Uuid::from_u128(1)).await?.is_some());
    assert_eq!(repo.timer(&user(EDITOR)).await?, None);
    assert_eq!(stored_total(&pool, TASK).await, 45);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_tracking"))
)]
async fn the_table_refuses_entries_no_rule_allows(pool: PgPool) -> anyhow::Result<()> {
    let insert = |minutes: i32,
                  started_at: Option<DateTime<Utc>>,
                  ended_at: Option<DateTime<Utc>>| {
        let pool = pool.clone();
        async move {
            sqlx::query!(
                r#"
                INSERT INTO time_entry (id, task_id, user_id, entry_date, minutes, started_at, ended_at, source)
                VALUES ($1, $2, $3, '2026-11-20', $4, $5, $6, 'manual')
                "#,
                Uuid::now_v7(),
                TASK,
                AUTHOR,
                minutes,
                started_at,
                ended_at,
            )
            .execute(&pool)
            .await
        }
    };

    assert!(insert(0, None, None).await.is_err());
    assert!(insert(30, Some(at(9, 0)), None).await.is_err());
    assert!(insert(30, Some(at(9, 0)), Some(at(9, 0))).await.is_err());
    assert!(
        insert(30, Some(at(9, 0)), Some(at(9, 0) + TimeDelta::minutes(30)))
            .await
            .is_ok()
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_tracking"))
)]
async fn a_write_behind_a_held_task_lock_gives_up_as_contended(pool: PgPool) -> anyhow::Result<()> {
    let repo = PgTimeTrackingRepository::new(pool.clone());
    let mut holder = pool.begin().await?;
    sqlx::query!(
        "SELECT pg_advisory_xact_lock(hashtextextended('time_entry:' || $1, 0))",
        TASK,
    )
    .execute(&mut *holder)
    .await?;

    let error = repo
        .insert_entry(&typed(1, AUTHOR, TASK, 45))
        .await
        .unwrap_err();
    holder.rollback().await?;

    assert!(error.is_contended(), "{error}");
    assert_eq!(repo.entry(Uuid::from_u128(1)).await?, None);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_tracking"))
)]
async fn a_timer_cannot_take_another_persons_running_timer_id(pool: PgPool) -> anyhow::Result<()> {
    let repo = PgTimeTrackingRepository::new(pool.clone());
    let authors = timer(0x71, TASK, at(9, 0));
    repo.start_timer(&user(AUTHOR), &authors, None).await?;

    let copied = repo
        .start_timer(&user(EDITOR), &timer(0x71, OTHER_TASK, at(9, 5)), None)
        .await?;

    assert_eq!(copied, StartTimerOutcome::IdTaken);
    assert_eq!(repo.timer(&user(EDITOR)).await?, None);
    assert_eq!(repo.timer(&user(AUTHOR)).await?, Some(authors));
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_tracking"))
)]
async fn a_stop_never_returns_another_persons_entry(pool: PgPool) -> anyhow::Result<()> {
    let repo = PgTimeTrackingRepository::new(pool.clone());
    let authors = timer(0x71, TASK, at(9, 0));
    repo.start_timer(&user(AUTHOR), &authors, None).await?;
    repo.stop_timer(&timer_entry(&authors, AUTHOR, at(9, 30)))
        .await?;
    // A running timer whose id is already the author's entry, as a client
    // reusing that id could leave one.
    sqlx::query!(
        "INSERT INTO time_timer (user_id, id, task_id, started_at) VALUES ($1, $2, $3, $4)",
        EDITOR,
        authors.id,
        OTHER_TASK,
        at(9, 10),
    )
    .execute(&pool)
    .await?;
    let editors = timer(0x71, OTHER_TASK, at(9, 10));

    let stopped = repo
        .stop_timer(&timer_entry(&editors, EDITOR, at(9, 40)))
        .await?;

    assert_eq!(stopped, StopTimerOutcome::IdTaken);
    assert_eq!(repo.timer(&user(EDITOR)).await?, Some(editors));
    assert_eq!(
        repo.entry(authors.id).await?.map(|entry| entry.user_id),
        Some(user(AUTHOR))
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("time_tracking"))
)]
async fn two_people_starting_one_timer_id_at_once_get_one_timer(
    pool: PgPool,
) -> anyhow::Result<()> {
    let (late, checked, release) = paused(pool.clone(), Checkpoint::TimerIdChecked);
    let late_start = tokio::spawn(async move {
        late.start_timer(&user(AUTHOR), &timer(0x71, TASK, at(9, 0)), None)
            .await
    });
    checked.await?;

    let first = PgTimeTrackingRepository::new(pool.clone())
        .start_timer(&user(EDITOR), &timer(0x71, OTHER_TASK, at(9, 0)), None)
        .await?;
    release.send(()).unwrap();
    let late = late_start.await??;

    assert_eq!(first, StartTimerOutcome::Started(None));
    assert_eq!(late, StartTimerOutcome::IdTaken);
    let repo = PgTimeTrackingRepository::new(pool.clone());
    assert_eq!(repo.timer(&user(AUTHOR)).await?, None);
    assert_eq!(
        repo.timer(&user(EDITOR)).await?.map(|timer| timer.task_id),
        Some(OTHER_TASK.to_string())
    );
    Ok(())
}
