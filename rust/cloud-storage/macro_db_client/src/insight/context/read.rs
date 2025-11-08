use model::insight_context::ProvidedContext;
use sqlx::{Executor, Postgres};

#[tracing::instrument(skip(db))]
pub async fn read_pending_context<'e, E>(
    db: E,
    source_name: &str,
    user_id: &str,
    limit: i64,
) -> Result<Vec<(String, ProvidedContext)>, sqlx::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    let context_records = sqlx::query!(
        r#"
      SELECT 
        "id",
        "providerSource" as provider_source, 
        "userId" as user_id,
        "resourceId" as resource_id
      FROM "InsightContext"
      WHERE
        "userId" = $1
      AND
        "providerSource" = $2
      AND
        "consumed" = false
      ORDER BY
        "createdAt" DESC
      LIMIT
        $3
      "#,
        user_id,
        source_name,
        limit
    )
    .fetch_all(db)
    .await?;

    let context = context_records
        .into_iter()
        .map(|record| {
            (
                record.id,
                ProvidedContext {
                    provider_source: record.provider_source,
                    resource_id: record.resource_id,
                    user_id: record.user_id,
                },
            )
        })
        .collect::<Vec<_>>();

    Ok(context)
}
