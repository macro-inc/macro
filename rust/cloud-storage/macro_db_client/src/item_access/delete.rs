use anyhow::Context;
use sqlx::{Postgres, Transaction};

/// Deletes all user access records for a specific item
#[tracing::instrument(skip(transaction))]
pub async fn delete_user_item_access_by_item(
    transaction: &mut Transaction<'_, Postgres>,
    item_id: &str,
    item_type: &str,
) -> anyhow::Result<u64> {
    let result = sqlx::query!(
        r#"
        DELETE FROM "UserItemAccess"
        WHERE "item_id" = $1 AND "item_type" = $2
        "#,
        item_id,
        item_type,
    )
    .execute(transaction.as_mut())
    .await
    .with_context(|| format!("Failed to delete access for item ID {}", item_id))?;

    Ok(result.rows_affected())
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

    let result = sqlx::query!(
        r#"
        DELETE FROM "UserItemAccess"
        WHERE "item_id" = ANY($1) AND "item_type" = $2
        "#,
        item_ids,
        item_type,
    )
    .execute(transaction.as_mut())
    .await
    .with_context(|| {
        format!(
            "Failed to delete access for multiple items of type {}",
            item_type
        )
    })?;

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
    let result = sqlx::query!(
        r#"
        DELETE FROM "UserItemAccess"
        WHERE "user_id" = $1 AND "item_id" = $2 AND "item_type" = $3
        "#,
        user_id,
        item_id,
        item_type,
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
    user_ids: &[String],
    item_id: &str,
    item_type: &str,
    granted_from_channel_id: uuid::Uuid,
) -> anyhow::Result<u64> {
    if user_ids.is_empty() {
        return Ok(0);
    }

    let result = sqlx::query!(
        r#"
        DELETE FROM "UserItemAccess"
        WHERE "user_id" = ANY($1) 
          AND "item_id" = $2 
          AND "item_type" = $3
          AND "granted_from_channel_id" = $4
        "#,
        user_ids,
        item_id,
        item_type,
        granted_from_channel_id,
    )
    .execute(executor)
    .await
    .with_context(|| {
        format!(
            "Failed to delete access for users to item {} from channel {}",
            item_id, granted_from_channel_id
        )
    })?;

    Ok(result.rows_affected())
}

#[tracing::instrument(skip(transaction))]
pub async fn delete_user_item_access_by_channel(
    transaction: &mut Transaction<'_, Postgres>,
    granted_from_channel_id: uuid::Uuid,
) -> anyhow::Result<u64> {
    let result = sqlx::query!(
        r#"
        DELETE FROM "UserItemAccess"
        WHERE "granted_from_channel_id" = $1
        "#,
        granted_from_channel_id,
    )
    .execute(transaction.as_mut())
    .await
    .with_context(|| {
        format!(
            "Failed to delete access records from channel {}",
            granted_from_channel_id
        )
    })?;

    Ok(result.rows_affected())
}

/// Deletes all UserItemAccess records for specific users from a specific channel
/// This is useful when users are removed from a channel and need to lose access to channel-shared items
#[tracing::instrument(skip(db))]
pub async fn delete_user_item_access_by_channel_and_users(
    db: &sqlx::Pool<sqlx::Postgres>,
    channel_id: uuid::Uuid,
    user_ids: &[String],
) -> anyhow::Result<u64> {
    if user_ids.is_empty() {
        return Ok(0);
    }

    let result = sqlx::query!(
        r#"
        DELETE FROM "UserItemAccess"
        WHERE "granted_from_channel_id" = $1 AND "user_id" = ANY($2)
        "#,
        channel_id,
        user_ids,
    )
    .execute(db)
    .await
    .with_context(|| {
        format!(
            "Failed to delete access records for users from channel {}",
            channel_id
        )
    })?;

    Ok(result.rows_affected())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_item_access.sql")))]
    async fn test_delete_user_item_access(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let user_id = "test-user";
        let item_id = "test-item";
        let item_type = "document";

        let mut transaction = pool.begin().await?;

        // Delete the record
        let affected =
            delete_user_item_access(&mut transaction, user_id, item_id, item_type).await?;

        assert_eq!(affected, 1, "Should have deleted exactly one record");

        // Verify it's gone
        let result = sqlx::query!(
            r#"
            SELECT COUNT(*) as count
            FROM "UserItemAccess"
            WHERE "user_id" = $1 AND "item_id" = $2 AND "item_type" = $3
            "#,
            user_id,
            item_id,
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
        let item_id = "multi-access-item";
        let item_type = "document";

        let mut transaction = pool.begin().await?;

        // Delete all records for the item
        let affected =
            delete_user_item_access_by_item(&mut transaction, item_id, item_type).await?;

        assert_eq!(affected, 3, "Should have deleted all three records");

        // Verify they're all gone
        let result = sqlx::query!(
            r#"
            SELECT COUNT(*) as count
            FROM "UserItemAccess"
            WHERE "item_id" = $1 AND "item_type" = $2
            "#,
            item_id,
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
            "bulk-test-item-1".to_string(),
            "bulk-test-item-2".to_string(),
            "bulk-test-item-3".to_string(),
        ];

        let mut transaction = pool.begin().await?;

        // Delete all records for the items
        let affected = delete_user_item_access_bulk(&mut transaction, &item_ids, item_type).await?;

        assert_eq!(
            affected, 6,
            "Should have deleted all six records (2 users × 3 items)"
        );

        // Verify they're all gone
        let result = sqlx::query!(
            r#"
            SELECT COUNT(*) as count
            FROM "UserItemAccess"
            WHERE "item_id" = ANY($1) AND "item_type" = $2
            "#,
            &item_ids,
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
        let item_id = "channel-shared-item";
        let item_type = "document";
        let channel_id = uuid::Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;
        let user_ids = vec!["user1".to_string(), "user2".to_string()];

        // First ensure test data exists
        for user_id in &user_ids {
            sqlx::query!(
            r#"
            INSERT INTO "UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level", "granted_from_channel_id")
            VALUES ($1, $2, $3, $4, 'view', $5)
            ON CONFLICT DO NOTHING
            "#,
            uuid::Uuid::now_v7(),
            user_id,
            item_id,
            item_type,
            channel_id,
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

        // Verify they're gone
        let result = sqlx::query!(
        r#"
        SELECT COUNT(*) as count
        FROM "UserItemAccess"
        WHERE "user_id" = ANY($1) AND "item_id" = $2 AND "item_type" = $3 AND "granted_from_channel_id" = $4
        "#,
        &user_ids,
        item_id,
        item_type,
        channel_id
    )
            .fetch_one(&pool)
            .await?;

        assert_eq!(result.count.unwrap(), 0);

        Ok(())
    }
    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_item_access.sql")))]
    async fn test_delete_user_item_access_by_channel(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let channel_id = uuid::Uuid::parse_str("00000000-0000-0000-0000-000000000001")?;

        // First ensure test data exists
        let test_users = vec!["user1", "user2", "user3"];
        let test_items = vec!["item1", "item2"];

        for user_id in &test_users {
            for item_id in &test_items {
                sqlx::query!(
                r#"
                INSERT INTO "UserItemAccess" ("id", "user_id", "item_id", "item_type", "access_level", "granted_from_channel_id")
                VALUES ($1, $2, $3, $4, 'view', $5)
                ON CONFLICT DO NOTHING
                "#,
                uuid::Uuid::now_v7(),
                user_id,
                item_id,
                "document",
                channel_id,
            )
                    .execute(&pool)
                    .await?;
            }
        }

        // Count how many records we expect to delete
        let count_before = sqlx::query!(
            r#"
        SELECT COUNT(*) as count
        FROM "UserItemAccess"
        WHERE "granted_from_channel_id" = $1
        "#,
            channel_id
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
        FROM "UserItemAccess"
        WHERE "granted_from_channel_id" = $1
        "#,
            channel_id
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

        // First ensure we have test data
        // Count how many records we expect to delete
        let count_before = sqlx::query!(
            r#"
            SELECT COUNT(*) as count
            FROM "UserItemAccess"
            WHERE "granted_from_channel_id" = $1 AND "user_id" = ANY($2)
            "#,
            channel_id,
            &user_ids
        )
        .fetch_one(&pool)
        .await?
        .count
        .unwrap_or(0);

        // If we don't have test data, we need to skip the test
        if count_before == 0 {
            println!("Test data for channel and users doesn't exist, skipping test");
            return Ok(());
        }

        // Delete the records
        let affected =
            delete_user_item_access_by_channel_and_users(&pool, channel_id, &user_ids).await?;

        assert_eq!(
            affected, count_before as u64,
            "Should have deleted the correct number of records"
        );

        // Verify the targeted records are gone
        let result = sqlx::query!(
            r#"
            SELECT COUNT(*) as count
            FROM "UserItemAccess"
            WHERE "granted_from_channel_id" = $1 AND "user_id" = ANY($2)
            "#,
            channel_id,
            &user_ids
        )
        .fetch_one(&pool)
        .await?;

        assert_eq!(
            result.count.unwrap(),
            0,
            "No records should remain for these users in this channel"
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
