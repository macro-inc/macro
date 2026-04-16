use std::str::FromStr;

use anyhow::Context;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use sqlx::{Postgres, Transaction};

/// Deletes all user access records for a specific item
#[tracing::instrument(skip(transaction))]
pub async fn delete_user_entity_access_by_item(
    transaction: &mut Transaction<'_, Postgres>,
    entity_id: &uuid::Uuid,
    entity_type: EntityType,
) -> anyhow::Result<u64> {
    let result = sqlx::query!(
        r#"
        DELETE FROM "entity_access"
        WHERE "entity_id" = $1 AND "entity_type" = $2
        "#,
        entity_id,
        entity_type.as_ref(),
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(result.rows_affected())
}
/// Deletes all user access records for a specific item
#[tracing::instrument(skip(transaction))]
pub async fn delete_user_item_access_by_item(
    transaction: &mut Transaction<'_, Postgres>,
    item_id: &str,
    item_type: &str,
) -> anyhow::Result<u64> {
    let entity_id = macro_uuid::string_to_uuid(item_id)?;
    let entity_type = EntityType::from_str(item_type)
        .map_err(|e| anyhow::anyhow!("Invalid item_type '{}': {}", item_type, e))?;

    delete_user_entity_access_by_item(transaction, &entity_id, entity_type).await
}

#[tracing::instrument(skip(transaction))]
pub async fn delete_user_item_access_bulk(
    transaction: &mut Transaction<'_, Postgres>,
    item_ids: &[String],
    item_type: &str,
) -> anyhow::Result<u64> {
    if item_ids.is_empty() {
        return Ok(0);
    }

    let entity_type = EntityType::from_str(item_type)
        .map_err(|e| anyhow::anyhow!("Invalid item_type '{}': {}", item_type, e))?;
    let entity_ids: Vec<uuid::Uuid> = item_ids
        .iter()
        .map(|id| macro_uuid::string_to_uuid(id))
        .collect::<anyhow::Result<Vec<_>>>()?;

    delete_user_entity_access_bulk(transaction, &entity_ids, entity_type).await
}

#[tracing::instrument(skip(transaction))]
pub async fn delete_user_entity_access_bulk(
    transaction: &mut Transaction<'_, Postgres>,
    entity_ids: &[uuid::Uuid],
    entity_type: EntityType,
) -> anyhow::Result<u64> {
    if entity_ids.is_empty() {
        return Ok(0);
    }

    let result = match entity_type {
        EntityType::User | EntityType::Team | EntityType::Channel => {
            anyhow::bail!("invalid entity type")
        }
        EntityType::Project => {
            sqlx::query!(
                r#"
        DELETE FROM "entity_access"
        WHERE (entity_id = ANY($1) AND entity_type = $2)
        OR granted_from_project_id = ANY($3)
        "#,
                entity_ids,
                entity_type.as_ref(),
                &entity_ids
                    .iter()
                    .map(|p| p.to_string())
                    .collect::<Vec<String>>()
            )
            .execute(transaction.as_mut())
            .await?
        }
        EntityType::Chat | EntityType::Document | EntityType::EmailThread | EntityType::Call => {
            sqlx::query!(
                r#"
        DELETE FROM "entity_access"
        WHERE entity_id = ANY($1) AND entity_type = $2
        "#,
                entity_ids,
                entity_type.as_ref(),
            )
            .execute(transaction.as_mut())
            .await?
        }
    };

    Ok(result.rows_affected())
}

/// Deletes a specific user's access to an item
#[tracing::instrument(skip(transaction))]
pub async fn delete_user_item_access(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: &str,
    item_id: &str,
    item_type: &str,
) -> anyhow::Result<u64> {
    let entity_id = macro_uuid::string_to_uuid(item_id)?;

    let result = sqlx::query!(
        r#"
        DELETE FROM entity_access
        WHERE entity_id = $1 AND entity_type = $2 AND source_id = $3 AND source_type = 'user'
        "#,
        entity_id,
        item_type,
        user_id,
    )
    .execute(transaction.as_mut())
    .await
    .with_context(|| {
        format!(
            "Failed to delete access for user {} to item {}",
            user_id, item_id
        )
    })?;

    Ok(result.rows_affected())
}

#[tracing::instrument(skip_all)]
pub async fn delete_user_item_access_by_users_and_channel(
    executor: impl sqlx::Executor<'_, Database = Postgres>,
    user_ids: &[MacroUserIdStr<'_>],
    item_id: &str,
    item_type: &str,
    _granted_from_channel_id: uuid::Uuid,
) -> anyhow::Result<u64> {
    if user_ids.is_empty() {
        return Ok(0);
    }

    let entity_id = macro_uuid::string_to_uuid(item_id)?;
    let source_ids: Vec<String> = user_ids.iter().map(|s| s.to_string()).collect();

    let result = sqlx::query!(
        r#"
        DELETE FROM entity_access
        WHERE source_id = ANY($1) AND entity_id = $2 AND entity_type = $3 AND source_type = 'user'
        "#,
        source_ids.as_slice(),
        entity_id,
        item_type,
    )
    .execute(executor)
    .await
    .with_context(|| {
        format!(
            "Failed to delete access for users to item {}",
            item_id
        )
    })?;

    Ok(result.rows_affected())
}

#[tracing::instrument(skip(transaction))]
pub async fn delete_user_item_access_by_channel(
    transaction: &mut Transaction<'_, Postgres>,
    channel_id: uuid::Uuid,
) -> anyhow::Result<u64> {
    let source_id = channel_id.to_string();

    let result = sqlx::query!(
        r#"
        DELETE FROM entity_access
        WHERE source_id = $1 AND source_type = 'channel'
        "#,
        source_id,
    )
    .execute(transaction.as_mut())
    .await
    .with_context(|| {
        format!(
            "Failed to delete access records from channel {}",
            channel_id
        )
    })?;

    Ok(result.rows_affected())
}

/// In the entity_access model, channel-based access is represented by rows with
/// source_type='channel' and source_id=channel_id. When users leave a channel,
/// access is resolved at query time through channel membership rather than by
/// deleting per-user rows. This function is kept for API compatibility but is a
/// no-op.
///
/// TODO(entity_access migration): If per-user rows granted from a channel need
/// cleanup, a new mechanism to identify them is required since entity_access has
/// no granted_from_channel_id column.
#[tracing::instrument(skip(db))]
pub async fn delete_user_item_access_by_channel_and_users(
    db: &sqlx::Pool<sqlx::Postgres>,
    channel_id: uuid::Uuid,
    user_ids: &[String],
) -> anyhow::Result<u64> {
    if user_ids.is_empty() {
        return Ok(0);
    }

    tracing::warn!(
        %channel_id,
        user_count = user_ids.len(),
        "delete_user_item_access_by_channel_and_users is a no-op in the entity_access model; \
         channel-based access is resolved through membership at query time"
    );

    // Suppress unused parameter warnings
    let _ = db;

    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_item_access.sql")))]
    async fn test_delete_user_item_access(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let user_id = "macro|test-user@test.com";
        let item_id = "00000000-0000-0000-0000-000000000001";
        let item_type = "document";

        let mut transaction = pool.begin().await?;

        // Delete the record
        let affected =
            delete_user_item_access(&mut transaction, user_id, item_id, item_type).await?;

        assert_eq!(affected, 1, "Should have deleted exactly one record");

        let entity_id = macro_uuid::string_to_uuid(item_id)?;

        // Verify it's gone
        let result = sqlx::query!(
            r#"
            SELECT COUNT(*) as count
            FROM entity_access
            WHERE source_id = $1 AND entity_id = $2 AND entity_type = $3 AND source_type = 'user'
            "#,
            user_id,
            entity_id,
            item_type
        )
        .fetch_one(&mut *transaction)
        .await?;

        assert_eq!(result.count.unwrap(), 0);

        transaction.commit().await?;

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_item_access.sql")))]
    async fn test_delete_user_item_access_by_item(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let item_id = "00000000-0000-0000-0000-000000000002";
        let item_type = "document";

        let mut transaction = pool.begin().await?;

        // Delete all records for the item
        let affected =
            delete_user_item_access_by_item(&mut transaction, item_id, item_type).await?;

        assert_eq!(affected, 3, "Should have deleted all three records");

        let entity_id = macro_uuid::string_to_uuid(item_id)?;

        // Verify they're all gone
        let result = sqlx::query!(
            r#"
            SELECT COUNT(*) as count
            FROM entity_access
            WHERE entity_id = $1 AND entity_type = $2
            "#,
            entity_id,
            item_type
        )
        .fetch_one(&mut *transaction)
        .await?;

        assert_eq!(result.count.unwrap(), 0);

        transaction.commit().await?;

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_item_access.sql")))]
    async fn test_delete_user_item_access_bulk(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let item_type = "document";
        let item_ids = vec![
            "00000000-0000-0000-0000-000000000003".to_string(),
            "00000000-0000-0000-0000-000000000004".to_string(),
            "00000000-0000-0000-0000-000000000005".to_string(),
        ];

        let mut transaction = pool.begin().await?;

        // Delete all records for the items
        let affected = delete_user_item_access_bulk(&mut transaction, &item_ids, item_type).await?;

        assert_eq!(
            affected, 6,
            "Should have deleted all six records (2 users × 3 items)"
        );

        let entity_ids: Vec<uuid::Uuid> = item_ids
            .iter()
            .map(|id| macro_uuid::string_to_uuid(id).unwrap())
            .collect();

        // Verify they're all gone
        let result = sqlx::query!(
            r#"
            SELECT COUNT(*) as count
            FROM entity_access
            WHERE entity_id = ANY($1) AND entity_type = $2
            "#,
            &entity_ids,
            item_type
        )
        .fetch_one(&mut *transaction)
        .await?;

        assert_eq!(result.count.unwrap(), 0);

        transaction.commit().await?;

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_item_access.sql")))]
    async fn test_delete_user_item_access_bulk_empty(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let mut transaction = pool.begin().await?;

        // Test with empty array
        let affected = delete_user_item_access_bulk(&mut transaction, &[], "document").await?;

        assert_eq!(affected, 0, "Should return 0 for empty array");

        transaction.commit().await?;

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_item_access.sql")))]
    async fn test_delete_user_item_access_by_users_and_channel(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let item_id = "f0000000-0000-0000-0000-000000000001";
        let item_type = "document";
        let channel_id = uuid::Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
        let entity_id = macro_uuid::string_to_uuid(item_id)?;
        let user_ids = vec![
            MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap(),
            MacroUserIdStr::parse_from_str("macro|user2@test.com").unwrap(),
        ];

        // First ensure test data exists in entity_access
        for user_id in &user_ids {
            sqlx::query!(
                r#"
                INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
                VALUES ($1, $2, $3, 'user', 'view')
                ON CONFLICT (entity_id, entity_type, source_id, source_type)
                WHERE granted_from_project_id IS NULL
                DO NOTHING
                "#,
                entity_id,
                item_type,
                user_id.as_ref(),
            )
            .execute(&pool)
            .await?;
        }

        // Delete the records
        let affected = delete_user_item_access_by_users_and_channel(
            &pool, &user_ids, item_id, item_type, channel_id,
        )
        .await?;

        assert_eq!(affected, 2, "Should have deleted exactly two records");

        let ids: Vec<_> = user_ids.iter().map(|x| x.to_string()).collect();

        // Verify they're gone
        let result = sqlx::query!(
            r#"
            SELECT COUNT(*) as count
            FROM entity_access
            WHERE source_id = ANY($1) AND entity_id = $2 AND entity_type = $3 AND source_type = 'user'
            "#,
            &ids,
            entity_id,
            item_type,
        )
        .fetch_one(&pool)
        .await?;

        assert_eq!(result.count.unwrap(), 0);

        Ok(())
    }
    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_item_access.sql")))]
    async fn test_delete_user_item_access_by_channel(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let channel_id = uuid::Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
        let source_id = channel_id.to_string();

        // First ensure test data exists in entity_access with source_type='channel'
        let test_entity_ids = vec![
            uuid::Uuid::parse_str("f1000000-0000-0000-0000-000000000001")?,
            uuid::Uuid::parse_str("f1000000-0000-0000-0000-000000000002")?,
        ];

        for entity_id in &test_entity_ids {
            sqlx::query!(
                r#"
                INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
                VALUES ($1, 'document', $2, 'channel', 'view')
                ON CONFLICT (entity_id, entity_type, source_id, source_type)
                WHERE granted_from_project_id IS NULL
                DO NOTHING
                "#,
                entity_id,
                source_id,
            )
            .execute(&pool)
            .await?;
        }

        // Count how many records we expect to delete
        let count_before = sqlx::query!(
            r#"
        SELECT COUNT(*) as count
        FROM entity_access
        WHERE source_id = $1 AND source_type = 'channel'
        "#,
            source_id
        )
        .fetch_one(&pool)
        .await?
        .count
        .unwrap_or(0);

        assert!(count_before > 0, "Test data should exist before deletion");

        let mut transaction = pool.begin().await?;

        // Delete all records for the channel
        let affected = delete_user_item_access_by_channel(&mut transaction, channel_id).await?;

        assert_eq!(
            affected, count_before as u64,
            "Should have deleted all records from the channel"
        );

        // Verify they're all gone
        let result = sqlx::query!(
            r#"
        SELECT COUNT(*) as count
        FROM entity_access
        WHERE source_id = $1 AND source_type = 'channel'
        "#,
            source_id
        )
        .fetch_one(&mut *transaction)
        .await?;

        assert_eq!(
            result.count.unwrap(),
            0,
            "No records should remain for this channel"
        );

        transaction.commit().await?;

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_item_access.sql")))]
    async fn test_delete_user_item_access_by_channel_and_users(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let channel_id = uuid::Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
        let user_ids = vec!["user1".to_string(), "user2".to_string()];

        // This function is now a no-op in the entity_access model
        let affected =
            delete_user_item_access_by_channel_and_users(&pool, channel_id, &user_ids).await?;

        assert_eq!(
            affected, 0,
            "Should return 0 since this is a no-op in entity_access model"
        );

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_item_access.sql")))]
    async fn test_delete_user_item_access_by_channel_and_users_empty_users(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let channel_id = uuid::Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
        let empty_user_ids: Vec<String> = vec![];

        // Test with empty users array
        let affected =
            delete_user_item_access_by_channel_and_users(&pool, channel_id, &empty_user_ids)
                .await?;

        assert_eq!(affected, 0, "Should return 0 for empty users array");

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_item_access.sql")))]
    async fn test_delete_user_item_access_by_channel_and_users_nonexistent(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        // Test with non-existent channel and users
        let non_existent_channel = uuid::Uuid::parse_str("99999999-9999-9999-9999-999999999999")?;
        let non_existent_users = vec!["nonexistent1".to_string(), "nonexistent2".to_string()];

        let affected = delete_user_item_access_by_channel_and_users(
            &pool,
            non_existent_channel,
            &non_existent_users,
        )
        .await?;

        assert_eq!(
            affected, 0,
            "Should return 0 for non-existent channel and users"
        );

        Ok(())
    }
}
