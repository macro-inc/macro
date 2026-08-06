//! PostgreSQL implementation of the [`RemindersRepo`] port.

#[cfg(test)]
mod test;

use std::str::FromStr;

use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{
    DueReminder, InvalidCron, NewReminder, Reminder, ReminderBatch, ReminderCron, ReminderCursor,
    ReminderFilter, ReminderSchedule, ReminderUpdate,
};
use crate::domain::ports::{ReminderDispatchRepo, RemindersRepo};

/// Postgres-backed reminders repository.
#[derive(Debug, Clone)]
pub struct PgRemindersRepo {
    pool: PgPool,
}

impl PgRemindersRepo {
    /// Create a repository backed by the provided pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// Errors produced by the Postgres reminders repository.
#[derive(Debug, thiserror::Error)]
pub enum RemindersRepoErr {
    /// Underlying database error.
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    /// A stored entity type could not be parsed into [EntityType].
    #[error("invalid entity type {value:?} stored for reminder {reminder_id}")]
    InvalidEntityType {
        /// The reminder carrying the bad value.
        reminder_id: Uuid,
        /// The value that could not be parsed.
        value: String,
    },
    /// A stored timezone is not a known IANA zone.
    #[error("invalid timezone stored for reminder {0}: {1}")]
    InvalidTimezone(Uuid, String),
    /// A stored cron expression no longer parses.
    #[error("invalid cron stored for reminder {0}: {1}")]
    InvalidCron(Uuid, #[source] InvalidCron),
    /// Neither schedule mode is populated, which the table's CHECK constraint
    /// should make impossible.
    #[error("reminder {0} has no schedule")]
    MissingSchedule(Uuid),
    /// A stored owner is not a parseable macro user id.
    #[error("invalid user id {value:?} stored for reminder {reminder_id}")]
    InvalidUserId {
        /// The reminder carrying the bad value.
        reminder_id: Uuid,
        /// The value that could not be parsed.
        value: String,
    },
}

/// A `reminder` row, before the schedule columns are folded into a
/// [`ReminderSchedule`].
struct ReminderRow {
    id: Uuid,
    description: String,
    entity_type: Option<String>,
    entity_id: Option<String>,
    remind_at: Option<DateTime<Utc>>,
    cron: Option<String>,
    timezone: Option<String>,
    next_run_at: DateTime<Utc>,
    enabled: bool,
    completed_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl ReminderRow {
    /// This row's position in the list ordering, readable or not.
    fn position(&self) -> ReminderCursor {
        ReminderCursor {
            next_run_at: self.next_run_at,
            created_at: self.created_at,
            id: self.id,
        }
    }

    fn into_reminder(self) -> Result<Reminder, RemindersRepoErr> {
        let id = self.id;
        let entity_type = self
            .entity_type
            .map(|raw| {
                raw.parse::<EntityType>()
                    .map_err(|_| RemindersRepoErr::InvalidEntityType {
                        reminder_id: id,
                        value: raw,
                    })
            })
            .transpose()?;

        let schedule = match (self.remind_at, self.cron, self.timezone) {
            (Some(remind_at), _, _) => ReminderSchedule::Once { remind_at },
            (None, Some(cron), Some(timezone)) => ReminderSchedule::Recurring {
                cron: ReminderCron::parse(cron)
                    .map_err(|e| RemindersRepoErr::InvalidCron(self.id, e))?,
                timezone: Tz::from_str(&timezone)
                    .map_err(|_| RemindersRepoErr::InvalidTimezone(self.id, timezone))?,
            },
            _ => return Err(RemindersRepoErr::MissingSchedule(self.id)),
        };

        Ok(Reminder {
            id: self.id,
            description: self.description,
            entity_type,
            entity_id: self.entity_id,
            schedule,
            next_run_at: self.next_run_at,
            enabled: self.enabled,
            completed_at: self.completed_at,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

/// A `reminder` row read by the dispatcher, which unlike every other read is
/// not scoped to one user and so has to carry the owner.
struct DueReminderRow {
    id: Uuid,
    user_id: String,
    description: String,
    entity_type: Option<String>,
    entity_id: Option<String>,
    remind_at: Option<DateTime<Utc>>,
    cron: Option<String>,
    timezone: Option<String>,
    next_run_at: DateTime<Utc>,
    enabled: bool,
    completed_at: Option<DateTime<Utc>>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl DueReminderRow {
    fn into_due(self) -> Result<DueReminder, RemindersRepoErr> {
        let reminder_id = self.id;
        let owner_id = match MacroUserIdStr::parse_from_str(&self.user_id) {
            Ok(owner_id) => owner_id.into_owned(),
            Err(_) => {
                return Err(RemindersRepoErr::InvalidUserId {
                    reminder_id,
                    value: self.user_id,
                });
            }
        };

        // The firing being delivered is the reminder's current `next_run_at`,
        // which is also what keys the occurrence row.
        let scheduled_for = self.next_run_at;

        let reminder = ReminderRow {
            id: self.id,
            description: self.description,
            entity_type: self.entity_type,
            entity_id: self.entity_id,
            remind_at: self.remind_at,
            cron: self.cron,
            timezone: self.timezone,
            next_run_at: self.next_run_at,
            enabled: self.enabled,
            completed_at: self.completed_at,
            created_at: self.created_at,
            updated_at: self.updated_at,
        }
        .into_reminder()?;

        Ok(DueReminder {
            reminder,
            owner_id,
            scheduled_for,
        })
    }
}

/// The schedule as it is stored: `(remind_at, cron, timezone)`, with exactly
/// one mode populated.
fn schedule_columns(
    schedule: &ReminderSchedule,
) -> (Option<DateTime<Utc>>, Option<&str>, Option<String>) {
    match schedule {
        ReminderSchedule::Once { remind_at } => (Some(*remind_at), None, None),
        ReminderSchedule::Recurring { cron, timezone } => {
            (None, Some(cron.as_str()), Some(timezone.name().to_string()))
        }
    }
}

impl RemindersRepo for PgRemindersRepo {
    type Err = RemindersRepoErr;

    #[tracing::instrument(err, skip(self))]
    async fn create_reminder(
        &self,
        user_id: &MacroUserIdStr<'_>,
        new: &NewReminder,
    ) -> Result<Reminder, Self::Err> {
        let entity_type: Option<&str> = new.entity.as_ref().map(|entity| entity.entity_type.into());
        let entity_id: Option<&str> = new.entity.as_ref().map(|entity| entity.entity_id.as_ref());
        let (remind_at, cron, timezone) = schedule_columns(&new.schedule);
        // Time-ordered v7 so ids sort by creation, and so the id is known before
        // the insert rather than assigned by the database.
        let id = macro_uuid::generate_uuid_v7();

        let row = sqlx::query_as!(
            ReminderRow,
            r#"
            INSERT INTO reminder (
                id, user_id, description, entity_type, entity_id,
                remind_at, cron, timezone, next_run_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING
                id,
                description,
                entity_type,
                entity_id,
                remind_at,
                cron,
                timezone,
                next_run_at,
                enabled,
                completed_at,
                created_at,
                updated_at
            "#,
            id,
            user_id.as_ref(),
            new.description,
            entity_type,
            entity_id,
            remind_at,
            cron,
            timezone,
            new.next_run_at,
        )
        .fetch_one(&self.pool)
        .await?;

        row.into_reminder()
    }

    #[tracing::instrument(err, skip(self))]
    async fn get_reminder(
        &self,
        user_id: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> Result<Option<Reminder>, Self::Err> {
        let row = sqlx::query_as!(
            ReminderRow,
            r#"
            SELECT
                id,
                description,
                entity_type,
                entity_id,
                remind_at,
                cron,
                timezone,
                next_run_at,
                enabled,
                completed_at,
                created_at,
                updated_at
            FROM reminder
            WHERE id = $1 AND user_id = $2
            "#,
            id,
            user_id.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?;

        row.map(ReminderRow::into_reminder).transpose()
    }

    #[tracing::instrument(err, skip(self))]
    async fn list_reminders(
        &self,
        user_id: &MacroUserIdStr<'_>,
        filter: &ReminderFilter,
        limit: i64,
    ) -> Result<ReminderBatch, Self::Err> {
        let entity_type: Option<&str> = filter
            .entity
            .as_ref()
            .map(|entity| entity.entity_type.into());
        let entity_id: Option<&str> = filter
            .entity
            .as_ref()
            .map(|entity| entity.entity_id.as_ref());
        let (cursor_next_run_at, cursor_created_at, cursor_id) = match filter.cursor {
            Some(cursor) => (
                Some(cursor.next_run_at),
                Some(cursor.created_at),
                Some(cursor.id),
            ),
            None => (None, None, None),
        };

        let rows = sqlx::query_as!(
            ReminderRow,
            r#"
            SELECT
                id,
                description,
                entity_type,
                entity_id,
                remind_at,
                cron,
                timezone,
                next_run_at,
                enabled,
                completed_at,
                created_at,
                updated_at
            FROM reminder
            WHERE user_id = $1
              AND ($2::text IS NULL OR entity_type = $2)
              AND ($3::text IS NULL OR entity_id = $3)
              AND ($4::bool OR completed_at IS NULL)
              -- Keyset: resume strictly after the cursor position in the same
              -- (next_run_at, created_at, id) order the query returns.
              AND (
                  $5::timestamptz IS NULL
                  OR (next_run_at, created_at, id) > ($5::timestamptz, $6::timestamptz, $7::uuid)
              )
            ORDER BY next_run_at ASC, created_at ASC, id ASC
            LIMIT $8
            "#,
            user_id.as_ref(),
            entity_type,
            entity_id,
            filter.include_completed,
            cursor_next_run_at,
            cursor_created_at,
            cursor_id,
            limit,
        )
        .fetch_all(&self.pool)
        .await?;

        // A row whose stored entity_type or cron no longer parses is skipped
        // rather than failing the page: one unreadable row should not make the
        // caller's whole list unavailable. Single-reminder reads still error.
        //
        // Skipped rows are counted and the last position read is reported, so
        // the domain can still tell whether more rows exist and can advance the
        // cursor past them.
        let last_examined = rows.last().map(ReminderRow::position);
        let mut batch = ReminderBatch {
            reminders: Vec::with_capacity(rows.len()),
            skipped: 0,
            last_examined,
        };
        for row in rows {
            match row.into_reminder() {
                Ok(reminder) => batch.reminders.push(reminder),
                Err(e) => {
                    tracing::error!(error=?e, "skipping unreadable reminder");
                    batch.skipped += 1;
                }
            }
        }

        Ok(batch)
    }

    #[tracing::instrument(err, skip(self))]
    async fn update_reminder(
        &self,
        user_id: &MacroUserIdStr<'_>,
        id: Uuid,
        update: &ReminderUpdate,
    ) -> Result<Option<Reminder>, Self::Err> {
        // The schedule columns are rewritten as a set, so switching modes can
        // NULL the columns the other mode uses — which `COALESCE` cannot do.
        // Rescheduling also clears `completed_at`: a reminder given a new future
        // firing is live again, and leaving the stamp set would hide it from
        // list results and from the dispatcher's due query.
        let schedule_provided = update.schedule.is_some();
        let (remind_at, cron, timezone) = update
            .schedule
            .as_ref()
            .map(|schedule| schedule_columns(&schedule.schedule))
            .unwrap_or((None, None, None));
        let next_run_at = update
            .schedule
            .as_ref()
            .map(|schedule| schedule.next_run_at);

        let row = sqlx::query_as!(
            ReminderRow,
            r#"
            UPDATE reminder
            SET description = COALESCE($3::text, description),
                remind_at   = CASE WHEN $4::bool THEN $5::timestamptz ELSE remind_at END,
                cron        = CASE WHEN $4::bool THEN $6::text ELSE cron END,
                timezone    = CASE WHEN $4::bool THEN $7::text ELSE timezone END,
                next_run_at = COALESCE($8::timestamptz, next_run_at),
                enabled     = COALESCE($9::bool, enabled),
                completed_at = CASE WHEN $4::bool THEN NULL ELSE completed_at END,
                updated_at  = now()
            WHERE id = $1 AND user_id = $2
            RETURNING
                id,
                description,
                entity_type,
                entity_id,
                remind_at,
                cron,
                timezone,
                next_run_at,
                enabled,
                completed_at,
                created_at,
                updated_at
            "#,
            id,
            user_id.as_ref(),
            update.description,
            schedule_provided,
            remind_at,
            cron,
            timezone,
            next_run_at,
            update.enabled,
        )
        .fetch_optional(&self.pool)
        .await?;

        row.map(ReminderRow::into_reminder).transpose()
    }

    #[tracing::instrument(err, skip(self))]
    async fn delete_reminder(
        &self,
        user_id: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> Result<bool, Self::Err> {
        let result = sqlx::query!(
            r#"DELETE FROM reminder WHERE id = $1 AND user_id = $2"#,
            id,
            user_id.as_ref(),
        )
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }
}

impl ReminderDispatchRepo for PgRemindersRepo {
    type Err = RemindersRepoErr;

    #[tracing::instrument(err, skip(self))]
    async fn due_reminders(
        &self,
        now: DateTime<Utc>,
        limit: i64,
    ) -> Result<Vec<DueReminder>, Self::Err> {
        // Matches `reminder_due_idx` exactly: (next_run_at) WHERE enabled AND
        // completed_at IS NULL.
        let rows = sqlx::query_as!(
            DueReminderRow,
            r#"
            SELECT
                id,
                user_id,
                description,
                entity_type,
                entity_id,
                remind_at,
                cron,
                timezone,
                next_run_at,
                enabled,
                completed_at,
                created_at,
                updated_at
            FROM reminder
            WHERE enabled
              AND completed_at IS NULL
              AND next_run_at <= $1
            ORDER BY next_run_at
            LIMIT $2
            "#,
            now,
            limit,
        )
        .fetch_all(&self.pool)
        .await?;

        // Skip rows that will not decode rather than failing the batch. The
        // query is ordered and limited, so one poison row would be re-selected
        // on every sweep and stall delivery for every user, permanently. This
        // mirrors `list_reminders`, which reports skipped rows rather than
        // failing the page.
        let mut due = Vec::with_capacity(rows.len());
        for row in rows {
            match row.into_due() {
                Ok(reminder) => due.push(reminder),
                Err(e) => tracing::error!(error = ?e, "skipping undecodable due reminder"),
            }
        }

        Ok(due)
    }

    #[tracing::instrument(err, skip(self))]
    async fn claim_occurrence(
        &self,
        reminder_id: Uuid,
        scheduled_for: DateTime<Utc>,
        retry_before: DateTime<Utc>,
    ) -> Result<bool, Self::Err> {
        let id = macro_uuid::generate_uuid_v7();

        // One statement covers both a first claim and a retry. The unique index
        // on (reminder_id, scheduled_for) makes the insert the claim; the
        // conflict branch takes over a claim that was made before
        // `retry_before` and never delivered, so a dispatcher that died
        // mid-flight does not strand the firing. A claim that is either already
        // sent or still fresh matches neither and returns no row.
        let claimed = sqlx::query_scalar!(
            r#"
            INSERT INTO reminder_occurrence (id, reminder_id, scheduled_for)
            VALUES ($1, $2, $3)
            ON CONFLICT (reminder_id, scheduled_for) DO UPDATE
               SET created_at = now()
             WHERE reminder_occurrence.sent_at IS NULL
               AND reminder_occurrence.created_at < $4
            RETURNING id
            "#,
            id,
            reminder_id,
            scheduled_for,
            retry_before,
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(claimed.is_some())
    }

    #[tracing::instrument(err, skip(self))]
    async fn complete_occurrence(
        &self,
        reminder_id: Uuid,
        scheduled_for: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        // Both halves in one transaction: a delivered firing whose reminder is
        // still uncompleted would be sent again on the next sweep.
        let mut tx = self.pool.begin().await?;

        sqlx::query!(
            r#"
            UPDATE reminder_occurrence
            SET sent_at = now()
            WHERE reminder_id = $1 AND scheduled_for = $2
            "#,
            reminder_id,
            scheduled_for,
        )
        .execute(&mut *tx)
        .await?;

        sqlx::query!(
            r#"
            UPDATE reminder
            SET completed_at = now(), updated_at = now()
            WHERE id = $1
            "#,
            reminder_id,
        )
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;

        Ok(())
    }
}
