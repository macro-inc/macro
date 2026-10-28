//! Postgres implementation of [`ImportRepo`].
//!
//! Sources, statuses, and initiators are stored as text and parsed back
//! through the domain enums; every status write is a CAS expressed in SQL,
//! reporting whether it happened via `RETURNING` / rows-affected.

use crate::domain::models::{
    ImportEntity, ImportKind, ImportRun, ImportSource, ImportStatus, Initiator, RunStatus,
    ScanCounts, TEAMMATE_STOPPED,
};
use crate::domain::ports::{ImportError, ImportRepo, Result};
use agent_session::domain::notifications::NotificationWriter;
use chrono::{DateTime, Utc};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{PgConnection, PgPool};
use std::collections::HashSet;
use std::str::FromStr;
use std::sync::Arc;
use uuid::Uuid;

mod notion_run;
mod plan;
/// Canonical target transaction helpers for composition roots.
pub mod targets;

#[cfg(test)]
mod test;

/// Postgres-backed import repository (MacroDB).
#[derive(Clone)]
pub struct PgImportRepo {
    pool: PgPool,
    workspace_source: ImportSource,
    notifications: Option<Arc<dyn NotificationWriter<PgConnection>>>,
}

impl PgImportRepo {
    /// Build the repository on the MacroDB pool.
    pub fn new(pool: PgPool) -> Self {
        Self {
            pool,
            workspace_source: ImportSource::Notion,
            notifications: None,
        }
    }

    /// Produce agent-session system events through `notifications`, in the
    /// transactions that move a reviewed Notion run. Hosts that run Notion
    /// workspace imports set it; without it, sessions are not told.
    pub fn with_session_notifications(
        mut self,
        notifications: Arc<dyn NotificationWriter<PgConnection>>,
    ) -> Self {
        self.notifications = Some(notifications);
        self
    }
}

struct ImportEntityDbRow {
    id: Uuid,
    user_id: String,
    team_id: Option<Uuid>,
    source: String,
    kind: Option<String>,
    foreign_id: String,
    parent_id: Option<Uuid>,
    review_id: Option<Uuid>,
    status: String,
    initiator: String,
    metadata: serde_json::Value,
    entity_id: Option<String>,
    entity_type: Option<String>,
    last_error: Option<String>,
    waiting_on: Option<Uuid>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
}

impl TryFrom<ImportEntityDbRow> for ImportEntity {
    type Error = ImportError;

