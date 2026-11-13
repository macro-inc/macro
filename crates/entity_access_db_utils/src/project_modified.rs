//! A folder's last-edited time, which moves when an item enters or leaves it.

use sqlx::{Postgres, Transaction};

/// Set `updatedAt` to now on each of `project_ids`, so the folders an item
/// left and joined rise in recently edited.
///
/// The time is taken when the update runs, not when the transaction began, and
/// never moves backward: a move that began first but waited on the guard must
/// not undo a later move's time.
#[tracing::instrument(skip(transaction), err)]
pub async fn bump_projects_modified(
    transaction: &mut Transaction<'_, Postgres>,
    project_ids: &[&str],
) -> Result<(), sqlx::Error> {
    for project_id in project_ids {
        sqlx::query!(
            r#"
            UPDATE "Project"
            SET "updatedAt" = GREATEST("updatedAt", clock_timestamp()::timestamp(3))
            WHERE id = $1
            "#,
            project_id,
        )
        .execute(transaction.as_mut())
        .await?;
    }
    Ok(())
}
