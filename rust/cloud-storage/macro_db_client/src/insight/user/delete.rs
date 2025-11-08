use sqlx::Executor;
use sqlx::error::Error;
use sqlx::postgres::Postgres;

#[tracing::instrument(skip(db))]
pub async fn delete_insights<'e, E>(db: E, ids: &Vec<String>) -> Result<(), Error>
where
    E: Executor<'e, Database = Postgres>,
{
    sqlx::query(
        r#"
        DELETE FROM "UserInsights"
        WHERE "id" = ANY($1)
    "#,
    )
    .bind(ids)
    .execute(db)
    .await?;
    Ok(())
}

pub async fn delete_user_insights<'e, E>(
    db: E,
    ids: &[String],
    user_id: &str,
) -> Result<Vec<String>, anyhow::Error>
where
    E: Executor<'e, Database = Postgres>,
{
    let records = sqlx::query!(
        r#"
        DELETE FROM "UserInsights"
        WHERE 
            "userId" = $1
        AND
            "id" = ANY($2)
        RETURNING
            "id"
        "#,
        user_id,
        ids
    )
    .fetch_all(db)
    .await?;

    let ids = records.into_iter().map(|r| r.id).collect();

    Ok(ids)
}
