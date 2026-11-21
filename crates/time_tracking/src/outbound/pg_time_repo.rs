//! Postgres storage for time entries and timers.
//!
//! Every statement that adds, changes or removes an entry runs after
//! `pg_advisory_xact_lock` on the entry's task, and the same transaction then
//! rewrites the task's Time logged from the sum of its entries. Without the
//! lock, two writers on one task each sum before the other commits and the
//! later commit stores a total that misses the other's entry.
//!
//! A person's timer is the `time_timer` row keyed by their id. Starting and
//! stopping delete the exact timer the domain read (by id), so a timer another
//! device changed in between is never stopped twice or replaced unseen.
//!
//! Write transactions wait at most five seconds for a lock, so a queue of
//! writers on one task gives connections back instead of holding them.

#[cfg(test)]
mod test;

use chrono::{DateTime, NaiveDate, Utc};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::{PgPool, Postgres, Transaction};
use system_properties::time_logged;
use uuid::Uuid;

use crate::domain::{
    models::{
        EntryValues, LoggedTime, NewEntryRow, RunningTimer, TimeEntry, TimeEntryCursor,
        TimeEntrySource,
    },
    ports::{
        DeleteEntryOutcome, InsertEntryOutcome, RepositoryError, StartTimerOutcome,
        StopTimerOutcome, TimeTrackingRepository, UpdateEntryOutcome,
    },
};

/// Postgres's `lock_not_available`, raised when a lock wait passes `lock_timeout`.
const LOCK_NOT_AVAILABLE: &str = "55P03";

/// The constraint keeping running timer ids unique across people.
const RUNNING_TIMER_ID_KEY: &str = "time_timer_id_key";

/// Points in a write where tests hold one writer to race another against it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Checkpoint {
    /// A task's sum is read and not yet stored as Time logged.
    TotalSummed,
    /// A new timer's id was checked and the timer is not yet inserted.
    TimerIdChecked,
}

/// Errors from the Postgres time tracking repository.
#[derive(Debug, thiserror::Error)]
pub enum PgTimeTrackingError {
    /// A query failed.
    #[error("time tracking query failed: {0}")]
    Database(sqlx::Error),
    /// A lock wait passed the transaction's `lock_timeout`.
    #[error("gave up waiting for a lock: {0}")]
    Contended(sqlx::Error),
    /// Reading or writing the task's Time logged failed.
    #[error("time logged total failed: {0}")]
    Total(#[from] system_properties::SystemPropertyError),
    /// A stored row breaks the domain's types.
    #[error("invalid stored time entry: {0}")]
    InvalidRow(String),
}

fn violates(error: &sqlx::Error, constraint: &str) -> bool {
    error
        .as_database_error()
        .and_then(|database| database.constraint())
        .is_some_and(|name| name == constraint)
}

fn is_lock_timeout(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .and_then(|database| database.code())
        .is_some_and(|code| code == LOCK_NOT_AVAILABLE)
}

impl From<sqlx::Error> for PgTimeTrackingError {
    fn from(error: sqlx::Error) -> Self {
        if is_lock_timeout(&error) {
            return Self::Contended(error);
        }
        Self::Database(error)
    }
}

impl RepositoryError for PgTimeTrackingError {
    fn is_contended(&self) -> bool {
        match self {
            Self::Contended(_) => true,
            Self::Total(system_properties::SystemPropertyError::Database(report)) => report
                .downcast_current_context::<sqlx::Error>()
                .is_some_and(is_lock_timeout),
            Self::Database(_) | Self::Total(_) | Self::InvalidRow(_) => false,
        }
    }
}

/// Postgres implementation of [`TimeTrackingRepository`].
#[derive(Clone)]
pub struct PgTimeTrackingRepository {
    pool: PgPool,
    #[cfg(test)]
    pause: Option<std::sync::Arc<test::Pause>>,
}

impl PgTimeTrackingRepository {
    /// A repository over the primary pool: entry lists right after a write
    /// must see it.
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            #[cfg(test)]
            pause: None,
        }
    }

    /// A write transaction whose lock waits end after five seconds.
    async fn begin(&self) -> Result<Transaction<'static, Postgres>, PgTimeTrackingError> {
        let mut tx = self.pool.begin().await?;
        sqlx::query!("SET LOCAL lock_timeout = '5s'")
            .execute(&mut *tx)
            .await?;
        Ok(tx)
    }

    async fn reached(&self, checkpoint: Checkpoint) {
        #[cfg(test)]
        if let Some(pause) = &self.pause {
            pause.wait(checkpoint).await;
        }
        #[cfg(not(test))]
        let _ = checkpoint;
    }

    /// Rewrite the task's Time logged from the sum of its entries.
    #[tracing::instrument(
        name = "time.write_total",
        skip(self, tx),
        fields(total_minutes = tracing::field::Empty),
        err
    )]
    async fn rewrite_total(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        task_id: &str,
    ) -> Result<u32, PgTimeTrackingError> {
        let total = sqlx::query_scalar!(
            r#"
            SELECT COALESCE(sum(minutes), 0)::bigint AS "total!"
            FROM time_entry
            WHERE task_id = $1
            "#,
            task_id,
        )
        .fetch_one(&mut **tx)
        .await?;
        let total = u32::try_from(total).map_err(|_| {
            PgTimeTrackingError::InvalidRow(format!("task {task_id} total {total}"))
        })?;

        self.reached(Checkpoint::TotalSummed).await;
        time_logged::write_task_time_logged(tx, task_id, total).await?;
        tracing::Span::current().record("total_minutes", i64::from(total));
        Ok(total)
    }
}

