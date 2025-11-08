use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::user_item_access::UserItemAccess;
use sqlx::{Executor, Postgres, Transaction};
use uuid::Uuid;

#[tracing::instrument(skip(transaction))]
pub async fn insert_user_item_access(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: &str,
    item_id: &str,
    item_type: &str,
    access_level: AccessLevel,
    granted_from_channel_id: Option<Uuid>,
) -> anyhow::Result<()> {
    let id = macro_uuid::generate_uuid_v7();

    sqlx::query!(
        r#"
        INSERT INTO "UserItemAccess" (
            "id",
            "user_id",
            "item_id",
            "item_type",
            "access_level",
            "granted_from_channel_id",
            "created_at",
            "updated_at"
        )
        VALUES (
            $1,
            $2,
            $3,
            $4,
            $5,
            $6,
            NOW(),
            NOW()
        )
        "#,
        id,
        user_id,
        item_id,
        item_type,
        access_level as _,
        granted_from_channel_id
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}

#[tracing::instrument(skip(executor))]
pub async fn upsert_user_item_access_bulk<'e, E>(
    executor: E,
    user_ids: &[String],
    item_id: &str,
    item_type: &str,
    access_level: AccessLevel,
    granted_from_channel_id: Option<Uuid>,
) -> anyhow::Result<()>
where
    E: Executor<'e, Database = Postgres>,
{
    if user_ids.is_empty() {
        return Ok(());
    }

    // Generate UUIDs for each user
    let ids: Vec<Uuid> = user_ids
        .iter()
        .map(|_| macro_uuid::generate_uuid_v7())
        .collect();

    // Execute bulk insert using unnest with ON CONFLICT DO UPDATE
    sqlx::query!(
        r#"
        INSERT INTO "UserItemAccess" (
            "id",
            "user_id",
            "item_id",
            "item_type",
            "access_level",
            "granted_from_channel_id",
            "created_at",
            "updated_at"
        )
        SELECT 
            u.id, 
            u.user_id, 
            $1 as item_id, 
            $2 as item_type, 
            $3 as access_level,
            $4 as granted_from_channel_id,
            NOW() as created_at,
            NOW() as updated_at
        FROM UNNEST($5::uuid[], $6::text[]) as u(id, user_id)
        ON CONFLICT ("user_id", "item_id", "item_type", "granted_from_channel_id") DO UPDATE 
        SET 
            "access_level" = EXCLUDED."access_level",
            "updated_at" = NOW()
        "#,
        item_id,
        item_type,
        access_level as _,
        granted_from_channel_id,
        &ids,
        user_ids as &[String],
    )
    .execute(executor)
    .await?;

    Ok(())
}

