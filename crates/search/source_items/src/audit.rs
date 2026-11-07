//! Compares `source_items` with the rows its inputs imply.

use sqlx::PgPool;

/// How many rows differ between `source_items` and its inputs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Mismatches {
    /// Rows the inputs imply that the table lacks or holds with other values.
    pub missing_or_wrong: i64,
    /// Rows the table holds that the inputs do not imply, or hold with other values.
    pub extra_or_wrong: i64,
}

impl Mismatches {
    /// Whether the table matches its inputs exactly.
    pub fn is_empty(&self) -> bool {
        self.missing_or_wrong == 0 && self.extra_or_wrong == 0
    }
}

/// Reads the whole table and its inputs in one read-only snapshot, so writes committing during
/// the audit are not reported as drift.
pub async fn run(pool: &PgPool) -> Result<Mismatches, sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query!("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY")
        .execute(&mut *tx)
        .await?;
    let row = sqlx::query_file!("src/audit.sql")
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(Mismatches {
        missing_or_wrong: row.missing_or_wrong,
        extra_or_wrong: row.extra_or_wrong,
    })
}
