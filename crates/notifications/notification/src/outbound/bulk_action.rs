//! PostgreSQL storage for bulk actions. Each chunk is one transaction over
//! the action row, its ledger and `user_notification`.

use std::str::FromStr;

use chrono::{DateTime, Utc};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use rootcause::Report;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::bulk_action::{
    AppliedChunk, ApplyChunk, BulkAction, BulkActionLease, BulkActionStatus, BulkActionStore,
    ChunkOutcome, CreatedBulkAction, NewBulkAction, RevertedChunk, UndoRequested,
};

#[cfg(test)]
mod test;

/// How long a lease lasts without a committed chunk, in seconds. A chunk
/// renews it; a worker that stops is replaced once it runs out.
const LEASE_SECONDS: f64 = 30.0;

/// Claims of a stalled action, with no chunk committed in between, after
/// which it is marked failed.
const MAX_ATTEMPTS: i16 = 5;

/// Bulk actions in MacroDB.
#[derive(Clone)]
pub struct PgBulkActions {
    pool: PgPool,
}

impl PgBulkActions {
    /// Construct over the primary pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// An action row as stored.
struct ActionRow {
    id: Uuid,
    user_id: String,
    scope: serde_json::Value,
    as_of: DateTime<Utc>,
    status: String,
    cursor: Option<serde_json::Value>,
    units: i32,
    applied: i32,
    restored: i32,
    revision: i64,
    created_at: DateTime<Utc>,
}

impl ActionRow {
    fn into_domain(self) -> Result<BulkAction, Report> {
        Ok(BulkAction {
            id: self.id,
            user_id: MacroUserIdStr::parse_from_str(&self.user_id)
                .map(CowLike::into_owned)
                .map_err(|error| rootcause::report!("invalid bulk action user id: {error}"))?,
            scope: self.scope,
            as_of: self.as_of,
            status: BulkActionStatus::from_str(&self.status)
                .map_err(|_| rootcause::report!("unknown bulk action status {}", self.status))?,
            cursor: self.cursor,
            units: count(self.units),
            applied: count(self.applied),
            restored: count(self.restored),
            revision: self.revision,
            created_at: self.created_at,
        })
    }
}

/// A stored counter; never negative.
fn count(value: i32) -> u32 {
    u32::try_from(value).unwrap_or(0)
}

/// A chunk's addition to a stored counter.
fn addition(value: usize) -> i32 {
    i32::try_from(value).unwrap_or(i32::MAX)
}

impl BulkActionStore for PgBulkActions {
    async fn create(&self, new: NewBulkAction) -> Result<CreatedBulkAction, Report> {
        let token = Uuid::now_v7();
        let created = sqlx::query_as!(
            ActionRow,
            r#"
            INSERT INTO notification_bulk_action
                (id, user_id, scope, lease_token, lease_expires_at)
            VALUES ($1, $2, $3, $4, now() + make_interval(secs => $5))
            ON CONFLICT (id) DO NOTHING
            RETURNING id, user_id, scope, as_of, status, cursor, units, applied, restored,
                revision, created_at
            "#,
            new.id,
            new.user_id.as_ref(),
            new.scope,
            token,
            LEASE_SECONDS,
        )
        .fetch_optional(&self.pool)
        .await?;
        if let Some(row) = created {
            let action = row.into_domain()?;
            let lease = BulkActionLease {
                action_id: action.id,
                user_id: action.user_id.clone(),
                token,
            };
            return Ok(CreatedBulkAction::Created(action, lease));
        }
        Ok(match self.get(&new.user_id, new.id).await? {
            Some(existing) if existing.scope == new.scope => CreatedBulkAction::Existing(existing),
            _ => CreatedBulkAction::Conflict,
        })
    }

