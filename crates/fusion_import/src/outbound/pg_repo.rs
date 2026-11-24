//! The import ledger in MacroDB: `fusion_item` and `fusion_item_version`.
//! Every query is keyed by the primary keys' `(user_id, item_id)` prefix.

use std::str::FromStr;
use std::time::Duration;

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{
    ApsProjectId, InvalidApsId, ItemId, LinkState, RecordedVersion, TrackedItem, TrackedSummary,
    VersionId, VersionOutcome, VersionRecord,
};
use crate::domain::ports::{Claim, FusionRepo};

#[cfg(test)]
mod test;

/// Why a ledger read or write failed.
#[derive(Debug, thiserror::Error)]
pub enum FusionRepoError {
    /// The database failed.
    #[error("fusion ledger query failed: {0}")]
    Database(#[from] sqlx::Error),
    /// A row holds a value the import never writes.
    #[error("fusion ledger row is malformed: {0}")]
    Malformed(String),
}

impl From<InvalidApsId> for FusionRepoError {
    fn from(error: InvalidApsId) -> Self {
        Self::Malformed(error.to_string())
    }
}

fn link_state(raw: &str) -> Result<LinkState, FusionRepoError> {
    LinkState::from_str(raw).map_err(|_| FusionRepoError::Malformed(format!("state `{raw}`")))
}

fn malformed(what: &str) -> FusionRepoError {
    FusionRepoError::Malformed(what.to_owned())
}

/// The ledger over a MacroDB pool.
#[derive(Clone)]
pub struct PgFusionRepo {
    pool: PgPool,
}

impl PgFusionRepo {
    /// The ledger in `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    async fn find(
        &self,
        user: &MacroUserIdStr<'static>,
        item: &ItemId,
    ) -> Result<Option<TrackedItem>, FusionRepoError> {
        let row = sqlx::query!(
            r#"
            SELECT project_id, document_id, state
            FROM fusion_item
            WHERE user_id = $1 AND item_id = $2
            "#,
            user.as_ref(),
            item.as_str(),
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| {
            Ok(TrackedItem {
                item_id: item.clone(),
                project_id: ApsProjectId::parse(&row.project_id)?,
                document_id: row.document_id,
                state: link_state(&row.state)?,
            })
        })
        .transpose()
    }
}

impl FusionRepo for PgFusionRepo {
    type Err = FusionRepoError;

    #[tracing::instrument(skip_all, err)]
    async fn track(
        &self,
        user: &MacroUserIdStr<'static>,
        item: &ItemId,
        project: &ApsProjectId,
        document_id: Uuid,
    ) -> Result<TrackedItem, FusionRepoError> {
        // Two statements, not one: a second statement sees a row a racing
        // import committed while this insert waited on it.
        sqlx::query!(
            r#"
            INSERT INTO fusion_item (user_id, item_id, project_id, document_id)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (user_id, item_id) DO NOTHING
            "#,
            user.as_ref(),
            item.as_str(),
            project.as_str(),
            document_id,
        )
        .execute(&self.pool)
        .await?;
        self.find(user, item)
            .await?
            .ok_or_else(|| malformed("a tracked item vanished as it was tracked"))
    }

