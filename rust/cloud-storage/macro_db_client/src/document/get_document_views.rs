use sqlx::{Pool, Postgres};

#[tracing::instrument(skip(db))]
pub async fn get_document_views(
    db: &Pool<Postgres>,
    document_id: &str,
) -> anyhow::Result<Vec<String>> {
    let result = sqlx::query!(
        r#"
            SELECT
                u.email
            FROM "UserHistory" uh
            JOIN "User" u ON uh."userId" = u.id
            WHERE uh."itemId" = $1 AND uh."itemType" = 'document'
        "#,
        document_id,
    )
    .fetch_all(db)
    .await?;

    Ok(result.into_iter().map(|u| u.email).collect())
}

#[tracing::instrument(skip(db))]
pub async fn get_document_view_count(
    db: &Pool<Postgres>,
    document_id: &str,
) -> anyhow::Result<i64> {
    let result = sqlx::query!(
        r#"
            SELECT COUNT(*)
            FROM "DocumentView" dv
            WHERE dv."document_id" = $1
        "#,
        document_id,
    )
    .map(|r| r.count)
    .fetch_one(db)
    .await?;

    Ok(result.unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_history")))]
    async fn test_get_document_views(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let views = get_document_views(&pool, &"document-one").await?;

        assert_eq!(views.len(), 3);

        let views = get_document_views(&pool, &"document-two").await?;
        assert_eq!(views.len(), 0);

        Ok(())
    }
}
