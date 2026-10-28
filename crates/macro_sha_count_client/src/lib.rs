#[cfg(test)]
mod test;

use std::collections::HashSet;

use anyhow::Context;
use model::document::SaveBomPart;
use sqlx::PgPool;

/// References to content-addressed docx parts. `"BomPart"` rows are the
/// references: a SHA is stored while any row names it, and a released SHA is
/// queued for `sha_cleanup_worker`, which deletes its object once no row does.
#[derive(Clone)]
pub struct ShaReferences {
    db: PgPool,
}

impl ShaReferences {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }

    /// Queues every SHA in `shas` for cleanup, such as the BOM of a deleted
    /// docx. Call it before or after the rows go: the worker recounts them.
    #[tracing::instrument(skip_all, fields(sha_count = shas.len()), err)]
    pub async fn release_shas(&self, shas: Vec<String>) -> anyhow::Result<()> {
        if shas.is_empty() {
            return Ok(());
        }
        sqlx::query!(
            r#"
            INSERT INTO sha_cleanup_queue (sha)
            SELECT DISTINCT sha FROM UNNEST($1::text[]) AS released(sha)
            ON CONFLICT (sha) DO UPDATE SET queued_at = now()
            "#,
            &shas
        )
        .execute(&self.db)
        .await
        .context("unable to queue released shas for cleanup")?;
        Ok(())
    }

    /// The parts of `bom_parts` whose SHA no `"BomPart"` row references yet,
    /// which the caller must upload.
    #[tracing::instrument(skip_all, fields(sha_count = bom_parts.len()), err)]
    pub async fn find_non_existing_shas(
        &self,
        bom_parts: &[SaveBomPart],
    ) -> anyhow::Result<Vec<SaveBomPart>> {
        let referenced = self
            .referenced(bom_parts.iter().map(|part| part.sha.clone()).collect())
            .await?;
        Ok(bom_parts
            .iter()
            .filter(|part| !referenced.contains(&part.sha))
            .cloned()
            .collect())
    }

    /// The SHAs in `shas` that no `"BomPart"` row references yet.
    #[tracing::instrument(skip_all, fields(sha_count = shas.len()), err)]
    pub async fn find_non_existing_shas_string(
        &self,
        shas: Vec<String>,
    ) -> anyhow::Result<Vec<String>> {
        let referenced = self.referenced(shas.clone()).await?;
        Ok(shas
            .into_iter()
            .filter(|sha| !referenced.contains(sha))
            .collect())
    }

    async fn referenced(&self, shas: Vec<String>) -> anyhow::Result<HashSet<String>> {
        if shas.is_empty() {
            return Ok(HashSet::new());
        }
        let rows = sqlx::query_scalar!(
            r#"SELECT DISTINCT sha AS "sha!" FROM "BomPart" WHERE sha = ANY($1)"#,
            &shas
        )
        .fetch_all(&self.db)
        .await
        .context("unable to look up referenced shas")?;
        Ok(rows.into_iter().collect())
    }
}
