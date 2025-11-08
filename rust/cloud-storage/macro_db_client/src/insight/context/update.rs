use sqlx::{Executor, Postgres};

#[tracing::instrument(skip(db))]
pub async fn mark_consumed<'e, E>(db: E, ids: &[String]) -> Result<(), sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query!(
        r#"
    UPDATE "InsightContext"
    SET consumed=true
    WHERE id = ANY($1)
  "#,
        ids
    )
    .execute(db)
    .await?;
    Ok(())
}
