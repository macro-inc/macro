//! Postgres implementation of [`ImportRepo`].
//!
//! Sources, statuses, and initiators are stored as text and parsed back
//! through the domain enums; every status write is a CAS expressed in SQL,
//! reporting whether it happened via `RETURNING` / rows-affected.

use crate::domain::models::{
    ImportEntity, ImportRun, ImportSource, ImportStatus, Initiator, RunStatus,
};
use crate::domain::ports::{ImportError, ImportRepo, Result};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use std::collections::HashSet;
use std::str::FromStr;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Postgres-backed import repository (MacroDB).
#[derive(Clone)]
pub struct PgImportRepo {
    pool: PgPool,
}

impl PgImportRepo {
    /// Build the repository on the MacroDB pool.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

struct ImportEntityDbRow {
    id: Uuid,
    user_id: String,
    team_id: Option<Uuid>,
    source: String,
    foreign_id: String,
    status: String,
    initiator: String,
    metadata: serde_json::Value,
    entity_id: Option<String>,
    entity_type: Option<String>,
    last_error: Option<String>,
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
        Ok(ImportEntity {
            id: row.id,
            user_id: row.user_id,
            team_id: row.team_id,
            source,
            foreign_id: row.foreign_id,
            status,
            initiator,
            metadata: row.metadata,
            entity_id: row.entity_id,
            entity_type: row.entity_type,
            last_error: row.last_error,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }
}

struct ImportRunDbRow {
    source: String,
    status: String,
    auto_import: bool,
    error: Option<String>,
    updated_at: DateTime<Utc>,
}

impl TryFrom<ImportRunDbRow> for ImportRun {
    type Error = ImportError;

