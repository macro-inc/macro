use model::insight_context::ProvidedContext;
use sqlx::{Executor, Postgres};

#[tracing::instrument(skip(db))]
pub async fn create_insight_context<'e, E>(
    db: E,
    context: &ProvidedContext,
) -> Result<(), sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query!(
        r#"
    INSERT INTO "InsightContext" ("providerSource", "userId", "resourceId")
    VALUES ($1, $2, $3)
  "#,
        context.provider_source,
        context.user_id,
        context.resource_id
    )
    .execute(db)
    .await?;
    Ok(())
}
