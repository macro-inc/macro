use anyhow::Result;
use sqlx::{Executor, Postgres};
use uuid::Uuid;

#[tracing::instrument(skip(executor))]
pub async fn delete_entity_mention_by_id<'e, E>(executor: E, id: Uuid) -> Result<bool>
where
    E: Executor<'e, Database = Postgres>,
{
    let result = sqlx::query!(
        r#"
        DELETE FROM comms_entity_mentions
        WHERE id = $1
        "#,
        id,
    )
    .execute(executor)
    .await?;

    Ok(result.rows_affected() > 0)
}

#[tracing::instrument(skip(executor))]
pub async fn delete_entity_mentions_by_entity<'e, E>(
    executor: E,
    entity_ids: Vec<String>,
    source_entity_id: String,
) -> Result<u64>
where
    E: Executor<'e, Database = Postgres>,
{
    if entity_ids.is_empty() {
        return Ok(0);
    }

    let result = sqlx::query!(
        r#"
        DELETE FROM comms_entity_mentions
        WHERE entity_id = ANY($1) AND source_entity_id = $2
        "#,
        &entity_ids,
        source_entity_id,
    )
    .execute(executor)
    .await?;

    tracing::debug!(
        entity_ids=?entity_ids,
        source_entity_id=%source_entity_id,
        rows_affected=%result.rows_affected(),
        "Deleted entity mentions matching entity_ids and source_entity_id"
    );

    Ok(result.rows_affected())
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
    async fn test_delete_entity_mention_by_id(pool: PgPool) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE
        // First create a mention
        let created_mention = create_entity_mention(
            &pool,
            CreateEntityMentionOptions {
                source_entity_type: "document".to_string(),
                source_entity_id: "doc123".to_string(),
                entity_type: "user".to_string(),
                entity_id: "user789".to_string(),
                user_id: None,
            },
        )
        .await?;

        // Delete it by ID
        let deleted = delete_entity_mention_by_id(&pool, created_mention.id).await?;
        assert!(deleted);

        // Verify it's gone
        let count = sqlx::query_scalar!(
            r#"
            SELECT COUNT(*) as "count!"
            FROM comms_entity_mentions
            WHERE id = $1
            "#,
            created_mention.id
        )
        .fetch_one(&pool)
        .await?;

        assert_eq!(count, 0);
        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "./../../fixtures", scripts("mentions"))
    )]
    async fn test_delete_entity_mention_by_id_nonexistent(pool: PgPool) -> anyhow::Result<()> {
        let random_id = Uuid::new_v4();

        // Try to delete a non-existent mention
        let deleted = delete_entity_mention_by_id(&pool, random_id).await?;

        assert!(!deleted);
        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "./../../fixtures", scripts("mentions"))
    )]
    async fn test_delete_entity_mentions_by_entity(pool: PgPool) -> anyhow::Result<()> {
        // Create test data with different entity_ids but same source_entity_id
        let source_entity_id = "doc123".to_string();
        let entity_ids = vec![
            "user1".to_string(),
            "user2".to_string(),
            "user3".to_string(),
        ];

        // Create mentions for each entity_id
        for entity_id in &entity_ids {
            // Create first mention
            let _mention = create_entity_mention(
                &pool,
                CreateEntityMentionOptions {
                    source_entity_type: "document".to_string(),
                    source_entity_id: source_entity_id.clone(),
                    entity_type: "user".to_string(),
                    entity_id: entity_id.clone(),
                    user_id: None,
                },
            )
            .await?;

            // Create duplicate mention to test multiple deletions per entity_id
            if entity_id == "user1" {
                let _duplicate = create_entity_mention(
                    &pool,
                    CreateEntityMentionOptions {
                        source_entity_type: "document".to_string(),
                        source_entity_id: source_entity_id.clone(),
                        entity_type: "user".to_string(),
                        entity_id: entity_id.clone(),
                        user_id: None,
                    },
                )
                .await?;
            }
        }

        // Create an additional mention with different source_entity_id that shouldn't be deleted
        let _other_mention = create_entity_mention(
            &pool,
            CreateEntityMentionOptions {
                source_entity_type: "document".to_string(),
                source_entity_id: "different_doc".to_string(),
                entity_type: "user".to_string(),
                entity_id: "user1".to_string(),
                user_id: None,
            },
        )
        .await?;

        // Delete only user1 and user2 mentions, leaving user3
        let deleted_count = delete_entity_mentions_by_entity(
            &pool,
            vec!["user1".to_string(), "user2".to_string()],
            source_entity_id.clone(),
        )
        .await?;

        // Should have deleted 3 mentions (2 for user1, 1 for user2)
        assert_eq!(deleted_count, 3);

        // Verify user1 and user2 mentions are gone for this source_entity_id
        let remaining_count = sqlx::query_scalar!(
            r#"
            SELECT COUNT(*) as "count!"
            FROM comms_entity_mentions
            WHERE entity_id IN ('user1', 'user2') AND source_entity_id = $1
            "#,
            source_entity_id
        )
        .fetch_one(&pool)
        .await?;

        assert_eq!(remaining_count, 0);

        // Verify user3 mention still exists
        let user3_count = sqlx::query_scalar!(
            r#"
            SELECT COUNT(*) as "count!"
            FROM comms_entity_mentions
            WHERE entity_id = 'user3' AND source_entity_id = $1
            "#,
            source_entity_id
        )
        .fetch_one(&pool)
        .await?;

        assert_eq!(user3_count, 1);

        // Verify the different source_entity_id mention wasn't deleted
        let other_count = sqlx::query_scalar!(
            r#"
            SELECT COUNT(*) as "count!"
            FROM comms_entity_mentions
            WHERE entity_id = 'user1' AND source_entity_id = 'different_doc'
            "#,
        )
        .fetch_one(&pool)
        .await?;

        assert_eq!(other_count, 1);

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "./../../fixtures", scripts("mentions"))
    )]
    async fn test_delete_entity_mentions_by_entity_empty_list(pool: PgPool) -> anyhow::Result<()> {
        // Should return early with 0 count when entity_ids is empty
        let deleted_count =
            delete_entity_mentions_by_entity(&pool, vec![], "doc123".to_string()).await?;

        assert_eq!(deleted_count, 0);
        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "./../../fixtures", scripts("mentions"))
    )]
    async fn test_delete_entity_mentions_by_entity_nonexistent(pool: PgPool) -> anyhow::Result<()> {
        // Try to delete non-existent mentions
        let deleted_count = delete_entity_mentions_by_entity(
            &pool,
            vec![
                "nonexistent_user1".to_string(),
                "nonexistent_user2".to_string(),
            ],
            "nonexistent_doc".to_string(),
        )
        .await?;

        assert_eq!(deleted_count, 0);
        Ok(())
    }
}