    #[tracing::instrument(skip_all, fields(item.count = items.len()), err)]
    async fn tracked(
        &self,
        user: &MacroUserIdStr<'static>,
        items: &[ItemId],
    ) -> Result<Vec<TrackedSummary>, FusionRepoError> {
        let ids: Vec<String> = items.iter().map(|item| item.as_str().to_owned()).collect();
        let rows = sqlx::query!(
            r#"
            SELECT
                item.item_id,
                item.project_id,
                item.document_id,
                item.state,
                (
                    SELECT count(*)
                    FROM fusion_item_version version
                    WHERE version.user_id = item.user_id
                      AND version.item_id = item.item_id
                      AND version.outcome = 'imported'
                ) AS "imported_versions!"
            FROM fusion_item item
            WHERE item.user_id = $1 AND item.item_id = ANY($2)
            "#,
            user.as_ref(),
            &ids,
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(TrackedSummary {
                    item: TrackedItem {
                        item_id: ItemId::parse(&row.item_id)?,
                        project_id: ApsProjectId::parse(&row.project_id)?,
                        document_id: row.document_id,
                        state: link_state(&row.state)?,
                    },
                    imported_versions: u32::try_from(row.imported_versions)
                        .map_err(|_| malformed("imported version count"))?,
                })
            })
            .collect()
    }

    #[tracing::instrument(skip_all, err)]
    async fn tracked_items(
        &self,
        user: &MacroUserIdStr<'static>,
        from: Option<&ItemId>,
        limit: usize,
    ) -> Result<Vec<TrackedItem>, FusionRepoError> {
        let limit = i64::try_from(limit).unwrap_or(i64::MAX);
        // Every id sorts at or after the empty string, so no cursor starts at
        // the first item and the scan stays an index range in every plan.
        let from = from.map(ItemId::as_str).unwrap_or("");
        let rows = sqlx::query!(
            r#"
            SELECT item_id, project_id, document_id, state
            FROM fusion_item
            WHERE user_id = $1 AND item_id >= $2
            ORDER BY item_id
            LIMIT $3
            "#,
            user.as_ref(),
            from,
            limit,
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(TrackedItem {
                    item_id: ItemId::parse(&row.item_id)?,
                    project_id: ApsProjectId::parse(&row.project_id)?,
                    document_id: row.document_id,
                    state: link_state(&row.state)?,
                })
            })
            .collect()
    }

    #[tracing::instrument(skip_all, err)]
    async fn claim(
        &self,
        user: &MacroUserIdStr<'static>,
        item: &ItemId,
        lease: Duration,
    ) -> Result<Option<Claim>, FusionRepoError> {
        let row = sqlx::query!(
            r#"
            UPDATE fusion_item
            SET sync_lease_until = now() + make_interval(secs => $3)
            WHERE user_id = $1
              AND item_id = $2
              AND (sync_lease_until IS NULL OR sync_lease_until < now())
            RETURNING project_id, document_id, state, sync_lease_until AS "sync_lease_until!"
            "#,
            user.as_ref(),
            item.as_str(),
            lease.as_secs_f64(),
        )
        .fetch_optional(&self.pool)
        .await?;
        row.map(|row| {
            Ok(Claim {
                item: TrackedItem {
                    item_id: item.clone(),
                    project_id: ApsProjectId::parse(&row.project_id)?,
                    document_id: row.document_id,
                    state: link_state(&row.state)?,
                },
                until: row.sync_lease_until,
            })
        })
        .transpose()
    }

    #[tracing::instrument(skip_all, err)]
    async fn release(
        &self,
        user: &MacroUserIdStr<'static>,
        claim: &Claim,
    ) -> Result<(), FusionRepoError> {
        sqlx::query!(
            r#"
            UPDATE fusion_item
            SET sync_lease_until = NULL, last_synced_at = now()
            WHERE user_id = $1 AND item_id = $2 AND sync_lease_until = $3
            "#,
            user.as_ref(),
            claim.item.item_id.as_str(),
            claim.until,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(skip_all, err)]
    async fn mark_linked(
        &self,
        user: &MacroUserIdStr<'static>,
        item: &ItemId,
    ) -> Result<(), FusionRepoError> {
        sqlx::query!(
            r#"
            UPDATE fusion_item
            SET state = 'linked'
            WHERE user_id = $1 AND item_id = $2
            "#,
            user.as_ref(),
            item.as_str(),
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    #[tracing::instrument(skip_all, err)]
    async fn relink(
        &self,
        user: &MacroUserIdStr<'static>,
        item: &ItemId,
        document_id: Uuid,
    ) -> Result<(), FusionRepoError> {
        let mut transaction = self.pool.begin().await?;
        sqlx::query!(
            r#"
            DELETE FROM fusion_item_version
            WHERE user_id = $1 AND item_id = $2
            "#,
            user.as_ref(),
            item.as_str(),
        )
        .execute(&mut *transaction)
        .await?;
        sqlx::query!(
            r#"
            UPDATE fusion_item
            SET document_id = $3, state = 'creating'
            WHERE user_id = $1 AND item_id = $2
            "#,
            user.as_ref(),
            item.as_str(),
            document_id,
        )
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(())
    }

    #[tracing::instrument(skip_all, err)]
    async fn recorded_versions(
        &self,
        user: &MacroUserIdStr<'static>,
        item: &ItemId,
    ) -> Result<Vec<RecordedVersion>, FusionRepoError> {
        let rows = sqlx::query!(
            r#"
            SELECT version_id, version_number, outcome, extension
            FROM fusion_item_version
            WHERE user_id = $1 AND item_id = $2
            "#,
            user.as_ref(),
            item.as_str(),
        )
        .fetch_all(&self.pool)
        .await?;
        rows.into_iter()
            .map(|row| {
                Ok(RecordedVersion {
                    version_id: VersionId::parse(&row.version_id)?,
                    number: u32::try_from(row.version_number)
                        .map_err(|_| malformed("version number"))?,
                    outcome: VersionOutcome::from_str(&row.outcome)
                        .map_err(|_| malformed("version outcome"))?,
                    extension: row.extension,
                })
            })
            .collect()
    }

    #[tracing::instrument(skip_all, err)]
    async fn record_version(
        &self,
        user: &MacroUserIdStr<'static>,
        item: &ItemId,
        version: &VersionRecord,
    ) -> Result<(), FusionRepoError> {
        let number = i32::try_from(version.number).map_err(|_| malformed("version number"))?;
        let size = version
            .size
            .map(i64::try_from)
            .transpose()
            .map_err(|_| malformed("size"))?;
        let outcome: &'static str = version.outcome.outcome().into();
        let created_at: Option<DateTime<Utc>> = version.created_at;
        sqlx::query!(
            r#"
            INSERT INTO fusion_item_version (
                user_id, item_id, version_id, version_number, outcome,
                document_instance_id, storage_size, extension, upstream_created_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            ON CONFLICT (user_id, item_id, version_id) DO NOTHING
            "#,
            user.as_ref(),
            item.as_str(),
            version.version_id.as_str(),
            number,
            outcome,
            version.outcome.document_version_id(),
            size,
            version.extension.as_deref(),
            created_at,
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