    async fn apply_chunk(
        &self,
        lease: &BulkActionLease,
        chunk: ApplyChunk,
    ) -> Result<ChunkOutcome<AppliedChunk>, Report> {
        let mut tx = self.pool.begin().await?;
        // The row lock orders this chunk against an undo and against another
        // worker's claim: whichever commits first decides.
        let held = sqlx::query!(
            r#"
            SELECT as_of
            FROM notification_bulk_action
            WHERE id = $1 AND user_id = $2 AND lease_token = $3 AND status = 'applying'
            FOR UPDATE
            "#,
            lease.action_id,
            lease.user_id.as_ref(),
            lease.token,
        )
        .fetch_optional(&mut *tx)
        .await?;
        let Some(held) = held else {
            return Ok(ChunkOutcome::Stopped);
        };

        let ids: Vec<Uuid> = chunk
            .items
            .iter()
            .map(|item| item.notification_id)
            .collect();
        let groups: Vec<String> = chunk.items.into_iter().map(|item| item.group_key).collect();
        let changed = sqlx::query_scalar!(
            r#"
            WITH requested AS (
                SELECT DISTINCT ON (notification_id) notification_id, group_key
                FROM unnest($3::uuid[], $4::text[]) AS item (notification_id, group_key)
            ),
            target AS (
                SELECT un.notification_id, un.state, requested.group_key
                FROM user_notification un
                JOIN requested USING (notification_id)
                WHERE un.user_id = $2
                    AND un.deleted_at IS NULL
                    AND un.state <> 'done'
                    AND un.created_at::timestamptz <= $5
                FOR UPDATE OF un
            ),
            ledger AS (
                INSERT INTO notification_bulk_action_item
                    (action_id, notification_id, was_unseen, group_key)
                SELECT $1, notification_id, state = 'unseen', group_key
                FROM target
                ON CONFLICT (action_id, notification_id) DO NOTHING
            )
            UPDATE user_notification un
            SET state = 'done', done_by = $1
            FROM target
            WHERE un.user_id = $2 AND un.notification_id = target.notification_id
            RETURNING un.notification_id
            "#,
            lease.action_id,
            lease.user_id.as_ref(),
            &ids,
            &groups,
            held.as_of,
        )
        .fetch_all(&mut *tx)
        .await?;

        let row = sqlx::query_as!(
            ActionRow,
            r#"
            UPDATE notification_bulk_action
            SET cursor = $2,
                units = units + $3,
                applied = applied + $4,
                status = CASE WHEN $5 THEN 'done' ELSE status END,
                finished_at = CASE WHEN $5 THEN now() ELSE finished_at END,
                lease_expires_at = now() + make_interval(secs => $6),
                attempts = 0,
                revision = revision + 1,
                updated_at = now()
            WHERE id = $1
            RETURNING id, user_id, scope, as_of, status, cursor, units, applied, restored,
                revision, created_at
            "#,
            lease.action_id,
            chunk.cursor,
            i32::try_from(chunk.units).unwrap_or(i32::MAX),
            addition(changed.len()),
            chunk.finished,
            LEASE_SECONDS,
        )
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(ChunkOutcome::Committed(AppliedChunk {
            action: row.into_domain()?,
            changed,
        }))
    }