/// Inserts multiple UserItemAccess records in a single database query
/// The created_at and updated_at fields from the structs are ignored and NOW() is used instead
#[tracing::instrument(skip(db, access_records))]
pub async fn insert_user_item_access_batch(
    db: &sqlx::PgPool,
    access_records: &[UserItemAccess],
) -> anyhow::Result<()> {
    if access_records.is_empty() {
        return Ok(());
    }

    // First, filter out records for users that don't exist
    // This query gets a list of user_ids that exist in the database
    let user_ids: Vec<String> = access_records
        .iter()
        .map(|record| record.user_id.clone())
        .collect();

    let existing_users = sqlx::query!(
        r#"
        SELECT "id" FROM "User" WHERE "id" = ANY($1)
        "#,
        &user_ids as &[String]
    )
    .fetch_all(db)
    .await?;

    // Create a set of existing user IDs for quick lookup
    let existing_user_set: std::collections::HashSet<String> =
        existing_users.into_iter().map(|row| row.id).collect();

    // Filter the access records to only include those with existing users
    let valid_records: Vec<&UserItemAccess> = access_records
        .iter()
        .filter(|record| existing_user_set.contains(&record.user_id))
        .collect();

    if valid_records.is_empty() {
        // No valid records to insert
        return Ok(());
    }

    // Extract the fields we need from each valid UserItemAccess record
    let ids: Vec<Uuid> = valid_records.iter().map(|record| record.id).collect();
    let user_ids: Vec<String> = valid_records
        .iter()
        .map(|record| record.user_id.clone())
        .collect();
    let item_ids: Vec<String> = valid_records
        .iter()
        .map(|record| record.item_id.clone())
        .collect();
    let item_types: Vec<String> = valid_records
        .iter()
        .map(|record| record.item_type.clone())
        .collect();

    // Convert AccessLevel enum to strings
    let access_level_strings: Vec<String> = valid_records
        .iter()
        .map(|record| record.access_level.to_string().to_lowercase())
        .collect();

    // For optional fields, we need to handle them differently
    let granted_from_channel_ids: Vec<Option<Uuid>> = valid_records
        .iter()
        .map(|record| record.granted_from_channel_id)
        .collect();

    // Execute the batch insert with ON CONFLICT DO NOTHING for handling unique constraint violations
    sqlx::query!(
        r#"
        INSERT INTO "UserItemAccess" (
            "id",
            "user_id",
            "item_id",
            "item_type",
            "access_level",
            "granted_from_channel_id",
            "created_at",
            "updated_at"
        )
        SELECT 
            u.id, 
            u.user_id, 
            u.item_id, 
            u.item_type, 
            u.access_level::"AccessLevel", 
            u.granted_from_channel_id,
            NOW() as created_at,
            NOW() as updated_at
        FROM UNNEST(
            $1::uuid[], 
            $2::text[], 
            $3::text[], 
            $4::text[], 
            $5::text[],
            $6::uuid[]
        ) as u(
            id, 
            user_id, 
            item_id, 
            item_type, 
            access_level, 
            granted_from_channel_id
        )
        ON CONFLICT ("user_id", "item_id", "item_type", "granted_from_channel_id") 
        DO NOTHING
        "#,
        &ids,
        &user_ids as &[String],
        &item_ids as &[String],
        &item_types as &[String],
        &access_level_strings as &[String],
        &granted_from_channel_ids as &[Option<Uuid>],
    )
    .execute(db)
    .await?;

    // Log how many records were skipped due to missing users
    let skipped_count = access_records.len() - valid_records.len();
    if skipped_count > 0 {
        tracing::info!(
            "Skipped {} records due to non-existent users",
            skipped_count
        );
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use models_permissions::share_permission::access_level::AccessLevel;
    use sqlx::{Pool, Postgres};
    // Existing tests...

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_item_access.sql")))]
    async fn test_insert_user_item_access(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let user_id = "test-user";
        let item_id = "new-test-item";
        let item_type = "document";
        let access_level = AccessLevel::Edit;
        let granted_from_channel_id = Some(Uuid::now_v7());

        let mut transaction = pool.begin().await?;

        // Insert a new record
        insert_user_item_access(
            &mut transaction,
            user_id,
            item_id,
            item_type,
            access_level,
            granted_from_channel_id,
        )
        .await?;

        // Verify it exists
        let result = sqlx::query!(
            r#"
        SELECT COUNT(*) as count
        FROM "UserItemAccess"
        WHERE "user_id" = $1 AND "item_id" = $2 AND "item_type" = $3 
        AND "access_level"::text = $4 AND "granted_from_channel_id" = $5
        "#,
            user_id,
            item_id,
            item_type,
            access_level.to_string(),
            granted_from_channel_id,
        )
        .fetch_one(&mut *transaction)
        .await?;

        assert_eq!(
            result.count.unwrap(),
            1,
            "Should have inserted exactly one record"
        );

        transaction.commit().await?;

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_item_access.sql")))]
    async fn test_insert_user_item_access_bulk(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let item_id = "bulk-insert-test-item";
        let item_type = "document";
        let access_level = AccessLevel::View;
        let granted_from_channel_id = Some(Uuid::now_v7());
        let user_ids = vec![
            "user0".to_string(),
            "user1".to_string(),
            "user2".to_string(),
        ];

        let mut transaction = pool.begin().await?;

        // Insert multiple records at once
        upsert_user_item_access_bulk(
            &mut *transaction,
            &user_ids,
            item_id,
            item_type,
            access_level,
            granted_from_channel_id,
        )
        .await?;

        // Verify all records exist
        let result = sqlx::query!(
            r#"
        SELECT COUNT(*) as count
        FROM "UserItemAccess"
        WHERE "user_id" = ANY($1) AND "item_id" = $2 AND "item_type" = $3 
        AND "access_level"::text = $4 AND "granted_from_channel_id" = $5
        "#,
            &user_ids,
            item_id,
            item_type,
            access_level.to_string(),
            granted_from_channel_id,
        )
        .fetch_one(&mut *transaction)
        .await?;

        assert_eq!(
            result.count.unwrap(),
            user_ids.len() as i64,
            "Should have inserted exactly {} records",
            user_ids.len()
        );

        // Check each user individually to ensure proper data
        for user_id in &user_ids {
            let result = sqlx::query!(
                r#"
            SELECT 
                "user_id",
                "item_id", 
                "item_type", 
                "access_level"::text as "access_level",
                "granted_from_channel_id"
            FROM "UserItemAccess"
            WHERE "user_id" = $1 AND "item_id" = $2
            "#,
                user_id,
                item_id,
            )
            .fetch_one(&mut *transaction)
            .await?;

            assert_eq!(result.user_id, *user_id);
            assert_eq!(result.item_id, item_id);
            assert_eq!(result.item_type, item_type);
            assert_eq!(result.access_level, Some(access_level.to_string()));
            assert_eq!(result.granted_from_channel_id, granted_from_channel_id);
        }

        transaction.commit().await?;

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_item_access.sql")))]
    async fn test_insert_user_item_access_bulk_empty(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let mut transaction = pool.begin().await?;

        // Test with empty array
        upsert_user_item_access_bulk(
            &mut *transaction,
            &[],
            "empty-test-item",
            "document",
            AccessLevel::View,
            None,
        )
        .await?;

        // Verify no records were inserted
        let result = sqlx::query!(
            r#"
        SELECT COUNT(*) as count
        FROM "UserItemAccess"
        WHERE "item_id" = $1
        "#,
            "empty-test-item",
        )
        .fetch_one(&mut *transaction)
        .await?;

        assert_eq!(
            result.count.unwrap(),
            0,
            "Should not have inserted any records"
        );

        transaction.commit().await?;

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_item_access.sql")))]
    async fn test_insert_user_item_access_bulk_with_pool(
        pool: Pool<Postgres>,
    ) -> anyhow::Result<()> {
        let item_id = "pool-insert-test-item";
        let item_type = "document";
        let access_level = AccessLevel::Owner;
        let granted_from_channel_id = Some(Uuid::now_v7());
        let user_ids = vec![
            "user3".to_string(),
            "user4".to_string(),
            "user5".to_string(),
        ];

        // Insert using the pool directly
        upsert_user_item_access_bulk(
            &pool,
            &user_ids,
            item_id,
            item_type,
            access_level,
            granted_from_channel_id,
        )
        .await?;

        // Verify all records exist
        let result = sqlx::query!(
            r#"
        SELECT COUNT(*) as count
        FROM "UserItemAccess"
        WHERE "user_id" = ANY($1) AND "item_id" = $2 AND "item_type" = $3 
        AND "access_level"::text = $4 AND "granted_from_channel_id" = $5
        "#,
            &user_ids,
            item_id,
            item_type,
            access_level.to_string(),
            granted_from_channel_id,
        )
        .fetch_one(&pool)
        .await?;

        assert_eq!(
            result.count.unwrap(),
            user_ids.len() as i64,
            "Should have inserted exactly {} records",
            user_ids.len()
        );

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_item_access.sql")))]
    async fn test_insert_user_item_access_bulk_upsert(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let item_id = "upsert-test-item";
        let item_type = "document";
        let granted_from_channel_id = Some(Uuid::now_v7());
        let user_ids = vec!["user1".to_string(), "user2".to_string()];

        let mut transaction = pool.begin().await?;

        // Initial insert with View access level
        let initial_access_level = AccessLevel::View;
        upsert_user_item_access_bulk(
            &mut *transaction,
            &user_ids,
            item_id,
            item_type,
            initial_access_level,
            granted_from_channel_id,
        )
        .await?;

        // Verify initial insert
        let initial_result = sqlx::query!(
            r#"
        SELECT "id", "user_id", "access_level"::text as "access_level"
        FROM "UserItemAccess"
        WHERE "user_id" = ANY($1) AND "item_id" = $2 AND "item_type" = $3 
        AND "granted_from_channel_id" = $4
        ORDER BY "user_id"
        "#,
            &user_ids,
            item_id,
            item_type,
            granted_from_channel_id,
        )
        .fetch_all(&mut *transaction)
        .await?;

        assert_eq!(
            initial_result.len(),
            2,
            "Should have inserted 2 records initially"
        );

        // Store the initial IDs to verify they don't change during upsert
        let initial_ids: Vec<Uuid> = initial_result.iter().map(|r| r.id).collect();

        // Verify initial access level
        for record in &initial_result {
            assert_eq!(record.access_level, Some(initial_access_level.to_string()));
        }

        // Now perform an upsert with a higher access level
        let updated_access_level = AccessLevel::Edit;
        upsert_user_item_access_bulk(
            &mut *transaction,
            &user_ids,
            item_id,
            item_type,
            updated_access_level,
            granted_from_channel_id,
        )
        .await?;

        // Verify the upsert updated the access levels but kept the same records
        let updated_result = sqlx::query!(
            r#"
        SELECT 
            "id",
            "user_id", 
            "access_level"::text as "access_level"
        FROM "UserItemAccess"
        WHERE "user_id" = ANY($1) AND "item_id" = $2 AND "item_type" = $3 
        AND "granted_from_channel_id" = $4
        ORDER BY "user_id"
        "#,
            &user_ids,
            item_id,
            item_type,
            granted_from_channel_id,
        )
        .fetch_all(&mut *transaction)
        .await?;

        assert_eq!(
            updated_result.len(),
            2,
            "Should still have 2 records after upsert (no duplicates)"
        );

        // Verify that the records were updated not replaced
        for (i, record) in updated_result.iter().enumerate() {
            // Access level should be updated to the new value
            assert_eq!(
                record.access_level,
                Some(updated_access_level.to_string()),
                "Access level should be updated to {:?}",
                updated_access_level
            );

            // The ID should remain unchanged (same record, just updated)
            assert_eq!(
                record.id, initial_ids[i],
                "Record ID should not change during upsert, confirming same row was updated"
            );
        }

        // Test with both updates and new inserts
        let mixed_user_ids = vec![
            "user1".to_string(), // existing
            "user3".to_string(), // new
            "user4".to_string(), // new
        ];

        let final_access_level = AccessLevel::Owner;

        // Perform mixed upsert (updating one record, inserting two new ones)
        upsert_user_item_access_bulk(
            &mut *transaction,
            &mixed_user_ids,
            item_id,
            item_type,
            final_access_level,
            granted_from_channel_id,
        )
        .await?;

        // Verify the result
        let final_result = sqlx::query!(
            r#"
        SELECT 
            "id",
            "user_id", 
            "access_level"::text as "access_level"
        FROM "UserItemAccess"
        WHERE "user_id" = ANY($1) AND "item_id" = $2 AND "item_type" = $3 
        AND "granted_from_channel_id" = $4
        ORDER BY "user_id"
        "#,
            &mixed_user_ids,
            item_id,
            item_type,
            granted_from_channel_id,
        )
        .fetch_all(&mut *transaction)
        .await?;

        assert_eq!(
            final_result.len(),
            3,
            "Should have 3 records after mixed upsert"
        );

        // Verify each record has the right access level
        for record in &final_result {
            assert_eq!(
                record.access_level,
                Some(final_access_level.to_string()),
                "All records should have Owner access level"
            );
        }

        // Verify the first user's ID remains unchanged (updated record)
        assert_eq!(
            final_result[0].id, initial_ids[0],
            "Previously existing record should maintain its ID"
        );

        // Verify that all users now have records
        let total_count = sqlx::query!(
            r#"
        SELECT COUNT(*) as count
        FROM "UserItemAccess"
        WHERE ("user_id" = ANY($1) OR "user_id" = ANY($2)) 
        AND "item_id" = $3 AND "item_type" = $4 
        AND "granted_from_channel_id" = $5
        "#,
            &user_ids,
            &["user3".to_string(), "user4".to_string()],
            item_id,
            item_type,
            granted_from_channel_id,
        )
        .fetch_one(&mut *transaction)
        .await?;

        assert_eq!(
            total_count.count.unwrap(),
            4, // 2 original users + 2 new users
            "Should have 4 total records (including user2 that wasn't in the last operation)"
        );

        transaction.commit().await?;

        Ok(())
    }
}
