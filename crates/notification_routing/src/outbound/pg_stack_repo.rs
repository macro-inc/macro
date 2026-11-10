//! PostgreSQL implementation of the [`StackRepository`] port.

#[cfg(test)]
mod tests;

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::models::NotificationLane;
use sqlx::PgPool;
use sqlx::types::Json;
use uuid::Uuid;

use crate::domain::models::{NewStack, NotificationStack, StackChanges, StackRule};
use crate::domain::ports::StackRepository;

/// Postgres-backed stack repository over `notification_stack`.
#[derive(Debug, Clone)]
pub struct PgStackRepository {
    pool: PgPool,
}

impl PgStackRepository {
    /// Create a repository backed by the provided pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// Errors produced by the Postgres stack repository.
#[derive(Debug, thiserror::Error)]
pub enum PgStackRepositoryErr {
    /// Underlying database error.
    #[error(transparent)]
    Db(#[from] sqlx::Error),
    /// A stored owner is not a parseable macro user id.
    #[error("invalid user id stored for a notification stack")]
    InvalidUserId,
}

struct StackRow {
    id: Uuid,
    user_id: String,
    name: String,
    position: i32,
    lane: NotificationLane,
    capture: Json<Vec<StackRule>>,
    release: Json<Vec<StackRule>>,
    enabled: bool,
    revision: i32,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl From<StackRow> for NotificationStack {
    fn from(row: StackRow) -> Self {
        Self {
            id: row.id,
            name: row.name,
            position: row.position,
            lane: row.lane,
            capture: row.capture.0,
            release: row.release.0,
            enabled: row.enabled,
            revision: row.revision,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

impl StackRepository for PgStackRepository {
    type Err = PgStackRepositoryErr;

    async fn list(&self, owner: &MacroUserIdStr<'_>) -> Result<Vec<NotificationStack>, Self::Err> {
        let rows = sqlx::query_as!(
            StackRow,
            r#"
            SELECT id, user_id, name, position, lane AS "lane: NotificationLane",
                   capture AS "capture: Json<Vec<StackRule>>",
                   release AS "release: Json<Vec<StackRule>>",
                   enabled, revision, created_at, updated_at
            FROM notification_stack
            WHERE user_id = $1
            ORDER BY position, id
            "#,
            owner.as_ref(),
        )
        .fetch_all(&self.pool)
        .await?;

        Ok(rows.into_iter().map(NotificationStack::from).collect())
    }

    async fn enabled_for(
        &self,
        owners: &[MacroUserIdStr<'_>],
    ) -> Result<HashMap<MacroUserIdStr<'static>, Vec<NotificationStack>>, Self::Err> {
        let owner_ids: Vec<&str> = owners.iter().map(|owner| owner.as_ref()).collect();
        let rows = sqlx::query_as!(
            StackRow,
            r#"
            SELECT id, user_id, name, position, lane AS "lane: NotificationLane",
                   capture AS "capture: Json<Vec<StackRule>>",
                   release AS "release: Json<Vec<StackRule>>",
                   enabled, revision, created_at, updated_at
            FROM notification_stack
            WHERE user_id = ANY($1) AND enabled
            ORDER BY user_id, position, id
            "#,
            &owner_ids as &[&str],
        )
        .fetch_all(&self.pool)
        .await?;

        let mut stacks: HashMap<MacroUserIdStr<'static>, Vec<NotificationStack>> = HashMap::new();
        for row in rows {
            let owner = MacroUserIdStr::try_from(row.user_id.clone())
                .map_err(|_| PgStackRepositoryErr::InvalidUserId)?;
            stacks.entry(owner).or_default().push(row.into());
        }

        Ok(stacks)
    }

    async fn create(
        &self,
        owner: &MacroUserIdStr<'_>,
        id: Uuid,
        stack: &NewStack,
        lane: NotificationLane,
        limit: usize,
    ) -> Result<Option<NotificationStack>, Self::Err> {
        // One statement counts the owner's stacks, finds the last position
        // and inserts, so the limit holds without a transaction.
        let row = sqlx::query_as!(
            StackRow,
            r#"
            INSERT INTO notification_stack (id, user_id, name, position, lane, capture, release)
            SELECT $1, $2, $3, COALESCE(MAX(position) + 1, 0), $4, $5, $6
            FROM notification_stack
            WHERE user_id = $2
            HAVING COUNT(*) < $7
            RETURNING id, user_id, name, position, lane AS "lane: NotificationLane",
                      capture AS "capture: Json<Vec<StackRule>>",
                      release AS "release: Json<Vec<StackRule>>",
                      enabled, revision, created_at, updated_at
            "#,
            id,
            owner.as_ref(),
            stack.name,
            lane as NotificationLane,
            Json(&stack.capture) as _,
            Json(&stack.release) as _,
            limit as i64,
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(NotificationStack::from))
    }

    async fn update(
        &self,
        owner: &MacroUserIdStr<'_>,
        id: Uuid,
        changes: &StackChanges,
    ) -> Result<Option<NotificationStack>, Self::Err> {
        let row = sqlx::query_as!(
            StackRow,
            r#"
            UPDATE notification_stack
            SET name = COALESCE($3, name),
                capture = COALESCE($4, capture),
                release = COALESCE($5, release),
                enabled = COALESCE($6, enabled),
                revision = revision + 1,
                updated_at = now()
            WHERE id = $1 AND user_id = $2
            RETURNING id, user_id, name, position, lane AS "lane: NotificationLane",
                      capture AS "capture: Json<Vec<StackRule>>",
                      release AS "release: Json<Vec<StackRule>>",
                      enabled, revision, created_at, updated_at
            "#,
            id,
            owner.as_ref(),
            changes.name.as_deref(),
            changes.capture.as_ref().map(Json) as _,
            changes.release.as_ref().map(Json) as _,
            changes.enabled,
        )
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.map(NotificationStack::from))
    }

    async fn delete(&self, owner: &MacroUserIdStr<'_>, id: Uuid) -> Result<bool, Self::Err> {
        let deleted = sqlx::query!(
            "DELETE FROM notification_stack WHERE id = $1 AND user_id = $2",
            id,
            owner.as_ref(),
        )
        .execute(&self.pool)
        .await?;

        Ok(deleted.rows_affected() > 0)
    }

    async fn reorder(
        &self,
        owner: &MacroUserIdStr<'_>,
        ids: &[Uuid],
    ) -> Result<Option<Vec<NotificationStack>>, Self::Err> {
        let mut tx = self.pool.begin().await?;

        // Lock the owner's stacks so the order is checked against what is
        // then reordered.
        let current: HashSet<Uuid> = sqlx::query_scalar!(
            "SELECT id FROM notification_stack WHERE user_id = $1 FOR UPDATE",
            owner.as_ref(),
        )
        .fetch_all(&mut *tx)
        .await?
        .into_iter()
        .collect();
        let named: HashSet<Uuid> = ids.iter().copied().collect();
        if named.len() != ids.len() || named != current {
            return Ok(None);
        }

        let rows = sqlx::query_as!(
            StackRow,
            r#"
            UPDATE notification_stack AS stack
            SET position = (ordered.place - 1)::int
            FROM UNNEST($2::uuid[]) WITH ORDINALITY AS ordered(id, place)
            WHERE stack.id = ordered.id AND stack.user_id = $1
            RETURNING stack.id, stack.user_id, stack.name, stack.position,
                      stack.lane AS "lane: NotificationLane",
                      stack.capture AS "capture: Json<Vec<StackRule>>",
                      stack.release AS "release: Json<Vec<StackRule>>",
                      stack.enabled, stack.revision, stack.created_at, stack.updated_at
            "#,
            owner.as_ref(),
            ids,
        )
        .fetch_all(&mut *tx)
        .await?;
        tx.commit().await?;

        let mut stacks: Vec<NotificationStack> =
            rows.into_iter().map(NotificationStack::from).collect();
        stacks.sort_by_key(|stack| stack.position);
        Ok(Some(stacks))
    }
}
