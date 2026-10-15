//! Resumable reconciliation after all application writers have deployed.

use model_entity::EntityType;
use sqlx::PgPool;
use std::time::Duration;

const BATCH_SIZE: i64 = 500;
/// Attempts per batch before a lock timeout, deadlock, or serialization failure
/// stops the run. A batch that stays blocked this long needs an operator.
const MAX_ATTEMPTS: u32 = 30;

/// Reconcile canonical items and existing projection keys in committed batches.
/// Re-running starts from the beginning and is safe, including after old writers
/// deleted items during rollout. Projection-only IDs are reconciled to no rows.
pub async fn run(pool: &PgPool) -> Result<u64, sqlx::Error> {
    let mut total = 0;
    for kind in [EntityType::Chat, EntityType::Document, EntityType::Project] {
        let mut cursor = String::new();
        let mut attempts = 0;
        loop {
            let mut tx = pool.begin().await?;
            sqlx::query!("SET LOCAL lock_timeout = '200ms'")
                .execute(&mut *tx)
                .await?;
            let ids =
                sqlx::query_file_scalar!("src/next_ids.sql", kind.as_ref(), cursor, BATCH_SIZE,)
                    .fetch_all(&mut *tx)
                    .await?;
            if ids.is_empty() {
                break;
            }
            if let Err(error) = crate::sync_many(&mut tx, kind, &ids).await {
                let code = error
                    .as_database_error()
                    .and_then(|db| db.code())
                    .map(|code| code.into_owned());
                tx.rollback().await?;
                attempts += 1;
                if matches!(code.as_deref(), Some("55P03" | "40P01" | "40001"))
                    && attempts < MAX_ATTEMPTS
                {
                    tracing::warn!(%kind, %cursor, attempts, ?code, "source-item batch is contended; retrying");
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    continue;
                }
                return Err(error);
            }
            tx.commit().await?;
            attempts = 0;
            total += ids.len() as u64;
            cursor = ids.last().cloned().unwrap_or_default();
            tracing::info!(%kind, %cursor, total, "reconciled source items");
        }
    }
    sqlx::query!("ANALYZE source_items").execute(pool).await?;
    Ok(total)
}
