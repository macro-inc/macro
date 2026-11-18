//! Fills `source_items` for items that predate its triggers.

use model_entity::EntityType;
use sqlx::PgPool;
use std::time::Duration;

const BATCH_SIZE: i64 = 500;
/// Attempts per batch before a lock timeout, deadlock, or serialization failure
/// stops the run. A batch that stays blocked this long needs an operator.
const MAX_ATTEMPTS: u32 = 30;

/// What a backfill did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Backfill {
    /// How many item keys it rewrote.
    pub items: u64,
    /// Whether reads may now trust the table: maintenance was on for the whole run, so every
    /// write since its start kept rows current.
    pub readable: bool,
}

/// Rewrites the rows of every document, chat and project, and of every id the table holds, in
/// committed batches through the function the triggers use. Safe to interrupt and rerun while
/// writers run: each batch locks its items like a grant change does. When maintenance was on
/// from start to end, records that reads may trust the table.
pub async fn run(pool: &PgPool) -> Result<Backfill, sqlx::Error> {
    let maintained_since = sqlx::query_scalar!("SELECT maintained_since FROM source_items_control")
        .fetch_one(pool)
        .await?;
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
                sqlx::query_file_scalar!("src/next_ids.sql", kind.as_ref(), cursor, BATCH_SIZE)
                    .fetch_all(&mut *tx)
                    .await?;
            if ids.is_empty() {
                break;
            }
            let refreshed = sqlx::query!(
                r#"SELECT 1 AS "refreshed!" FROM source_items_refresh($1, $2)"#,
                kind.as_ref(),
                &ids,
            )
            .fetch_one(&mut *tx)
            .await;
            if let Err(error) = refreshed {
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
            tracing::info!(%kind, %cursor, total, "backfilled source items");
        }
    }
    sqlx::query!("ANALYZE source_items").execute(pool).await?;
    let readable = match maintained_since {
        Some(since) => sqlx::query_scalar!(
            r#"SELECT source_items_mark_backfilled($1) AS "marked""#,
            since
        )
        .fetch_one(pool)
        .await?
        .unwrap_or(false),
        None => false,
    };
    Ok(Backfill {
        items: total,
        readable,
    })
}