    fn try_from(row: ImportEntityDbRow) -> Result<ImportEntity> {
        let source = ImportSource::from_str(&row.source)
            .map_err(|_| anyhow::anyhow!("unknown import source: {}", row.source))?;
        let status = ImportStatus::from_str(&row.status)
            .map_err(|_| anyhow::anyhow!("unknown import status: {}", row.status))?;
        let initiator = Initiator::from_str(&row.initiator)
            .map_err(|_| anyhow::anyhow!("unknown import initiator: {}", row.initiator))?;
        // Rows written before `kind` existed (or by a replica still running
        // older code during a deploy) hold NULL: they are always the source's
        // original kind.
        let kind = match row.kind {
            Some(kind) => ImportKind::from_str(&kind)
                .map_err(|_| anyhow::anyhow!("unknown import kind: {kind}"))?,
            None => source.default_kind(),
        };
        Ok(ImportEntity {
            id: row.id,
            user_id: row.user_id,
            team_id: row.team_id,
            source,
            kind,
            foreign_id: row.foreign_id,
            parent_id: row.parent_id,
            review_id: row.review_id,
            status,
            initiator,
            metadata: row.metadata,
            entity_id: row.entity_id,
            entity_type: row.entity_type,
            last_error: row.last_error,
            waiting_on: row.waiting_on,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }
}

struct ImportRunDbRow {
    source: String,
    status: String,
    error: Option<String>,
    updated_at: DateTime<Utc>,
    scanned_pages: Option<i32>,
    scanned_data_sources: Option<i32>,
    review_id: Option<Uuid>,
}

impl TryFrom<ImportRunDbRow> for ImportRun {
    type Error = ImportError;

    fn try_from(row: ImportRunDbRow) -> Result<ImportRun> {
        let source = ImportSource::from_str(&row.source)
            .map_err(|_| anyhow::anyhow!("unknown import source: {}", row.source))?;
        let status = RunStatus::from_str(&row.status)
            .map_err(|_| anyhow::anyhow!("unknown run status: {}", row.status))?;
        let scanned = match (row.scanned_pages, row.scanned_data_sources) {
            (Some(pages), Some(data_sources)) => Some(ScanCounts {
                pages: u32::try_from(pages).map_err(anyhow::Error::from)?,
                data_sources: u32::try_from(data_sources).map_err(anyhow::Error::from)?,
            }),
            _ => None,
        };
        Ok(ImportRun {
            source,
            status,
            error: row.error,
            updated_at: row.updated_at,
            scanned,
            review_id: row.review_id,
        })
    }
}

fn run_status_strings(statuses: &[RunStatus]) -> Vec<String> {
    statuses.iter().map(|s| s.as_ref().to_string()).collect()
}

/// Send the rows waiting on `holders`, which stopped being written, back to
/// staged. Run after the update that moved the holders, as its own
/// statement, so it sees waiters that committed meanwhile.
async fn release_waiters(
    transaction: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    holders: &[Uuid],
) -> Result<u64> {
    let result = sqlx::query!(
        r#"
        UPDATE import_entity
        SET status = 'staged', waiting_on = NULL, last_error = $2, updated_at = NOW()
        WHERE waiting_on = ANY($1::uuid[]) AND status = 'importing'
        "#,
        holders,
        TEAMMATE_STOPPED,
    )
    .execute(&mut **transaction)
    .await?;
    Ok(result.rows_affected())
}

impl ImportRepo for PgImportRepo {
    #[tracing::instrument(skip(self), err)]
    async fn get_own_by_foreign_id(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        foreign_id: &str,
    ) -> Result<Option<ImportEntity>> {
        let row = sqlx::query_as!(
            ImportEntityDbRow,
            r#"
            SELECT id, user_id, team_id, source, kind, foreign_id, parent_id, review_id, status,
                   initiator, metadata, entity_id, entity_type, last_error, waiting_on, created_at, updated_at
            FROM import_entity
            WHERE user_id = $1 AND source = $2 AND foreign_id = $3
            "#,
            user.as_ref(),
            source.as_ref(),
            foreign_id,
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(ImportEntity::try_from).transpose()
    }

    #[tracing::instrument(skip(self), err)]
    async fn find_team_imported(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        foreign_id: &str,
    ) -> Result<Option<ImportEntity>> {
        let row = sqlx::query_as!(
            ImportEntityDbRow,
            r#"
            SELECT id, user_id, team_id, source, kind, foreign_id, parent_id, review_id, status,
                   initiator, metadata, entity_id, entity_type, last_error, waiting_on, created_at, updated_at
            FROM import_entity
            WHERE source = $2 AND foreign_id = $3
              AND status = 'imported'
              AND user_id <> $1
              AND team_id IS NOT NULL
              AND team_id = (SELECT team_id FROM team_user WHERE user_id = $1)
            LIMIT 1
            "#,
            user.as_ref(),
            source.as_ref(),
            foreign_id,
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(ImportEntity::try_from).transpose()
    }

    #[tracing::instrument(skip(self, metadata), err)]
    async fn upsert_staged(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        kind: ImportKind,
        initiator: Initiator,
        foreign_id: &str,
        metadata: &serde_json::Value,
    ) -> Result<Option<ImportEntity>> {
        let row = sqlx::query_as!(
            ImportEntityDbRow,
            r#"
            INSERT INTO import_entity (user_id, source, kind, foreign_id, status, initiator, metadata)
            VALUES ($1, $2, $6, $3, 'staged', $4, $5)
            ON CONFLICT (user_id, source, foreign_id) DO UPDATE
            SET metadata = EXCLUDED.metadata, updated_at = NOW()
            WHERE import_entity.status = 'staged'
            RETURNING id, user_id, team_id, source, kind, foreign_id, parent_id, review_id, status,
                      initiator, metadata, entity_id, entity_type, last_error, waiting_on, created_at,
                      updated_at
            "#,
            user.as_ref(),
            source.as_ref(),
            foreign_id,
            initiator.as_ref(),
            metadata,
            kind.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(ImportEntity::try_from).transpose()
    }

    #[tracing::instrument(skip(self, metadata), err)]
    async fn upsert_imported(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        kind: ImportKind,
        initiator: Initiator,
        foreign_id: &str,
        metadata: &serde_json::Value,
        entity_id: &str,
        entity_type: &str,
        team_id: Option<Uuid>,
    ) -> Result<ImportEntity> {
        let row = sqlx::query_as!(
            ImportEntityDbRow,
            r#"
            INSERT INTO import_entity (user_id, source, kind, foreign_id, status, initiator,
                                       metadata, entity_id, entity_type, team_id)
            VALUES ($1, $2, $9, $3, 'imported', $4, $5, $6, $7, $8)
            ON CONFLICT (user_id, source, foreign_id) DO UPDATE
            SET status = 'imported', metadata = EXCLUDED.metadata,
                entity_id = EXCLUDED.entity_id, entity_type = EXCLUDED.entity_type,
                team_id = EXCLUDED.team_id, last_error = NULL, updated_at = NOW()
            WHERE import_entity.status <> 'imported'
            RETURNING id, user_id, team_id, source, kind, foreign_id, parent_id, review_id, status,
                      initiator, metadata, entity_id, entity_type, last_error, waiting_on, created_at,
                      updated_at
            "#,
            user.as_ref(),
            source.as_ref(),
            foreign_id,
            initiator.as_ref(),
            metadata,
            entity_id,
            entity_type,
            team_id,
            kind.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?;
        match row {
            Some(row) => row.try_into(),
            // Already imported: first mapping wins; return the stored row.
            None => self
                .get_own_by_foreign_id(user, source, foreign_id)
                .await?
                .ok_or_else(|| ImportError::Other(anyhow::anyhow!("imported upsert vanished"))),
        }
    }

    #[tracing::instrument(skip(self), err)]
    async fn get(&self, user: &MacroUserIdStr<'static>, id: Uuid) -> Result<Option<ImportEntity>> {
        let row = sqlx::query_as!(
            ImportEntityDbRow,
            r#"
            SELECT id, user_id, team_id, source, kind, foreign_id, parent_id, review_id, status,
                   initiator, metadata, entity_id, entity_type, last_error, waiting_on, created_at, updated_at
            FROM import_entity
            WHERE user_id = $1 AND id = $2
            "#,
            user.as_ref(),
            id,
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(ImportEntity::try_from).transpose()
    }

    #[tracing::instrument(skip(self), err)]
    async fn list(
        &self,
        user: &MacroUserIdStr<'static>,
        source: Option<ImportSource>,
        status: Option<ImportStatus>,
    ) -> Result<Vec<ImportEntity>> {
        let rows = sqlx::query_as!(
            ImportEntityDbRow,
            r#"
            SELECT id, user_id, team_id, source, kind, foreign_id, parent_id, review_id, status,
                   initiator, metadata, entity_id, entity_type, last_error, waiting_on, created_at, updated_at
            FROM import_entity
            WHERE (
                user_id = $1
                OR (status = 'imported' AND team_id IS NOT NULL
                    AND team_id = (SELECT team_id FROM team_user WHERE user_id = $1))
            )
            AND ($2::text IS NULL OR source = $2)
            AND ($3::text IS NULL OR status = $3)
            ORDER BY (user_id = $1) DESC, created_at DESC
            "#,
            user.as_ref(),
            source.map(|s| s.as_ref().to_string()) as Option<String>,
            status.map(|s| s.as_ref().to_string()) as Option<String>,
        )
        .fetch_all(&self.pool)
        .await?;

        // Own rows come first (see ORDER BY); drop teammate rows that
        // duplicate an own row on (source, foreign_id), then restore
        // newest-first order. Unparseable rows are skipped with a warning
        // rather than failing the whole list.
        let mut seen: HashSet<(String, String)> = HashSet::new();
        let mut entities: Vec<ImportEntity> = Vec::with_capacity(rows.len());
        for row in rows {
            let own = row.user_id == user.as_ref();
            match ImportEntity::try_from(row) {
                Ok(entity) => {
                    let key = (
                        entity.source.as_ref().to_string(),
                        entity.foreign_id.clone(),
                    );
                    if own {
                        seen.insert(key);
                        entities.push(entity);
                    } else if !seen.contains(&key) {
                        entities.push(entity);
                    }
                }
                Err(e) => {
                    tracing::warn!(error = ?e, "skipping unparseable import_entity row");
                }
            }
        }
        entities.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(entities)
    }

    #[tracing::instrument(skip(self, ids), fields(count = ids.len()), err)]
    async fn mark_importing(
        &self,
        user: &MacroUserIdStr<'static>,
        ids: &[Uuid],
    ) -> Result<Vec<ImportEntity>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let rows = sqlx::query_as!(
            ImportEntityDbRow,
            r#"
            UPDATE import_entity
            SET status = 'importing', last_error = NULL, updated_at = NOW()
            WHERE user_id = $1 AND id = ANY($2::uuid[]) AND status = 'staged'
            RETURNING id, user_id, team_id, source, kind, foreign_id, parent_id, review_id, status,
                      initiator, metadata, entity_id, entity_type, last_error, waiting_on, created_at,
                      updated_at
            "#,
            user.as_ref(),
            ids,
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(ImportEntity::try_from).collect()
    }

    #[tracing::instrument(skip(self), err)]
    async fn mark_imported(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        entity_id: &str,
        entity_type: &str,
        team_id: Option<Uuid>,
    ) -> Result<Option<ImportEntity>> {
        let mut transaction = self.pool.begin().await?;
        let row = sqlx::query_as!(
            ImportEntityDbRow,
            r#"
            UPDATE import_entity
            SET status = 'imported', entity_id = $3, entity_type = $4,
                team_id = COALESCE($5, team_id), waiting_on = NULL,
                last_error = NULL, updated_at = NOW()
            WHERE user_id = $1 AND id = $2 AND status = 'importing'
            RETURNING id, user_id, team_id, source, kind, foreign_id, parent_id, review_id, status,
                      initiator, metadata, entity_id, entity_type, last_error, waiting_on, created_at,
                      updated_at
            "#,
            user.as_ref(),
            id,
            entity_id,
            entity_type,
            team_id,
        )
        .fetch_optional(&mut *transaction)
        .await?;
        if row.is_some() {
            // Its own statement, so it sees waiters that committed while the
            // update above waited for their lock on this row.
            sqlx::query!(
                r#"
                UPDATE import_entity
                SET status = 'imported', entity_id = $2, entity_type = $3, waiting_on = NULL,
                    last_error = NULL, updated_at = NOW()
                WHERE waiting_on = $1 AND status = 'importing'
                "#,
                id,
                entity_id,
                entity_type,
            )
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        row.map(ImportEntity::try_from).transpose()
    }

    #[tracing::instrument(skip(self), err)]
    async fn mark_import_failed(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        error: &str,
    ) -> Result<bool> {
        let mut transaction = self.pool.begin().await?;
        let result = sqlx::query!(
            r#"
            UPDATE import_entity
            SET status = 'staged', last_error = $3, team_id = NULL, waiting_on = NULL,
                updated_at = NOW()
            WHERE user_id = $1 AND id = $2 AND status = 'importing'
            "#,
            user.as_ref(),
            id,
            error,
        )
        .execute(&mut *transaction)
        .await?;
        let moved = result.rows_affected() > 0;
        if moved {
            release_waiters(&mut transaction, &[id]).await?;
        }
        transaction.commit().await?;
        Ok(moved)
    }

    #[tracing::instrument(skip(self), err)]
    async fn fail_stale_importing(
        &self,
        user: &MacroUserIdStr<'static>,
        older_than_secs: i64,
    ) -> Result<u64> {
        let result = sqlx::query!(
            r#"
            UPDATE import_entity
            SET status = 'staged',
                last_error = 'the import was interrupted — select it again to retry',
                updated_at = NOW()
            WHERE user_id = $1 AND status = 'importing'
              AND NOT (source IN ('notion', 'linear', 'jira') AND metadata->'plan' IS NOT NULL)
              AND updated_at < NOW() - ($2::double precision * interval '1 second')
            "#,
            user.as_ref(),
            older_than_secs as f64,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
    }

    #[tracing::instrument(skip(self, ids), fields(rows = ids.len()), err)]
    async fn touch_importing(&self, user: &MacroUserIdStr<'static>, ids: &[Uuid]) -> Result<u64> {
        let result = sqlx::query!(
            r#"
            UPDATE import_entity
            SET updated_at = NOW()
            WHERE user_id = $1 AND id = ANY($2) AND status = 'importing'
            "#,
            user.as_ref(),
            ids,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
    }

    #[tracing::instrument(skip(self), err)]
    async fn discard(&self, user: &MacroUserIdStr<'static>, id: Uuid) -> Result<bool> {
        let result = sqlx::query!(
            r#"
            UPDATE import_entity
            SET status = 'discarded', updated_at = NOW()
            WHERE user_id = $1 AND id = $2 AND status = 'staged'
            "#,
            user.as_ref(),
            id,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    #[tracing::instrument(skip(self), err)]
    async fn user_team_id(&self, user: &MacroUserIdStr<'static>) -> Result<Option<Uuid>> {
        let team_id = sqlx::query_scalar!(
            r#"SELECT team_id FROM team_user WHERE user_id = $1"#,
            user.as_ref(),
        )
        .fetch_optional(&self.pool)
        .await?;
        Ok(team_id)
    }

    #[tracing::instrument(skip(self), err)]
    async fn team_members(&self, team_id: Uuid) -> Result<Vec<MacroUserIdStr<'static>>> {
        let rows = sqlx::query!("SELECT user_id FROM team_user WHERE team_id = $1", team_id,)
            .fetch_all(&self.pool)
            .await?;
        let mut members = Vec::with_capacity(rows.len());
        for row in rows {
            match MacroUserIdStr::parse_from_str(&row.user_id).map(|id| id.into_owned()) {
                Ok(id) => members.push(id),
                Err(error) => {
                    tracing::warn!(?error, %team_id, "skipping unparseable team member id");
                }
            }
        }
        Ok(members)
    }

    #[tracing::instrument(skip(self), err)]
    async fn list_runs(&self, user: &MacroUserIdStr<'static>) -> Result<Vec<ImportRun>> {
        let rows = sqlx::query_as!(
            ImportRunDbRow,
            r#"
            SELECT source, status::text AS "status!", error, updated_at,
                   CASE WHEN status = 'running' THEN scanned_pages END AS scanned_pages,
                   CASE WHEN status = 'running' THEN scanned_data_sources END
                       AS scanned_data_sources,
                   review_id
            FROM import_run WHERE user_id = $1
            ORDER BY source
            "#,
            user.as_ref(),
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter().map(ImportRun::try_from).collect()
    }

    #[tracing::instrument(skip(self), err)]
    async fn start_run(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        from: &[RunStatus],
    ) -> Result<bool> {
        let from = run_status_strings(from);
        let result = sqlx::query!(
            r#"
            INSERT INTO import_run (user_id, source, status)
            VALUES ($1, $2, 'running')
            ON CONFLICT (user_id, source) DO UPDATE
            SET status = 'running', error = NULL, updated_at = NOW(),
                scanned_pages = NULL, scanned_data_sources = NULL,
                lease_owner = NULL, lease_expires_at = NULL, adoptions = 0,
                review_session_id = NULL, review_id = NULL
            WHERE import_run.status::text = ANY($3::text[])
            "#,
            user.as_ref(),
            source.as_ref(),
            &from,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    #[tracing::instrument(skip(self), err)]
    async fn fail_stale_runs(
        &self,
        user: &MacroUserIdStr<'static>,
        older_than_secs: i64,
    ) -> Result<u64> {
        let result = sqlx::query!(
            r#"
            UPDATE import_run
            SET status = 'failed',
                error = 'discovery was interrupted — try again',
                updated_at = NOW()
            WHERE user_id = $1 AND status IN ('running', 'importing') AND source NOT IN ('notion', 'linear', 'jira')
              AND updated_at < NOW() - ($2::double precision * interval '1 second')
            "#,
            user.as_ref(),
            older_than_secs as f64,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
    }

    #[tracing::instrument(skip(self), err)]
    async fn finish_run(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        to: RunStatus,
        error: Option<&str>,
    ) -> Result<bool> {
        let result = sqlx::query!(
            r#"
            UPDATE import_run
            SET status = $3::text::import_run_status,
                error = $4,
                updated_at = NOW()
            WHERE user_id = $1 AND source = $2 AND status = 'running'
            "#,
            user.as_ref(),
            source.as_ref(),
            to.as_ref(),
            error,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }
}

// The domain error stays sqlx-free; this adapter owns the mapping so `?`
// works on sqlx results throughout the crate's outbound code. The raw sqlx
// error travels inside the report.
impl From<sqlx::Error> for ImportError {
    fn from(e: sqlx::Error) -> Self {
        Self::Db(rootcause::report!(e).into_dynamic())
    }
}
