//! Syncs in Postgres: `database_syncs`, and the rows each wrote in
//! `database_sync_rows`.

#[cfg(test)]
mod test;

use std::str::FromStr;

use chrono::{DateTime, Utc};
use import_notion::domain::model::NotionId;
use macro_user_id::user_id::MacroUserIdStr;
use models_databases::{DatabaseId, RowId, TableId};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{
    ClaimedSync, DatabaseSync, FinishedRun, NewSyncRecord, SourceKind, SyncFailure, SyncId,
    SyncSource, SyncStatus,
};
use crate::domain::plan::{Fingerprint, RowMapping};
use crate::domain::ports::DatabaseSyncsRepo;

/// [`DatabaseSyncsRepo`] over MacroDB.
#[derive(Debug, Clone)]
pub struct PgSyncsRepo {
    pool: PgPool,
}

impl PgSyncsRepo {
    /// Syncs kept in `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

/// `source_config` of a Notion sync.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct NotionConfig {
    data_source_id: NotionId,
}

/// `source_config` of a Granola sync: the creator's meetings, nothing more.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct GranolaConfig {}

fn stored_source(
    source: &SyncSource,
) -> Result<(SourceKind, serde_json::Value), rootcause::Report> {
    let config = match source {
        SyncSource::GranolaMeetings => serde_json::to_value(GranolaConfig {})?,
        SyncSource::NotionDataSource { data_source_id } => serde_json::to_value(NotionConfig {
            data_source_id: data_source_id.clone(),
        })?,
    };
    Ok((source.kind(), config))
}

fn read_source(kind: &str, config: serde_json::Value) -> Result<SyncSource, rootcause::Report> {
    Ok(match SourceKind::from_str(kind)? {
        SourceKind::GranolaMeetings => {
            let GranolaConfig {} = serde_json::from_value(config)?;
            SyncSource::GranolaMeetings
        }
        SourceKind::NotionDataSource => {
            let NotionConfig { data_source_id } = serde_json::from_value(config)?;
            SyncSource::NotionDataSource { data_source_id }
        }
    })
}

struct SyncRow {
    id: Uuid,
    database_id: Uuid,
    table_id: Uuid,
    created_by: String,
    source: String,
    source_config: serde_json::Value,
    columns: serde_json::Value,
    detached_columns: serde_json::Value,
    last_synced_at: Option<DateTime<Utc>>,
    last_failure: Option<String>,
    created_at: DateTime<Utc>,
}

impl TryFrom<SyncRow> for DatabaseSync {
    type Error = rootcause::Report;

    fn try_from(row: SyncRow) -> Result<Self, Self::Error> {
        let failure = row
            .last_failure
            .as_deref()
            .map(SyncFailure::from_str)
            .transpose()?;
        let status = match (failure, row.last_synced_at) {
            (Some(failure), _) => SyncStatus::Failed { failure },
            (None, Some(_)) => SyncStatus::Synced,
            (None, None) => SyncStatus::Pending,
        };
        Ok(Self {
            id: row.id,
            database_id: DatabaseId::from_uuid(row.database_id),
            table_id: TableId::from_uuid(row.table_id),
            created_by: MacroUserIdStr::try_from(row.created_by)
                .map_err(|error| rootcause::report!("stored creator is not a user id: {error}"))?,
            source: read_source(&row.source, row.source_config)?,
            columns: serde_json::from_value(row.columns)?,
            detached_columns: serde_json::from_value(row.detached_columns)?,
            status,
            last_synced_at: row.last_synced_at,
            created_at: row.created_at,
        })
    }
}

