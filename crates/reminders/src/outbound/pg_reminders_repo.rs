//! PostgreSQL implementation of the [`RemindersRepo`] port.

#[cfg(test)]
mod test;

use std::str::FromStr;

use chrono::{DateTime, Utc};
use chrono_tz::Tz;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{
    Advance, Completion, DueFiring, DueReminder, InvalidCron, NewReminder, Reminder, ReminderBatch,
    ReminderCron, ReminderCursor, ReminderFilter, ReminderForSoup, ReminderReference,
    ReminderSchedule, ReminderUpdate, SoupOrder, SoupReminderQuery,
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
    /// An entity id is not a uuid, which the `entity_id` column requires.
    #[error("invalid entity id {value:?} for reminder association")]
    InvalidEntityId {
        /// The value that could not be parsed.
        value: String,
    },
    /// A stored owner is not a parseable macro user id.
    ///
    /// Identified by reminder rather than by the offending value: a macro user
    /// id is `macro|someone@example.com`, so echoing it would put an email
    /// address into every log line this error reaches. The row id is enough to
    /// find it.
    #[error("invalid user id stored for reminder {reminder_id}")]
    InvalidUserId {
        /// The reminder carrying the bad value.
        reminder_id: Uuid,
    },
}

/// A `reminder` row, before the schedule columns are folded into a
/// [`ReminderSchedule`].
struct ReminderRow {
    id: Uuid,
    description: String,
    entity_type: Option<String>,
    entity_id: Option<Uuid>,
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
            entity_id: self.entity_id.map(|id| id.to_string()),
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
    entity_id: Option<Uuid>,
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
                return Err(RemindersRepoErr::InvalidUserId { reminder_id });
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

/// The entity id as it is stored: a uuid.
///
/// `Entity` carries the id as a string because it is shared across domains
/// that still key on text, so the conversion happens at this boundary. The
/// router rejects a malformed id first, so reaching the error arm here means
/// a caller bypassed it.
fn entity_uuid(entity: Option<&Entity<'_>>) -> Result<Option<Uuid>, RemindersRepoErr> {
    entity
        .map(|entity| {
            entity.entity_id.as_ref().parse::<Uuid>().map_err(|_| {
                RemindersRepoErr::InvalidEntityId {
                    value: entity.entity_id.as_ref().to_string(),
                }
            })
        })
        .transpose()
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

    #[tracing::instrument(err, skip(self, user_id, new))]
    async fn create_reminder(
        &self,
        user_id: &MacroUserIdStr<'_>,
        new: &NewReminder,
    ) -> Result<Reminder, Self::Err> {
        let entity_type: Option<&str> = new.entity.as_ref().map(|entity| entity.entity_type.into());
        let entity_id = entity_uuid(new.entity.as_ref())?;
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

    #[tracing::instrument(err, skip(self, user_id))]
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

    #[tracing::instrument(err, skip(self, user_id))]
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
        let entity_id = entity_uuid(filter.entity.as_ref())?;
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
              AND ($3::uuid IS NULL OR entity_id = $3)
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

    #[tracing::instrument(err, skip(self, user_id))]
    async fn list_reminders_for_soup(
        &self,
        user_id: &MacroUserIdStr<'_>,
        query: SoupReminderQuery<'_>,
    ) -> Result<Vec<ReminderForSoup>, Self::Err> {
        let SoupReminderQuery {
            ids,
            entities,
            completed,
            fired,
            order,
            limit,
        } = query;
        // Empty means "no constraint", so bind NULL rather than an empty array
        // — `= ANY('{}')` matches nothing.
        let ids = (!ids.is_empty()).then_some(ids);
        let entities = (!entities.is_empty()).then_some(entities);
        let soonest_first = matches!(order, SoupOrder::SoonestFirst);

        let rows = sqlx::query!(
            r#"
            SELECT
                r.id,
                r.description,
                r.entity_type,
                r.entity_id,
                r.remind_at,
                r.cron,
                r.timezone,
                r.next_run_at,
                r.enabled,
                r.completed_at,
                r.created_at,
                r.updated_at,
                d."fileType" as "referenced_file_type?",
                dst.sub_type::text as "referenced_sub_type?"
            FROM reminder r
            -- Resolve the referenced document in the same round trip: the block
            -- a reminder opens (and its icon) comes from the document's file
            -- type, and the client's icon path is synchronous. "Document".id is
            -- still TEXT while reminder.entity_id is a uuid, hence the cast.
            LEFT JOIN "Document" d
                ON r.entity_type = 'document'
               AND d.id = r.entity_id::text
               AND d."deletedAt" IS NULL
            LEFT JOIN document_sub_type dst ON dst.document_id = d.id
            WHERE r.user_id = $1
              AND ($2::uuid[] IS NULL OR r.id = ANY($2))
              AND (
                  $3::text[] IS NULL
                  OR (
                      r.entity_id IS NOT NULL
                      AND r.entity_type || ':' || r.entity_id::text = ANY($3)
                  )
              )
              AND ($4::bool IS NULL OR (r.completed_at IS NOT NULL) = $4)
              -- Due-ness is resolved against the database clock. The caller
              -- cannot pass a timestamp: it would land in the client's query
              -- cache key and change on every render.
              AND ($5::bool IS NULL OR (r.next_run_at <= now()) = $5)
            -- Order in whichever direction Soup will merge in, so the LIMIT
            -- keeps the same rows Soup would keep after merging every item
            -- type. The first two keys collapse to a constant NULL when $6 is
            -- false, leaving the descending pair to decide; when it is true
            -- they fully determine the order and the descending pair is inert.
            ORDER BY
                CASE WHEN $6::bool THEN r.next_run_at END ASC,
                CASE WHEN $6::bool THEN r.id END ASC,
                r.next_run_at DESC,
                r.id DESC
            LIMIT $7
            "#,
            user_id.as_ref(),
            ids as Option<&[Uuid]>,
            entities as Option<&[String]>,
            completed,
            fired,
            soonest_first,
            limit,
        )
        .fetch_all(&self.pool)
        .await?;

        // Undecodable rows are skipped rather than failing the page, matching
        // `list_reminders`.
        Ok(rows
            .into_iter()
            .filter_map(|row| {
                let reference = match (row.referenced_file_type, row.referenced_sub_type) {
                    (None, None) => None,
                    (file_type, sub_type) => Some(ReminderReference {
                        file_type,
                        sub_type,
                    }),
                };
                let reminder = ReminderRow {
                    id: row.id,
                    description: row.description,
                    entity_type: row.entity_type,
                    entity_id: row.entity_id,
                    remind_at: row.remind_at,
                    cron: row.cron,
                    timezone: row.timezone,
                    next_run_at: row.next_run_at,
                    enabled: row.enabled,
                    completed_at: row.completed_at,
                    created_at: row.created_at,
                    updated_at: row.updated_at,
                }
                .into_reminder()
                .inspect_err(|e| {
                    tracing::error!(error=?e, "skipping unreadable reminder");
                })
                .ok()?;
                Some(ReminderForSoup {
                    reminder,
                    reference,
                })
            })
            .collect())
    }

    #[tracing::instrument(err, skip(self, user_id, update))]
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
                -- An explicit `completed` wins over the reschedule rule above;
                -- COALESCE keeps re-completing an already-completed reminder
                -- from moving its timestamp.
                completed_at = CASE
                    WHEN $10::bool IS TRUE  THEN COALESCE(completed_at, now())
                    WHEN $10::bool IS FALSE THEN NULL
                    WHEN $4::bool           THEN NULL
                    ELSE completed_at
                END,
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
            update.completed,
        )
        .fetch_optional(&self.pool)
        .await?;

        row.map(ReminderRow::into_reminder).transpose()
    }

