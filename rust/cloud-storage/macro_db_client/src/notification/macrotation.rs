use sqlx::{Pool, Postgres};

/// Gets all users that need to be notified for a macrotation
/// This does not include the owner of the macrotation
#[tracing::instrument(skip(db))]
pub async fn get_macrotation_notification_users(
    db: Pool<Postgres>,
    macrotation_id: &str,
) -> anyhow::Result<Vec<String>> {
    let users = sqlx::query!(
        r#"
        SELECT
            u."id" as id
            FROM "Macrotation" ma
            INNER JOIN "Document" d ON d.id = ma."documentId"
            INNER JOIN "UserHistory" uh ON uh."itemId" = d."id" AND uh."itemType" = 'document'
            INNER JOIN "User" u ON u.id = uh."userId"
            WHERE ma.id = $1 AND u.id != ma."userId"
        "#,
        macrotation_id
    )
    .map(|row| row.id)
    .fetch_all(&db)
    .await?;

    Ok(users)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("macrotations")))]
    async fn test_get_macrotation_notification_users(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let users = get_macrotation_notification_users(pool.clone(), "macrotation-one").await?;

        assert_eq!(users, vec!["macro|user2@user.com"]);
        Ok(())
    }
}