    async fn request_undo(
        &self,
        user_id: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> Result<Option<UndoRequested>, Report> {
        let token = Uuid::now_v7();
        // Replacing the token fences the worker applying the action: this
        // update waits for its open chunk, and its next one finds the token
        // gone.
        let started = sqlx::query_as!(
            ActionRow,
            r#"
            UPDATE notification_bulk_action
            SET status = 'undoing',
                lease_token = $3,
                lease_expires_at = now() + make_interval(secs => $4),
                attempts = 0,
                finished_at = NULL,
                revision = revision + 1,
                updated_at = now()
            WHERE id = $1 AND user_id = $2 AND status IN ('applying', 'done', 'failed')
            RETURNING id, user_id, scope, as_of, status, cursor, units, applied, restored,
                revision, created_at
            "#,
            id,
            user_id.as_ref(),
            token,
            LEASE_SECONDS,
        )
        .fetch_optional(&self.pool)
        .await?;
        if let Some(row) = started {
            let action = row.into_domain()?;
            let lease = BulkActionLease {
                action_id: action.id,
                user_id: action.user_id.clone(),
                token,
            };
            return Ok(Some(UndoRequested::Started(action, lease)));
        }
        Ok(self.get(user_id, id).await?.map(UndoRequested::Already))
    }

    async fn revert_chunk(
        &self,
        lease: &BulkActionLease,
        limit: u16,
    ) -> Result<ChunkOutcome<RevertedChunk>, Report> {
        let mut tx = self.pool.begin().await?;
        let held = sqlx::query_scalar!(
            r#"
            SELECT id
            FROM notification_bulk_action
            WHERE id = $1 AND user_id = $2 AND lease_token = $3 AND status = 'undoing'
            FOR UPDATE
            "#,
            lease.action_id,
            lease.user_id.as_ref(),
            lease.token,
        )
        .fetch_optional(&mut *tx)
        .await?;
        if held.is_none() {
            return Ok(ChunkOutcome::Stopped);
        }

        // Only a notification still stamped with this action is reopened:
        // any later change to its state cleared the stamp.
        let batch = sqlx::query!(
            r#"
            WITH batch AS (
                SELECT notification_id, was_unseen, group_key
                FROM notification_bulk_action_item
                WHERE action_id = $1 AND NOT undone
                ORDER BY notification_id
                LIMIT $3
                FOR UPDATE
            ),
            reopened AS (
                UPDATE user_notification un
                SET state = CASE
                        WHEN batch.was_unseen THEN 'unseen'::notification_state
                        ELSE 'seen'::notification_state
                    END,
                    done_by = NULL
                FROM batch
                WHERE un.user_id = $2
                    AND un.notification_id = batch.notification_id
                    AND un.done_by = $1
                    AND un.state = 'done'
                    AND un.deleted_at IS NULL
                RETURNING un.notification_id
            ),
            marked AS (
                UPDATE notification_bulk_action_item item
                SET undone = TRUE
                FROM batch
                WHERE item.action_id = $1 AND item.notification_id = batch.notification_id
            )
            SELECT
                batch.group_key AS "group_key!",
                (reopened.notification_id IS NOT NULL) AS "reopened!"
            FROM batch
            LEFT JOIN reopened USING (notification_id)
            "#,
            lease.action_id,
            lease.user_id.as_ref(),
            i64::from(limit),
        )
        .fetch_all(&mut *tx)
        .await?;

        let exhausted = batch.is_empty();
        let mut groups: Vec<String> = batch
            .into_iter()
            .filter(|row| row.reopened)
            .map(|row| row.group_key)
            .collect();
        let reopened = groups.len();
        groups.sort_unstable();
        groups.dedup();

        let row = sqlx::query_as!(
            ActionRow,
            r#"
            UPDATE notification_bulk_action
            SET restored = restored + $2,
                status = CASE WHEN $3 THEN 'undone' ELSE status END,
                finished_at = CASE WHEN $3 THEN now() ELSE finished_at END,
                lease_expires_at = now() + make_interval(secs => $4),
                attempts = 0,
                revision = revision + 1,
                updated_at = now()
            WHERE id = $1
            RETURNING id, user_id, scope, as_of, status, cursor, units, applied, restored,
                revision, created_at
            "#,
            lease.action_id,
            addition(reopened),
            exhausted,
            LEASE_SECONDS,
        )
        .fetch_one(&mut *tx)
        .await?;
        tx.commit().await?;
        Ok(ChunkOutcome::Committed(RevertedChunk {
            action: row.into_domain()?,
            groups,
        }))
    }

    async fn claim_stalled(
        &self,
        limit: u16,
    ) -> Result<Vec<(BulkAction, BulkActionLease)>, Report> {
        let token = Uuid::now_v7();
        let rows = sqlx::query_as!(
            ActionRow,
            r#"
            UPDATE notification_bulk_action action
            SET lease_token = $1,
                lease_expires_at = now() + make_interval(secs => $2),
                attempts = action.attempts + 1,
                status = CASE WHEN action.attempts >= $3 THEN 'failed' ELSE action.status END,
                finished_at = CASE WHEN action.attempts >= $3 THEN now() ELSE NULL END,
                revision = action.revision + 1,
                updated_at = now()
            FROM (
                SELECT id
                FROM notification_bulk_action
                WHERE status IN ('applying', 'undoing') AND lease_expires_at < now()
                ORDER BY lease_expires_at
                LIMIT $4
                FOR UPDATE SKIP LOCKED
            ) stalled
            WHERE action.id = stalled.id
            RETURNING action.id, action.user_id, action.scope, action.as_of, action.status,
                action.cursor, action.units, action.applied, action.restored, action.revision,
                action.created_at
            "#,
            token,
            LEASE_SECONDS,
            MAX_ATTEMPTS,
            i64::from(limit),
        )
        .fetch_all(&self.pool)
        .await?;
        let mut claimed = Vec::with_capacity(rows.len());
        for row in rows {
            let action = row.into_domain()?;
            if !action.status.is_running() {
                tracing::error!(
                    bulk_action = %action.id,
                    "bulk action stalled repeatedly and was marked failed"
                );
                continue;
            }
            let lease = BulkActionLease {
                action_id: action.id,
                user_id: action.user_id.clone(),
                token,
            };
            claimed.push((action, lease));
        }
        Ok(claimed)
    }

    async fn release(&self, lease: &BulkActionLease) -> Result<(), Report> {
        sqlx::query!(
            r#"
            UPDATE notification_bulk_action
            SET lease_expires_at = now()
            WHERE id = $1 AND lease_token = $2 AND status IN ('applying', 'undoing')
            "#,
            lease.action_id,
            lease.token,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn get(
        &self,
        user_id: &MacroUserIdStr<'_>,
        id: Uuid,
    ) -> Result<Option<BulkAction>, Report> {
        sqlx::query_as!(
            ActionRow,
            r#"
            SELECT id, user_id, scope, as_of, status, cursor, units, applied, restored,
                revision, created_at
            FROM notification_bulk_action
            WHERE id = $1 AND user_id = $2
            "#,
            id,
            user_id.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?
        .map(ActionRow::into_domain)
        .transpose()
    }

    async fn running(&self, user_id: &MacroUserIdStr<'_>) -> Result<Vec<BulkAction>, Report> {
        sqlx::query_as!(
            ActionRow,
            r#"
            SELECT id, user_id, scope, as_of, status, cursor, units, applied, restored,
                revision, created_at
            FROM notification_bulk_action
            WHERE user_id = $1 AND status IN ('applying', 'undoing')
            ORDER BY created_at
            "#,
            user_id.as_ref(),
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(ActionRow::into_domain)
        .collect()
    }

    async fn purge_finished(&self, before: DateTime<Utc>, limit: u16) -> Result<u64, Report> {
        let deleted = sqlx::query!(
            r#"
            DELETE FROM notification_bulk_action
            WHERE id IN (
                SELECT id
                FROM notification_bulk_action
                WHERE finished_at IS NOT NULL AND finished_at < $1
                ORDER BY finished_at
                LIMIT $2
                FOR UPDATE SKIP LOCKED
            )
            "#,
            before,
            i64::from(limit),
        )
        .execute(&self.pool)
        .await?;
        Ok(deleted.rows_affected())
    }
}
