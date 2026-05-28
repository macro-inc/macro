use crate::model::EntityMention;
use anyhow::Result;
use sqlx::{Executor, Postgres};

#[derive(Debug, Clone)]
pub struct CreateEntityMentionOptions {
    pub source_entity_type: String,
    pub source_entity_id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub user_id: Option<String>,
}

#[tracing::instrument(skip(executor))]
pub async fn create_entity_mention<'e, E>(
    executor: E,
    options: CreateEntityMentionOptions,
) -> Result<EntityMention>
where
    E: Executor<'e, Database = Postgres>,
{
    let id = macro_uuid::generate_uuid_v7();

    let entity_mention = sqlx::query_as!(
        EntityMention,
        r#"
        INSERT INTO comms_entity_mentions (id, source_entity_type, source_entity_id, entity_type, entity_id, user_id)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, source_entity_type, source_entity_id, entity_type, entity_id, user_id, created_at
        "#,
        id,
        options.source_entity_type,
        options.source_entity_id,
        options.entity_type,
        options.entity_id,
        options.user_id,
    )
    .fetch_one(executor)
    .await?;

    Ok(entity_mention)
}

#[cfg(test)]
mod tests {
    use super::*;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use sqlx::PgPool;
    use std::str::FromStr;
    use uuid::Uuid;

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "./../../fixtures", scripts("mentions"))
    )]
    async fn test_create_entity_mention(pool: PgPool) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE
        let message_id = Uuid::from_str("11111111-1111-1111-1111-111111111111")?;

        create_entity_mention(
            &pool,
            CreateEntityMentionOptions {
                source_entity_type: "message".to_string(),
                source_entity_id: message_id.to_string(),
                entity_type: "document".to_string(),
                entity_id: "doc123".to_string(),
                user_id: None,
            },
        )
        .await?;

        // Verify the mention was created
        let count = sqlx::query_scalar!(
            r#"
            SELECT COUNT(*) as "count!"
            FROM comms_entity_mentions
            WHERE source_entity_type = 'message'
              AND source_entity_id = $1
              AND entity_type = 'document'
              AND entity_id = 'doc123'
            "#,
            message_id.to_string()
        )
        .fetch_one(&pool)
        .await?;

        assert_eq!(count, 1);
        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "./../../fixtures", scripts("mentions"))
    )]
    async fn test_create_entity_mention_allows_duplicates(pool: PgPool) -> anyhow::Result<()> {
        let message_id = Uuid::from_str("11111111-1111-1111-1111-111111111111")?;
        let options = CreateEntityMentionOptions {
            source_entity_type: "message".to_string(),
            source_entity_id: message_id.to_string(),
            entity_type: "document".to_string(),
            entity_id: "doc456".to_string(),
            user_id: None,
        };

        // Create the mention twice
        create_entity_mention(&pool, options.clone()).await?;
        create_entity_mention(&pool, options).await?;

        // Should now have two mentions since duplicates are allowed
        let count = sqlx::query_scalar!(
            r#"
            SELECT COUNT(*) as "count!"
            FROM comms_entity_mentions
            WHERE source_entity_type = 'message'
              AND source_entity_id = $1
              AND entity_type = 'document'
              AND entity_id = 'doc456'
            "#,
            message_id.to_string()
        )
        .fetch_one(&pool)
        .await?;

        assert_eq!(count, 2);
        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "./../../fixtures", scripts("mentions"))
    )]
    async fn test_create_entity_mention_with_user_id(pool: PgPool) -> anyhow::Result<()> {
        let _message_id = Uuid::from_str("11111111-1111-1111-1111-111111111111")?;
        let user_id = "user123".to_string();

        let mention = create_entity_mention(
            &pool,
            CreateEntityMentionOptions {
                source_entity_type: "document".to_string(),
                source_entity_id: "doc789".to_string(),
                entity_type: "user".to_string(),
                entity_id: "user123".to_string(),
                user_id: Some(user_id.clone()),
            },
        )
        .await?;

        // Verify the mention was created with the user_id
        assert_eq!(mention.user_id, Some(user_id));
        assert_eq!(mention.source_entity_type, "document");
        assert_eq!(mention.source_entity_id, "doc789");
        assert_eq!(mention.entity_type, "user");
        assert_eq!(mention.entity_id, "user123");
        Ok(())
    }
}