    #[tracing::instrument(err, skip(self, user_id))]
    async fn delete_reminder(
        &self,
        user_id: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> Result<bool, Self::Err> {
        let mut tx = self.pool.begin().await?;

        let result = sqlx::query!(
            r#"DELETE FROM reminder WHERE id = $1 AND user_id = $2"#,
            id,
            user_id.as_ref(),
        )
        .execute(tx.as_mut())
        .await?;

        let deleted = result.rows_affected() > 0;

        if deleted {
            // Retract the firing notification in the same transaction — see the
            // port contract. Only after confirming the reminder was the
            // caller's, so a miss cannot delete someone else's notification.
            // `user_notification` cascades from this row.
            sqlx::query!(
                r#"
                DELETE FROM notification
                WHERE event_item_type = 'reminder' AND event_item_id = $1
                "#,
                id.to_string(),
            )
            .execute(tx.as_mut())
            .await?;
        }

        tx.commit().await?;

        Ok(deleted)
    }
}

impl ReminderDispatchRepo for PgRemindersRepo {
    type Err = RemindersRepoErr;

    #[tracing::instrument(err, skip(self))]
    async fn due_firings(&self, now: DateTime<Utc>) -> Result<Vec<DueFiring>, Self::Err> {
        // Driven by `reminder_due_v2_idx`: (next_run_at) WHERE enabled AND
        // (cron IS NOT NULL OR completed_at IS NULL).
        //
        // Both schedule kinds. A recurring reminder stops being due the moment
        // delivery rolls its `next_run_at` forward, which is why that advance
        // shares a transaction with the sent occurrence — see
        // `complete_occurrence_and_advance`. Were the two ever to come apart, the
        // row would fall out of this query permanently rather than merely re-fan.
        //
        // Unbounded on purpose: a sweep publishes ids, so the cost of a large
        // one is a batch send per ten rows, and the ceiling is the queue's
        // visibility timeout rather than a row count. Should a sweep ever
        // outgrow that, page it with a keyset cursor on (next_run_at, id) and
        // have the handler re-enqueue itself, the way the crm cleanup lister
        // does — a bare LIMIT here would silently strand the overflow.
        //
        // Two separate exclusions, because they mean different things. A
        // `completed_at` reminder is one the owner has finished with and does
        // not want. A sent occurrence is one this firing already delivered —
        // that is what makes a delivered reminder stop being due, and it is
        // keyed on `next_run_at`, so rescheduling makes it due again without
        // anything having to clear it. Covered by
        // `reminder_occurrence_firing_idx`.
        let rows = sqlx::query!(
            r#"
            SELECT r.id, r.next_run_at
            FROM reminder r
            WHERE r.enabled
              -- Completion is per-firing, so it only retires a one-shot. A
              -- recurring reminder its owner has ticked off keeps coming due:
              -- they dealt with the last nudge, not with the standing
              -- arrangement, and ending that is what deleting is for.
              AND (r.cron IS NOT NULL OR r.completed_at IS NULL)
              AND r.next_run_at <= $1
              AND NOT EXISTS (
                  SELECT 1
                  FROM reminder_occurrence o
                  WHERE o.reminder_id = r.id
                    AND o.scheduled_for = r.next_run_at
                    AND o.sent_at IS NOT NULL
              )
            ORDER BY r.next_run_at
            "#,
            now,
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| DueFiring {
                reminder_id: row.id,
                scheduled_for: row.next_run_at,
            })
            .collect())
    }