struct EntryRow {
    id: Uuid,
    task_id: String,
    user_id: String,
    entry_date: NaiveDate,
    minutes: i32,
    note: Option<String>,
    started_at: Option<DateTime<Utc>>,
    ended_at: Option<DateTime<Utc>>,
    source: TimeEntrySource,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl TryFrom<EntryRow> for TimeEntry {
    type Error = PgTimeTrackingError;

    fn try_from(row: EntryRow) -> Result<Self, Self::Error> {
        let user_id = MacroUserIdStr::parse_from_str(&row.user_id)
            .map_err(|_| PgTimeTrackingError::InvalidRow(format!("entry {} user id", row.id)))?
            .into_owned();
        let minutes = u16::try_from(row.minutes)
            .map_err(|_| PgTimeTrackingError::InvalidRow(format!("entry {} minutes", row.id)))?;
        Ok(TimeEntry {
            id: row.id,
            task_id: row.task_id,
            user_id,
            date: row.entry_date,
            minutes,
            note: row.note,
            started_at: row.started_at,
            ended_at: row.ended_at,
            source: row.source,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }
}

fn entries_from(rows: Vec<EntryRow>) -> Result<Vec<TimeEntry>, PgTimeTrackingError> {
    rows.into_iter().map(TimeEntry::try_from).collect()
}

/// Whether the document is a task, still out of the Trash.
#[tracing::instrument(name = "time.live_task", skip(tx), err)]
async fn is_live_task(
    tx: &mut Transaction<'_, Postgres>,
    task_id: &str,
) -> Result<bool, PgTimeTrackingError> {
    let live = sqlx::query_scalar!(
        r#"
        SELECT EXISTS (
            SELECT 1
            FROM "Document" d
            JOIN document_sub_type s ON s.document_id = d.id
            WHERE d.id = $1
              AND s.sub_type = 'task'
              AND d."deletedAt" IS NULL
        ) AS "live!"
        "#,
        task_id,
    )
    .fetch_one(&mut **tx)
    .await?;
    Ok(live)
}

/// Wait for and hold the task's lock until the transaction ends.
#[tracing::instrument(name = "time.task_lock", skip(tx), err)]
async fn lock_task(
    tx: &mut Transaction<'_, Postgres>,
    task_id: &str,
) -> Result<(), PgTimeTrackingError> {
    sqlx::query!(
        "SELECT pg_advisory_xact_lock(hashtextextended('time_entry:' || $1, 0))",
        task_id,
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn entry_by_id<'e, E: sqlx::PgExecutor<'e>>(
    executor: E,
    id: Uuid,
) -> Result<Option<TimeEntry>, PgTimeTrackingError> {
    sqlx::query_as!(
        EntryRow,
        r#"
        SELECT id, task_id, user_id, entry_date, minutes, note, started_at, ended_at,
               source AS "source: TimeEntrySource", created_at, updated_at
        FROM time_entry
        WHERE id = $1
        "#,
        id,
    )
    .fetch_optional(executor)
    .await?
    .map(TimeEntry::try_from)
    .transpose()
}

/// Insert the row unless its id exists; `None` when it did.
async fn insert_row(
    tx: &mut Transaction<'_, Postgres>,
    row: &NewEntryRow,
) -> Result<Option<TimeEntry>, PgTimeTrackingError> {
    let values = &row.values;
    sqlx::query_as!(
        EntryRow,
        r#"
        INSERT INTO time_entry (id, task_id, user_id, entry_date, minutes, note, started_at, ended_at, source)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO NOTHING
        RETURNING id, task_id, user_id, entry_date, minutes, note, started_at, ended_at,
                  source AS "source: TimeEntrySource", created_at, updated_at
        "#,
        row.id,
        row.task_id,
        row.user_id.as_ref(),
        values.date,
        i32::from(values.minutes),
        values.note,
        values.span.map(|span| span.started_at),
        values.span.map(|span| span.ended_at),
        row.source as TimeEntrySource,
    )
    .fetch_optional(&mut **tx)
    .await?
    .map(TimeEntry::try_from)
    .transpose()
}

impl PgTimeTrackingRepository {
    /// Store a stopped timer's entry under its task's lock and rewrite the
    /// total. `None` when another entry already has the timer's id: the
    /// caller rolls back, so the timer keeps running and nothing is revealed.
    async fn store_timer_entry(
        &self,
        tx: &mut Transaction<'_, Postgres>,
        row: &NewEntryRow,
    ) -> Result<Option<LoggedTime>, PgTimeTrackingError> {
        lock_task(tx, &row.task_id).await?;
        let entry = match insert_row(tx, row).await? {
            Some(entry) => entry,
            None => {
                let existing = entry_by_id(&mut **tx, row.id).await?;
                match existing {
                    Some(entry)
                        if entry.user_id == row.user_id
                            && entry.task_id == row.task_id
                            && entry.source == TimeEntrySource::Timer =>
                    {
                        entry
                    }
                    Some(_) | None => return Ok(None),
                }
            }
        };
        let total_minutes = self.rewrite_total(tx, &row.task_id).await?;
        Ok(Some(LoggedTime {
            entry,
            total_minutes,
        }))
    }
}

impl TimeTrackingRepository for PgTimeTrackingRepository {
    type Err = PgTimeTrackingError;

    #[tracing::instrument(name = "time.read_entries", skip(self), err)]
    async fn entries(
        &self,
        task_id: &str,
        limit: u16,
        after: Option<TimeEntryCursor>,
    ) -> Result<Vec<TimeEntry>, Self::Err> {
        let limit = i64::from(limit);
        let rows = match after {
            None => {
                sqlx::query_as!(
                    EntryRow,
                    r#"
                    SELECT id, task_id, user_id, entry_date, minutes, note, started_at, ended_at,
                           source AS "source: TimeEntrySource", created_at, updated_at
                    FROM time_entry
                    WHERE task_id = $1
                    ORDER BY entry_date DESC, id DESC
                    LIMIT $2
                    "#,
                    task_id,
                    limit,
                )
                .fetch_all(&self.pool)
                .await?
            }
            Some(cursor) => {
                sqlx::query_as!(
                    EntryRow,
                    r#"
                    SELECT id, task_id, user_id, entry_date, minutes, note, started_at, ended_at,
                           source AS "source: TimeEntrySource", created_at, updated_at
                    FROM time_entry
                    WHERE task_id = $1
                      AND (entry_date, id) < ($2, $3)
                    ORDER BY entry_date DESC, id DESC
                    LIMIT $4
                    "#,
                    task_id,
                    cursor.date,
                    cursor.id,
                    limit,
                )
                .fetch_all(&self.pool)
                .await?
            }
        };
        entries_from(rows)
    }

    async fn task_total(&self, task_id: &str) -> Result<u32, Self::Err> {
        Ok(time_logged::read_task_time_logged(&self.pool, task_id).await?)
    }

    #[tracing::instrument(name = "time.read_entry", skip(self), err)]
    async fn entry(&self, id: Uuid) -> Result<Option<TimeEntry>, Self::Err> {
        entry_by_id(&self.pool, id).await
    }

    #[tracing::instrument(name = "time.insert_entry", skip_all, fields(task_id = %row.task_id, entry_id = %row.id), err)]
    async fn insert_entry(&self, row: &NewEntryRow) -> Result<InsertEntryOutcome, Self::Err> {
        let mut tx = self.begin().await?;
        if !is_live_task(&mut tx, &row.task_id).await? {
            return Ok(InsertEntryOutcome::TaskUnavailable);
        }

        lock_task(&mut tx, &row.task_id).await?;
        let Some(entry) = insert_row(&mut tx, row).await? else {
            let stored = entry_by_id(&mut *tx, row.id).await?.ok_or_else(|| {
                PgTimeTrackingError::InvalidRow(format!("entry {} vanished", row.id))
            })?;
            return Ok(InsertEntryOutcome::Existing(stored));
        };
        let total_minutes = self.rewrite_total(&mut tx, &row.task_id).await?;
        tx.commit().await?;

        Ok(InsertEntryOutcome::Inserted(LoggedTime {
            entry,
            total_minutes,
        }))
    }

    #[tracing::instrument(name = "time.update_entry_row", skip(self, user_id, values), err)]
    async fn update_entry(
        &self,
        id: Uuid,
        user_id: &MacroUserIdStr<'_>,
        values: &EntryValues,
        read_updated_at: DateTime<Utc>,
    ) -> Result<UpdateEntryOutcome, Self::Err> {
        let mut tx = self.begin().await?;
        let Some(task_id) = sqlx::query_scalar!(
            "SELECT task_id FROM time_entry WHERE id = $1 AND user_id = $2",
            id,
            user_id.as_ref(),
        )
        .fetch_optional(&mut *tx)
        .await?
        else {
            return Ok(UpdateEntryOutcome::EntryMissing);
        };
        if !is_live_task(&mut tx, &task_id).await? {
            return Ok(UpdateEntryOutcome::TaskUnavailable);
        }

        // Every write of this entry holds the task's lock, so under it the
        // entry is as the last writer left it: unchanged since the caller's
        // read, changed (the caller merges again), or gone.
        lock_task(&mut tx, &task_id).await?;
        let updated = sqlx::query_as!(
            EntryRow,
            r#"
            UPDATE time_entry
            SET entry_date = $3, minutes = $4, note = $5, started_at = $6, ended_at = $7,
                updated_at = now()
            WHERE id = $1 AND user_id = $2 AND updated_at = $8
            RETURNING id, task_id, user_id, entry_date, minutes, note, started_at, ended_at,
                      source AS "source: TimeEntrySource", created_at, updated_at
            "#,
            id,
            user_id.as_ref(),
            values.date,
            i32::from(values.minutes),
            values.note,
            values.span.map(|span| span.started_at),
            values.span.map(|span| span.ended_at),
            read_updated_at,
        )
        .fetch_optional(&mut *tx)
        .await?;
        let Some(updated) = updated else {
            let still_there = sqlx::query_scalar!(
                "SELECT task_id FROM time_entry WHERE id = $1 AND user_id = $2",
                id,
                user_id.as_ref(),
            )
            .fetch_optional(&mut *tx)
            .await?;
            return Ok(match still_there {
                Some(_) => UpdateEntryOutcome::Changed,
                None => UpdateEntryOutcome::EntryMissing,
            });
        };
        let entry = TimeEntry::try_from(updated)?;
        let total_minutes = self.rewrite_total(&mut tx, &task_id).await?;
        tx.commit().await?;

        Ok(UpdateEntryOutcome::Written(LoggedTime {
            entry,
            total_minutes,
        }))
    }

    #[tracing::instrument(name = "time.delete_entry_row", skip(self, user_id), err)]
    async fn delete_entry(
        &self,
        id: Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<DeleteEntryOutcome, Self::Err> {
        let mut tx = self.begin().await?;
        let Some(task_id) = sqlx::query_scalar!(
            "SELECT task_id FROM time_entry WHERE id = $1 AND user_id = $2",
            id,
            user_id.as_ref(),
        )
        .fetch_optional(&mut *tx)
        .await?
        else {
            return Ok(DeleteEntryOutcome::EntryMissing);
        };
        if !is_live_task(&mut tx, &task_id).await? {
            return Ok(DeleteEntryOutcome::TaskUnavailable);
        }

        lock_task(&mut tx, &task_id).await?;
        let deleted = sqlx::query!(
            "DELETE FROM time_entry WHERE id = $1 AND user_id = $2",
            id,
            user_id.as_ref(),
        )
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if deleted == 0 {
            return Ok(DeleteEntryOutcome::EntryMissing);
        }
        let total_minutes = self.rewrite_total(&mut tx, &task_id).await?;
        tx.commit().await?;

        Ok(DeleteEntryOutcome::Deleted(total_minutes))
    }

    #[tracing::instrument(name = "time.read_timer_row", skip_all, err)]
    async fn timer(&self, user_id: &MacroUserIdStr<'_>) -> Result<Option<RunningTimer>, Self::Err> {
        Ok(sqlx::query_as!(
            RunningTimer,
            "SELECT id, task_id, started_at FROM time_timer WHERE user_id = $1",
            user_id.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?)
    }

    #[tracing::instrument(
        name = "time.start_timer_rows",
        skip_all,
        fields(task_id = %timer.task_id, timer_id = %timer.id, previous_timer_id = ?previous.map(|row| row.id)),
        err
    )]
    async fn start_timer(
        &self,
        user_id: &MacroUserIdStr<'_>,
        timer: &RunningTimer,
        previous: Option<&NewEntryRow>,
    ) -> Result<StartTimerOutcome, Self::Err> {
        let mut tx = self.begin().await?;
        if !is_live_task(&mut tx, &timer.task_id).await? {
            return Ok(StartTimerOutcome::TaskUnavailable);
        }
        let stopped = match previous {
            None => None,
            Some(previous) => {
                let removed = sqlx::query!(
                    "DELETE FROM time_timer WHERE user_id = $1 AND id = $2",
                    user_id.as_ref(),
                    previous.id,
                )
                .execute(&mut *tx)
                .await?
                .rows_affected();
                if removed == 0 {
                    return Ok(StartTimerOutcome::TimerChanged);
                }
                let Some(stopped) = self.store_timer_entry(&mut tx, previous).await? else {
                    return Ok(StartTimerOutcome::IdTaken);
                };
                Some(stopped)
            }
        };

        let running_elsewhere = sqlx::query_scalar!(
            r#"SELECT EXISTS (SELECT 1 FROM time_timer WHERE id = $1 AND user_id <> $2) AS "taken!""#,
            timer.id,
            user_id.as_ref(),
        )
        .fetch_one(&mut *tx)
        .await?;
        if running_elsewhere {
            return Ok(StartTimerOutcome::IdTaken);
        }
        self.reached(Checkpoint::TimerIdChecked).await;

        // A timer another device started meanwhile holds the person's row;
        // another person's start of the same id since the check hits the
        // id's unique constraint instead.
        let insert = sqlx::query!(
            r#"
            INSERT INTO time_timer (user_id, id, task_id, started_at)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id) DO NOTHING
            "#,
            user_id.as_ref(),
            timer.id,
            timer.task_id,
            timer.started_at,
        )
        .execute(&mut *tx)
        .await;
        let inserted = match insert {
            Ok(result) => result.rows_affected(),
            Err(error) if violates(&error, RUNNING_TIMER_ID_KEY) => {
                return Ok(StartTimerOutcome::IdTaken);
            }
            Err(error) => return Err(error.into()),
        };
        if inserted == 0 {
            return Ok(StartTimerOutcome::TimerChanged);
        }

        // Checked after the insert, which holds the person's timer row: a stop
        // of this id that committed before it is visible here, and one that
        // has not committed yet cannot remove a row it does not see.
        let id_taken = sqlx::query_scalar!(
            r#"SELECT EXISTS (SELECT 1 FROM time_entry WHERE id = $1) AS "taken!""#,
            timer.id,
        )
        .fetch_one(&mut *tx)
        .await?;
        if id_taken {
            return Ok(StartTimerOutcome::IdTaken);
        }
        tx.commit().await?;

        Ok(StartTimerOutcome::Started(stopped))
    }

    #[tracing::instrument(
        name = "time.stop_timer_rows",
        skip_all,
        fields(task_id = %row.task_id, timer_id = %row.id),
        err
    )]
    async fn stop_timer(&self, row: &NewEntryRow) -> Result<StopTimerOutcome, Self::Err> {
        let mut tx = self.begin().await?;
        let removed = sqlx::query!(
            "DELETE FROM time_timer WHERE user_id = $1 AND id = $2",
            row.user_id.as_ref(),
            row.id,
        )
        .execute(&mut *tx)
        .await?
        .rows_affected();
        if removed == 0 {
            return Ok(StopTimerOutcome::TimerGone);
        }

        let Some(logged) = self.store_timer_entry(&mut tx, row).await? else {
            return Ok(StopTimerOutcome::IdTaken);
        };
        tx.commit().await?;
        Ok(StopTimerOutcome::Stopped(logged))
    }

    #[tracing::instrument(name = "time.discard_timer_row", skip(self, user_id), err)]
    async fn discard_timer(
        &self,
        user_id: &MacroUserIdStr<'_>,
        timer_id: Uuid,
    ) -> Result<(), Self::Err> {
        let mut tx = self.begin().await?;
        sqlx::query!(
            "DELETE FROM time_timer WHERE user_id = $1 AND id = $2",
            user_id.as_ref(),
            timer_id,
        )
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(())
    }
}
