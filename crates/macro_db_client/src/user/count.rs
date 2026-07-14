#[tracing::instrument(skip(db))]
pub async fn count_user_items(
    db: &sqlx::Pool<sqlx::Postgres>,
    user_id: &str,
    include_chats: bool,
) -> anyhow::Result<i64> {
    let documents: i64 = sqlx::query!(
        r#"
            SELECT COUNT(*) as "count"
            FROM "Document" d
            WHERE owner = $1 AND d."deletedAt" IS NULL
        "#,
        user_id
    )
    .map(|row| row.count.unwrap_or(0))
    .fetch_one(db)
    .await?;

    let chats = if include_chats {
        sqlx::query!(
            r#"
            SELECT COUNT(*) as "count"
            FROM "Chat" c
            WHERE c."userId" = $1 and c."deletedAt" IS NULL
        "#,
            user_id
        )
        .map(|row| row.count.unwrap_or(0))
        .fetch_one(db)
        .await?
    } else {
        0
    };

    // default to 0 if nothing is found
    Ok(documents + chats)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("count")))]
    async fn test_count_user_items(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let count = count_user_items(&pool, "macro|user@user.com", true).await?;

        assert_eq!(3, count);

        let count = count_user_items(&pool, "macro|user@user.com", false).await?;
        assert_eq!(1, count);

        Ok(())
    }
}
