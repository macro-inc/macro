use crate::model::EntityMention;
use anyhow::Result;
use sqlx::{Executor, Postgres};
use uuid::Uuid;

#[tracing::instrument(skip(executor))]
pub async fn get_entity_mention_by_id<'e, E>(executor: E, id: Uuid) -> Result<Option<EntityMention>>
where
    E: Executor<'e, Database = Postgres>,
{
    let entity_mention = sqlx::query_as!(
        EntityMention,
        r#"
        SELECT id, source_entity_type, source_entity_id, entity_type, entity_id, user_id, created_at
        FROM comms_entity_mentions
        WHERE id = $1
        "#,
        id,
    )
    .fetch_optional(executor)
    .await?;

    Ok(entity_mention)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::entity_mentions::create_entity_mention::{
        CreateEntityMentionOptions, create_entity_mention,
    };
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use sqlx::PgPool;

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "./../../fixtures", scripts("mentions"))
    )]
    async fn test_get_entity_mention_by_id(pool: PgPool) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE
        // Create an entity mention first
        let created_mention = create_entity_mention(
            &pool,
            CreateEntityMentionOptions {
                source_entity_type: "document".to_string(),
                source_entity_id: "doc123".to_string(),
                entity_type: "user".to_string(),
                entity_id: "user456".to_string(),
                user_id: None,
            },
        )
        .await?;

        // Fetch it by ID
        let fetched_mention = get_entity_mention_by_id(&pool, created_mention.id)
            .await?
            .expect("Mention should exist");

        assert_eq!(fetched_mention.id, created_mention.id);
        assert_eq!(fetched_mention.source_entity_type, "document");
        assert_eq!(fetched_mention.source_entity_id, "doc123");
        assert_eq!(fetched_mention.entity_type, "user");
        assert_eq!(fetched_mention.entity_id, "user456");

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "./../../fixtures", scripts("mentions"))
    )]
    async fn test_get_entity_mention_by_id_not_found(pool: PgPool) -> anyhow::Result<()> {
        let random_id = Uuid::new_v4();

        let result = get_entity_mention_by_id(&pool, random_id).await?;

        assert!(result.is_none());
        Ok(())
    }
}
