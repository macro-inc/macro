use sqlx::{Pool, Postgres};

/// Deletes an item into the user's history
#[tracing::instrument(skip(db))]
pub async fn delete_user_history(
    db: &Pool<Postgres>,
    user_id: &str,
    item_id: &str,
    item_type: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"DELETE FROM "UserHistory" WHERE "userId" = $1 AND "itemId" = $2 AND "itemType" = $3"#,
        user_id,
        item_id,
        item_type,
    )
    .execute(db)
    .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_history")))]
    async fn test_delete_user_history(pool: Pool<Postgres>) {
        delete_user_history(&pool, "macro|user@user.com", "document-one", "document")
            .await
            .unwrap();

        let result = sqlx::query!(
            r#"
            SELECT "itemId" as item_id FROM "UserHistory" WHERE "userId" = $1 AND "itemId" = $2
            "#,
            "macro|user@user.com",
            "document-one"
        )
        .fetch_one(&pool.clone())
        .await;

        assert!(result.is_err());
    }
}
