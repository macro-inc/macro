use lambda_runtime::tracing;

/// Gets all items for an organization that violate the retention policy
#[tracing::instrument(skip(db))]
pub async fn get_violating_items(
    db: &sqlx::Pool<sqlx::Postgres>,
    organization_id: i32,
    retention_days: i32,
) -> anyhow::Result<Vec<(String, String)>> {
    let documents = get_violating_documents(db, organization_id, retention_days).await?;
    let chats = get_violating_chats(db, organization_id, retention_days).await?;

    Ok(documents
        .into_iter()
        .map(|document| (document, "document".to_string()))
        .chain(chats.into_iter().map(|chat| (chat, "chat".to_string())))
        .collect())
}

/// Gets all documents for an organization that violate the retention policy
#[tracing::instrument(skip(db))]
pub async fn get_violating_documents(
    db: &sqlx::Pool<sqlx::Postgres>,
    organization_id: i32,
    retention_days: i32,
) -> anyhow::Result<Vec<String>> {
    let result = sqlx::query!(
        r#"
        SELECT 
            d.id
        FROM "Document" d
        JOIN "ItemLastAccessed" ila ON d.id = ila.item_id
        AND ila.item_type = 'document'
        AND ila.last_accessed < NOW() - ($2 || ' days')::INTERVAL
        WHERE d.owner IN (
            SELECT 
                u."id"
            FROM "User" u
            WHERE u."organizationId" = $1
        );
    "#,
        organization_id,
        retention_days.to_string()
    )
    .map(|row| row.id)
    .fetch_all(db)
    .await?;

    Ok(result)
}

/// Gets all chats for an organization that violate the retention policy
#[tracing::instrument(skip(db))]
pub async fn get_violating_chats(
    db: &sqlx::Pool<sqlx::Postgres>,
    organization_id: i32,
    retention_days: i32,
) -> anyhow::Result<Vec<String>> {
    let result = sqlx::query!(
        r#"
        SELECT 
            c.id
        FROM "Chat" c
        JOIN "ItemLastAccessed" ila ON c.id = ila.item_id
        AND ila.item_type = 'chat'
        AND ila.last_accessed < NOW() - ($2 || ' days')::INTERVAL
        WHERE c."userId" IN (
            SELECT 
                u."id"
            FROM "User" u
            WHERE u."organizationId" = $1
        );
    "#,
        organization_id,
        retention_days.to_string()
    )
    .map(|row| row.id)
    .fetch_all(db)
    .await?;

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[sqlx::test(fixtures(path = "../../../fixtures", scripts("testing")))]
    async fn test_get_violating_items(db: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
        let mut result = get_violating_items(&db, 1, 2).await?;
        result.sort();

        // Should only have 2 chats that violate
        assert_eq!(
            result,
            vec![
                ("c1".to_string(), "chat".to_string()),
                ("c2".to_string(), "chat".to_string()),
                ("d1".to_string(), "document".to_string()),
                ("d2".to_string(), "document".to_string()),
            ]
        );

        Ok(())
    }
}