    fn try_from(row: ImportRunDbRow) -> Result<ImportRun> {
        let source = ImportSource::from_str(&row.source)
            .map_err(|_| anyhow::anyhow!("unknown import source: {}", row.source))?;
        let status = RunStatus::from_str(&row.status)
            .map_err(|_| anyhow::anyhow!("unknown run status: {}", row.status))?;
        Ok(ImportRun {
            source,
            status,
            auto_import: row.auto_import,
            error: row.error,
            updated_at: row.updated_at,
        })
    }
}

fn run_status_strings(statuses: &[RunStatus]) -> Vec<String> {
    statuses.iter().map(|s| s.as_ref().to_string()).collect()
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
            SELECT id, user_id, team_id, source, foreign_id, status, initiator,
                   metadata, entity_id, entity_type, last_error, created_at, updated_at
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
            SELECT id, user_id, team_id, source, foreign_id, status, initiator,
                   metadata, entity_id, entity_type, last_error, created_at, updated_at
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
        initiator: Initiator,
        foreign_id: &str,
        metadata: &serde_json::Value,
    ) -> Result<Option<ImportEntity>> {
        let row = sqlx::query_as!(
            ImportEntityDbRow,
            r#"
            INSERT INTO import_entity (user_id, source, foreign_id, status, initiator, metadata)
            VALUES ($1, $2, $3, 'staged', $4, $5)
            ON CONFLICT (user_id, source, foreign_id) DO UPDATE
            SET metadata = EXCLUDED.metadata, updated_at = NOW()
            WHERE import_entity.status = 'staged'
            RETURNING id, user_id, team_id, source, foreign_id, status, initiator,
                      metadata, entity_id, entity_type, last_error, created_at, updated_at
            "#,
            user.as_ref(),
            source.as_ref(),
            foreign_id,
            initiator.as_ref(),
            metadata,
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
            INSERT INTO import_entity (user_id, source, foreign_id, status, initiator, metadata,
                                       entity_id, entity_type, team_id)
            VALUES ($1, $2, $3, 'imported', $4, $5, $6, $7, $8)
            ON CONFLICT (user_id, source, foreign_id) DO UPDATE
            SET status = 'imported', metadata = EXCLUDED.metadata,
                entity_id = EXCLUDED.entity_id, entity_type = EXCLUDED.entity_type,
                team_id = EXCLUDED.team_id, last_error = NULL, updated_at = NOW()
            WHERE import_entity.status <> 'imported'
            RETURNING id, user_id, team_id, source, foreign_id, status, initiator,
                      metadata, entity_id, entity_type, last_error, created_at, updated_at
            "#,
            user.as_ref(),
            source.as_ref(),
            foreign_id,
            initiator.as_ref(),
            metadata,
            entity_id,
            entity_type,
            team_id,
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
            SELECT id, user_id, team_id, source, foreign_id, status, initiator,
                   metadata, entity_id, entity_type, last_error, created_at, updated_at
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
            SELECT id, user_id, team_id, source, foreign_id, status, initiator,
                   metadata, entity_id, entity_type, last_error, created_at, updated_at
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
            RETURNING id, user_id, team_id, source, foreign_id, status, initiator,
                      metadata, entity_id, entity_type, last_error, created_at, updated_at
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
        let row = sqlx::query_as!(
            ImportEntityDbRow,
            r#"
            UPDATE import_entity
            SET status = 'imported', entity_id = $3, entity_type = $4, team_id = $5,
                last_error = NULL, updated_at = NOW()
            WHERE user_id = $1 AND id = $2 AND status = 'importing'
            RETURNING id, user_id, team_id, source, foreign_id, status, initiator,
                      metadata, entity_id, entity_type, last_error, created_at, updated_at
            "#,
            user.as_ref(),
            id,
            entity_id,
            entity_type,
            team_id,
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(ImportEntity::try_from).transpose()
    }

    #[tracing::instrument(skip(self), err)]
    async fn mark_import_failed(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        error: &str,
    ) -> Result<bool> {
        let result = sqlx::query!(
            r#"
            UPDATE import_entity
            SET status = 'staged', last_error = $3, updated_at = NOW()
            WHERE user_id = $1 AND id = $2 AND status = 'importing'
            "#,
            user.as_ref(),
            id,
            error,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
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
    async fn discard_staged_by_initiator(
        &self,
        user: &MacroUserIdStr<'static>,
        initiator: Initiator,
    ) -> Result<u64> {
        let result = sqlx::query!(
            r#"
            UPDATE import_entity
            SET status = 'discarded', updated_at = NOW()
            WHERE user_id = $1 AND initiator = $2 AND status = 'staged'
            "#,
            user.as_ref(),
            initiator.as_ref(),
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_staged_by_initiator(
        &self,
        user: &MacroUserIdStr<'static>,
        initiator: Initiator,
    ) -> Result<u64> {
        let result = sqlx::query!(
            r#"
            DELETE FROM import_entity
            WHERE user_id = $1 AND initiator = $2 AND status = 'staged'
              AND NOT (
                  $2 = 'onboarding'
                  AND EXISTS (
                      SELECT 1
                      FROM import_run
                      WHERE import_run.user_id = import_entity.user_id
                        AND import_run.source = import_entity.source
                        AND import_run.auto_import
                        AND import_run.status IN ('running', 'ready', 'importing', 'failed')
                  )
              )
            "#,
            user.as_ref(),
            initiator.as_ref(),
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
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
    async fn list_runs(&self, user: &MacroUserIdStr<'static>) -> Result<Vec<ImportRun>> {
        let rows = sqlx::query_as!(
            ImportRunDbRow,
            r#"
            SELECT source, status::text AS "status!", auto_import, error, updated_at
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
        auto_import: bool,
    ) -> Result<bool> {
        let from = run_status_strings(from);
        let result = sqlx::query!(
            r#"
            INSERT INTO import_run (user_id, source, status, auto_import)
            VALUES ($1, $2, 'running', $4)
            ON CONFLICT (user_id, source) DO UPDATE
            SET status = 'running', error = NULL, updated_at = NOW()
            WHERE import_run.status::text = ANY($3::text[])
            "#,
            user.as_ref(),
            source.as_ref(),
            &from,
            auto_import,
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
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

    #[tracing::instrument(skip(self), err)]
    async fn transition_run(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        from: &[RunStatus],
        to: RunStatus,
    ) -> Result<bool> {
        let from = run_status_strings(from);
        let result = sqlx::query!(
            r#"
            UPDATE import_run
            SET status = $4::text::import_run_status, updated_at = NOW()
            WHERE user_id = $1 AND source = $2
              AND status::text = ANY($3::text[])
            "#,
            user.as_ref(),
            source.as_ref(),
            &from,
            to.as_ref(),
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() > 0)
    }

    #[tracing::instrument(skip(self), err)]
    async fn begin_auto_import(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
    ) -> Result<Option<Vec<ImportEntity>>> {
        let mut transaction = self.pool.begin().await?;
        let claimed = sqlx::query_scalar!(
            r#"
            UPDATE import_run
            SET status = 'importing', error = NULL, updated_at = NOW()
            WHERE user_id = $1 AND source = $2
              AND status = 'ready' AND auto_import
            RETURNING source
            "#,
            user.as_ref(),
            source.as_ref(),
        )
        .fetch_optional(&mut *transaction)
        .await?;
        if claimed.is_none() {
            return Ok(None);
        }

        let rows = sqlx::query_as!(
            ImportEntityDbRow,
            r#"
            UPDATE import_entity
            SET status = 'importing', last_error = NULL, updated_at = NOW()
            WHERE user_id = $1 AND source = $2
              AND initiator = 'onboarding' AND status = 'staged'
            RETURNING id, user_id, team_id, source, foreign_id, status, initiator,
                      metadata, entity_id, entity_type, last_error, created_at, updated_at
            "#,
            user.as_ref(),
            source.as_ref(),
        )
        .fetch_all(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(Some(
            rows.into_iter()
                .map(ImportEntity::try_from)
                .collect::<Result<Vec<_>>>()?,
        ))
    }

    #[tracing::instrument(skip(self, ids), fields(count = ids.len()), err)]
    async fn finish_auto_import(
        &self,
        user: &MacroUserIdStr<'static>,
        source: ImportSource,
        ids: &[Uuid],
    ) -> Result<Option<RunStatus>> {
        let status = sqlx::query_scalar!(
            r#"
            WITH outcome AS (
                SELECT
                    COUNT(*) FILTER (WHERE status = 'imported')
                        = CARDINALITY($3::uuid[])::bigint AS succeeded
                FROM import_entity
                WHERE user_id = $1 AND id = ANY($3::uuid[])
            )
            UPDATE import_run
            SET status = (CASE
                    WHEN outcome.succeeded THEN 'completed'
                    ELSE 'failed'
                END)::import_run_status,
                error = CASE
                    WHEN outcome.succeeded THEN NULL
                    ELSE 'one or more automatic imports failed'
                END,
                updated_at = NOW()
            FROM outcome
            WHERE user_id = $1 AND source = $2 AND status = 'importing'
            RETURNING import_run.status::text AS "status!"
            "#,
            user.as_ref(),
            source.as_ref(),
            ids,
        )
        .fetch_optional(&self.pool)
        .await?;
        status
            .map(|status| {
                RunStatus::from_str(&status)
                    .map_err(|_| anyhow::anyhow!("unknown run status: {status}").into())
            })
            .transpose()
    }

    #[tracing::instrument(skip(self), err)]
    async fn reconcile_auto_import_runs(&self, user: &MacroUserIdStr<'static>) -> Result<u64> {
        let result = sqlx::query!(
            r#"
            WITH settled AS (
                SELECT
                    run.source,
                    EXISTS (
                        SELECT 1
                        FROM import_entity entity
                        WHERE entity.user_id = run.user_id
                          AND entity.source = run.source
                          AND entity.initiator = 'onboarding'
                          AND entity.status = 'staged'
                          AND entity.last_error IS NOT NULL
                    ) AS failed
                FROM import_run run
                WHERE run.user_id = $1
                  AND run.status = 'importing'
                  AND run.auto_import
                  AND NOT EXISTS (
                      SELECT 1
                      FROM import_entity entity
                      WHERE entity.user_id = run.user_id
                        AND entity.source = run.source
                        AND entity.initiator = 'onboarding'
                        AND entity.status = 'importing'
                  )
            )
            UPDATE import_run run
            SET status = (
                    CASE WHEN settled.failed THEN 'failed' ELSE 'completed' END
                )::import_run_status,
                error = CASE
                    WHEN settled.failed THEN 'one or more automatic imports failed'
                    ELSE NULL
                END,
                updated_at = NOW()
            FROM settled
            WHERE run.user_id = $1
              AND run.source = settled.source
              AND run.status = 'importing'
            "#,
            user.as_ref(),
        )
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected())
    }
}
