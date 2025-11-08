pub async fn get_channel_mentions_by_item(
    db: &sqlx::Pool<sqlx::Postgres>,
    item_id: &str,
    item_type: &str,
) -> anyhow::Result<Vec<String>> {
    let channel_ids = sqlx::query!(
        r#"
        SELECT DISTINCT m.channel_id
        FROM comms_entity_mentions em
        JOIN comms_messages m ON m.id::text = em.source_entity_id AND em.source_entity_type = 'message'
        JOIN comms_channels c ON c.id = m.channel_id
        WHERE em.entity_id = $1 AND em.entity_type = $2
        "#,
        item_id,
        item_type,
    )
    .map(|row| row.channel_id.to_string())
    .fetch_all(db)
    .await?;

    Ok(channel_ids)
}

#[cfg(test)]
mod tests {
    use super::*;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../fixtures", scripts("mentions"))
    )]
    async fn test_get_channel_mentions_by_item(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE
        let channel_ids = get_channel_mentions_by_item(&pool, "user1", "user").await?;
        assert_eq!(
            channel_ids,
            vec!["11111111-1111-1111-1111-111111111111".to_string()]
        );
        Ok(())
    }
}
