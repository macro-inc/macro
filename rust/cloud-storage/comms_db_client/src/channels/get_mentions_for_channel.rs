use crate::model::MessageMention;
use sqlx::Executor;
use uuid::Uuid;

pub async fn get_mentions_for_channel<'e, E: Executor<'e, Database = sqlx::Postgres>>(
    executor: E,
    channel_id: &Uuid,
) -> anyhow::Result<Vec<MessageMention>> {
    let mentions = sqlx::query_as!(
        MessageMention,
        r#"
        SELECT
            e.source_entity_id::uuid as "message_id!: uuid::Uuid",
            e.entity_type as "entity_type!",
            e.entity_id as "entity_id!",
            e.created_at as "created_at!"
        FROM comms_entity_mentions e
        JOIN comms_messages m ON e.source_entity_id = m.id::text
        WHERE e.source_entity_type = 'message'
          AND m.channel_id = $1
          AND m.deleted_at IS NULL
        ORDER BY e.created_at DESC
        "#,
        channel_id
    )
    .fetch_all(executor)
    .await?;

    Ok(mentions)
}

#[cfg(test)]
mod tests {
    use super::*;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("mentions_extended"))
    )]
    async fn test_get_mentions_for_channel(pool: Pool<Postgres>) {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE
        let channel_id = uuid::uuid!("11111111-1111-1111-1111-111111111111");

        let mentions = get_mentions_for_channel(&pool, &channel_id).await.unwrap();

        assert_eq!(mentions.len(), 1);
        assert_eq!(
            mentions[0].message_id,
            uuid::uuid!("11111111-1111-1111-1111-111111111111")
        );
        assert_eq!(mentions[0].entity_type, "user");
        assert_eq!(mentions[0].entity_id, "user1");
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("mentions_extended"))
    )]
    async fn test_get_mentions_for_channel_no_mentions(pool: Pool<Postgres>) {
        let channel_id = uuid::uuid!("22222222-2222-2222-2222-222222222222");

        let mentions = get_mentions_for_channel(&pool, &channel_id).await.unwrap();

        assert_eq!(mentions.len(), 0);
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("mentions_extended"))
    )]
    async fn test_get_mentions_for_nonexistent_channel(pool: Pool<Postgres>) {
        let channel_id = uuid::uuid!("99999999-9999-9999-9999-999999999999");

        let mentions = get_mentions_for_channel(&pool, &channel_id).await.unwrap();

        assert_eq!(mentions.len(), 0);
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("mentions_extended"))
    )]
    async fn test_get_mentions_deleted_message(pool: Pool<Postgres>) {
        // Channel 4 has a deleted message with a mention
        let channel_id = uuid::uuid!("44444444-4444-4444-4444-444444444444");

        // Should not return mentions from deleted messages
        let mentions = get_mentions_for_channel(&pool, &channel_id).await.unwrap();

        assert_eq!(mentions.len(), 0);
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("mentions_extended"))
    )]
    async fn test_get_mentions_multiple_in_channel(pool: Pool<Postgres>) {
        // Channel 5 has multiple messages with mentions
        let channel_id = uuid::uuid!("55555555-5555-5555-5555-555555555555");

        let mentions = get_mentions_for_channel(&pool, &channel_id).await.unwrap();

        assert_eq!(mentions.len(), 2);

        // Check that mentions are ordered by created_at DESC (newest first)
        assert_eq!(
            mentions[0].message_id,
            uuid::uuid!("55555555-5555-5555-5555-555555555552")
        );
        assert_eq!(mentions[0].entity_type, "doc");
        assert_eq!(mentions[0].entity_id, "doc1");

        assert_eq!(
            mentions[1].message_id,
            uuid::uuid!("55555555-5555-5555-5555-555555555551")
        );
        assert_eq!(mentions[1].entity_type, "user");
        assert_eq!(mentions[1].entity_id, "user3");
    }
}