    #[tracing::instrument(err, skip(self))]
    async fn find_due_reminder(&self, firing: DueFiring) -> Result<Option<DueReminder>, Self::Err> {
        // Matching `next_run_at` exactly is what makes a stale message safe: an
        // edit moves the firing, and this then finds nothing rather than
        // delivering the reminder at a time the user cancelled. It does the
        // same for a recurring firing that was re-fanned after the series had
        // already moved past it.
        let row = sqlx::query_as!(
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
            WHERE id = $1
              AND next_run_at = $2
              AND enabled
              -- Matches `due_firings`: a completed recurring reminder is still
              -- deliverable, a completed one-shot is finished.
              AND (cron IS NOT NULL OR completed_at IS NULL)
            "#,
            firing.reminder_id,
            firing.scheduled_for,
        )
        .fetch_optional(&self.pool)
        .await?;

        row.map(DueReminderRow::into_due).transpose()
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
    async fn release_occurrence(
        &self,
        reminder_id: Uuid,
        scheduled_for: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        // `sent_at IS NULL` guards against releasing a firing that did go out:
        // completion and release can only race if the same firing is being
        // handled twice, and the delivered one must win.
        sqlx::query!(
            r#"
            DELETE FROM reminder_occurrence
            WHERE reminder_id = $1
              AND scheduled_for = $2
              AND sent_at IS NULL
            "#,
            reminder_id,
            scheduled_for,
        )
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    #[tracing::instrument(err, skip(self))]
    async fn complete_occurrence_and_advance(
        &self,
        reminder_id: Uuid,
        scheduled_for: DateTime<Utc>,
        advance: Option<Advance>,
    ) -> Result<Completion, Self::Err> {
        // One transaction, because the two writes are only correct together.
        // Marking the occurrence sent is what stops this firing going out
        // twice; advancing `next_run_at` is what brings the next one around. A
        // recurring reminder that got the first without the second would be
        // excluded by its own sent occurrence and never move again — silently
        // dead, and invisible until someone noticed the notifications had
        // stopped. Every other failure here is retryable; that one is not.
        let mut tx = self.pool.begin().await?;

        // The reminder itself is left alone. Delivery is not completion:
        // `completed_at` means the owner is finished with the reminder, and one
        // that has just arrived in their inbox plainly is not.
        sqlx::query!(
            r#"
            UPDATE reminder_occurrence
            SET sent_at = now()
            WHERE reminder_id = $1 AND scheduled_for = $2
            "#,
            reminder_id,
            scheduled_for,
        )
        .execute(tx.as_mut())
        .await?;

        let Some(advance) = advance else {
            tx.commit().await?;
            return Ok(Completion::NoAdvance);
        };

        // `next_run_at = $3` guards against overwriting a reschedule the owner
        // made while this delivery was in flight. Their time is a decision; the
        // advance is bookkeeping, so a mismatch here is a correct no-op rather
        // than a lost update.
        //
        // Which row count tells apart from a failed advance: both leave the
        // reminder where it was, and only this says which happened.
        let advanced = sqlx::query!(
            r#"
            UPDATE reminder
            SET next_run_at = $2,
                -- Cleared only when the owner was notified. A firing they can
                -- see supersedes their "done" on the previous one; a firing
                -- rolled forward in silence supersedes nothing.
                completed_at = CASE WHEN $4::bool THEN NULL ELSE completed_at END,
                updated_at = now()
            WHERE id = $1 AND next_run_at = $3
            "#,
            reminder_id,
            advance.next_run_at,
            scheduled_for,
            advance.clear_completion,
        )
        .execute(tx.as_mut())
        .await?
        .rows_affected();

        tx.commit().await?;

        Ok(if advanced > 0 {
            Completion::Advanced
        } else {
            Completion::NotAdvanced
        })
    }

    #[tracing::instrument(err, skip(self))]
    async fn retract_notifications(
        &self,
        reminder_id: Uuid,
        before: DateTime<Utc>,
    ) -> Result<(), Self::Err> {
        // Reaches into `notification` for the same reason `delete_reminder`
        // does: a reminder *is* its notification's `event_item`, so the two are
        // one thing to a reader even though they belong to different domains.
        // `user_notification` cascades from this row.
        //
        // Bounded by the firing rather than clearing the reminder outright, so
        // the notification this delivery just created — and any a concurrent
        // delivery of a later firing created — survive. `scheduledFor` is the
        // firing each notification was written for; rows without it predate
        // recurring dispatch and are older than anything being delivered now.
        //
        // Read the candidates, decide here, delete by id.
        //
        // The obvious form is one statement comparing the metadata timestamp
        // directly, but that needs a cast, and a cast in a predicate fails the
        // whole statement on a single malformed value — which, since a failed
        // retraction is swallowed, would show up as tidying that quietly never
        // happened. `pg_input_is_valid` would guard it, but that is Postgres 16
        // and production runs 14. Parsing here costs one round trip on a cold
        // path and cannot be defeated by a bad row or an older server.
        let candidates = sqlx::query!(
            r#"
            SELECT id, metadata->>'scheduledFor' AS "scheduled_for?"
            FROM notification
            WHERE event_item_type = 'reminder' AND event_item_id = $1
            "#,
            reminder_id.to_string(),
        )
        .fetch_all(&self.pool)
        .await?;

        let stale: Vec<Uuid> = candidates
            .into_iter()
            .filter(|row| match row.scheduled_for.as_deref() {
                // No firing recorded: written before recurring dispatch, so
                // older than anything being delivered now.
                None => true,
                // Unreadable is treated as stale, which is what it is.
                Some(raw) => match DateTime::parse_from_rfc3339(raw) {
                    Ok(at) => at.with_timezone(&Utc) < before,
                    Err(_) => true,
                },
            })
            .map(|row| row.id)
            .collect();

        if stale.is_empty() {
            return Ok(());
        }

        sqlx::query!(r#"DELETE FROM notification WHERE id = ANY($1)"#, &stale)
            .execute(&self.pool)
            .await?;

        Ok(())
    }
}
