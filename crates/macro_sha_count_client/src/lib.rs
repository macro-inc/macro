#[cfg(test)]
mod test;

use anyhow::Context;
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
}