impl DatabaseSyncsRepo for PgSyncsRepo {
    #[tracing::instrument(skip_all, fields(sync_id = %sync.id), err)]
    async fn insert_sync(&self, sync: NewSyncRecord) -> Result<(), rootcause::Report> {
        let (kind, config) = stored_source(&sync.source)?;
        sqlx::query!(
            r#"
            INSERT INTO database_syncs
                (id, database_id, table_id, created_by, source, source_config, columns)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (id) DO NOTHING
            "#,
            sync.id,
            sync.database_id.as_uuid(),
            sync.table_id.as_uuid(),
            sync.created_by.as_ref(),
            kind.as_ref(),
            config,
            serde_json::to_value(&sync.columns)?,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn sync(&self, sync_id: SyncId) -> Result<Option<DatabaseSync>, rootcause::Report> {
        sqlx::query_as!(
            SyncRow,
            r#"
            SELECT id, database_id, table_id, created_by, source, source_config, columns,
                detached_columns, last_synced_at, last_failure, created_at
            FROM database_syncs
            WHERE id = $1
            "#,
            sync_id,
        )
        .fetch_optional(&self.pool)
        .await?
        .map(DatabaseSync::try_from)
        .transpose()
    }

    #[tracing::instrument(skip(self), err)]
    async fn database_syncs(
        &self,
        database_id: DatabaseId,
    ) -> Result<Vec<DatabaseSync>, rootcause::Report> {
        sqlx::query_as!(
            SyncRow,
            r#"
            SELECT id, database_id, table_id, created_by, source, source_config, columns,
                detached_columns, last_synced_at, last_failure, created_at
            FROM database_syncs
            WHERE database_id = $1
            ORDER BY created_at, id
            "#,
            database_id.as_uuid(),
        )
        .fetch_all(&self.pool)
        .await?
        .into_iter()
        .map(DatabaseSync::try_from)
        .collect()
    }

    #[tracing::instrument(skip(self), err)]
    async fn delete_sync(
        &self,
        database_id: DatabaseId,
        sync_id: SyncId,
    ) -> Result<bool, rootcause::Report> {
        let deleted = sqlx::query!(
            "DELETE FROM database_syncs WHERE id = $1 AND database_id = $2",
            sync_id,
            database_id.as_uuid(),
        )
        .execute(&self.pool)
        .await?;
        Ok(deleted.rows_affected() > 0)
    }

    #[tracing::instrument(skip(self), err)]
    async fn mark_due(
        &self,
        database_id: DatabaseId,
        sync_id: SyncId,
    ) -> Result<bool, rootcause::Report> {
        let marked = sqlx::query!(
            "UPDATE database_syncs SET due_at = now() WHERE id = $1 AND database_id = $2",
            sync_id,
            database_id.as_uuid(),
        )
        .execute(&self.pool)
        .await?;
        Ok(marked.rows_affected() > 0)
    }

    #[tracing::instrument(skip(self, created_by), err)]
    async fn mark_source_due(
        &self,
        created_by: &MacroUserIdStr<'static>,
        kind: SourceKind,
    ) -> Result<(), rootcause::Report> {
        sqlx::query!(
            "UPDATE database_syncs SET due_at = now() WHERE created_by = $1 AND source = $2",
            created_by.as_ref(),
            kind.as_ref(),
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn claim_due(
        &self,
        lease_for: std::time::Duration,
    ) -> Result<Option<ClaimedSync>, rootcause::Report> {
        let lease = macro_uuid::generate_uuid_v7();
        let row = sqlx::query_as!(
            SyncRow,
            r#"
            UPDATE database_syncs
            SET lease_id = $1,
                lease_expires_at = now() + make_interval(secs => $2),
                due_at = 'infinity'
            WHERE id = (
                SELECT id FROM database_syncs
                WHERE (lease_expires_at IS NULL AND due_at <= now())
                    OR lease_expires_at < now()
                ORDER BY due_at
                LIMIT 1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING id, database_id, table_id, created_by, source, source_config, columns,
                detached_columns, last_synced_at, last_failure, created_at
            "#,
            lease,
            lease_for.as_secs_f64(),
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| {
            Ok(ClaimedSync {
                sync: DatabaseSync::try_from(row)?,
                lease,
            })
        })
        .transpose()
    }

    #[tracing::instrument(skip(self), fields(rows), err)]
    async fn row_mappings(&self, sync_id: SyncId) -> Result<Vec<RowMapping>, rootcause::Report> {
        let rows = sqlx::query!(
            r#"
            SELECT external_id, row_id, fingerprint
            FROM database_sync_rows
            WHERE sync_id = $1
            "#,
            sync_id,
        )
        .fetch_all(&self.pool)
        .await?;
        tracing::Span::current().record("rows", rows.len());
        rows.into_iter()
            .map(|row| {
                let fingerprint = row
                    .fingerprint
                    .map(|bytes| {
                        Fingerprint::try_from(bytes.as_slice()).map_err(|_| {
                            rootcause::report!("a stored fingerprint is {} bytes", bytes.len())
                        })
                    })
                    .transpose()?;
                Ok(RowMapping {
                    external_id: row.external_id,
                    row_id: RowId::from_uuid(row.row_id),
                    fingerprint,
                })
            })
            .collect()
    }

    #[tracing::instrument(skip(self, rows), fields(rows = rows.len()), err)]
    async fn reserve_rows(
        &self,
        sync_id: SyncId,
        rows: &[(String, RowId)],
    ) -> Result<(), rootcause::Report> {
        let external_ids: Vec<String> = rows.iter().map(|(id, _)| id.clone()).collect();
        let row_ids: Vec<Uuid> = rows.iter().map(|(_, row)| row.into_uuid()).collect();
        sqlx::query!(
            r#"
            INSERT INTO database_sync_rows (sync_id, external_id, row_id)
            SELECT $1, external_id, row_id
            FROM UNNEST($2::text[], $3::uuid[]) AS reserved(external_id, row_id)
            ON CONFLICT (sync_id, external_id)
                DO UPDATE SET row_id = EXCLUDED.row_id, fingerprint = NULL
            "#,
            sync_id,
            &external_ids,
            &row_ids,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(skip(self, rows), fields(rows = rows.len()), err)]
    async fn record_rows(
        &self,
        sync_id: SyncId,
        rows: &[(String, RowId, Fingerprint)],
    ) -> Result<(), rootcause::Report> {
        let external_ids: Vec<String> = rows.iter().map(|(id, _, _)| id.clone()).collect();
        let row_ids: Vec<Uuid> = rows.iter().map(|(_, row, _)| row.into_uuid()).collect();
        let fingerprints: Vec<Vec<u8>> = rows
            .iter()
            .map(|(_, _, fingerprint)| fingerprint.to_vec())
            .collect();
        sqlx::query!(
            r#"
            INSERT INTO database_sync_rows (sync_id, external_id, row_id, fingerprint)
            SELECT $1, external_id, row_id, fingerprint
            FROM UNNEST($2::text[], $3::uuid[], $4::bytea[])
                AS written(external_id, row_id, fingerprint)
            ON CONFLICT (sync_id, external_id)
                DO UPDATE SET row_id = EXCLUDED.row_id, fingerprint = EXCLUDED.fingerprint
            "#,
            sync_id,
            &external_ids,
            &row_ids,
            &fingerprints,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(skip(self, external_ids), fields(rows = external_ids.len()), err)]
    async fn forget_rows(
        &self,
        sync_id: SyncId,
        external_ids: &[String],
    ) -> Result<(), rootcause::Report> {
        sqlx::query!(
            "DELETE FROM database_sync_rows WHERE sync_id = $1 AND external_id = ANY($2)",
            sync_id,
            external_ids,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(skip(self, run), err)]
    async fn finish(
        &self,
        sync_id: SyncId,
        lease: Uuid,
        run: FinishedRun,
    ) -> Result<bool, rootcause::Report> {
        let finished = sqlx::query!(
            r#"
            UPDATE database_syncs
            SET columns = $3,
                detached_columns = $4,
                last_failure = $5,
                last_synced_at = CASE WHEN $5::text IS NULL THEN now() ELSE last_synced_at END,
                due_at = LEAST(due_at, now() + make_interval(secs => $6)),
                lease_id = NULL,
                lease_expires_at = NULL
            WHERE id = $1 AND lease_id = $2
            "#,
            sync_id,
            lease,
            serde_json::to_value(&run.columns)?,
            serde_json::to_value(&run.detached_columns)?,
            run.failure.map(|failure| failure.as_ref().to_string()),
            run.next_run_in.as_secs_f64(),
        )
        .execute(&self.pool)
        .await?;
        Ok(finished.rows_affected() > 0)
    }
}
