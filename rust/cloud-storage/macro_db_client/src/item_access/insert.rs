use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::user_item_access::UserItemAccess;
use sqlx::{Executor, Postgres, Transaction};
use uuid::Uuid;

#[tracing::instrument(skip(transaction), err)]
pub async fn insert_user_item_access(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: MacroUserIdStr<'_>,
    item_id: &str,
    item_type: &str,
    access_level: AccessLevel,
    _granted_from_channel_id: Option<Uuid>,
) -> anyhow::Result<()> {
    let entity_id = macro_uuid::string_to_uuid(item_id)?;

    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, $2, $3, 'user', $4)
        ON CONFLICT (entity_id, entity_type, source_id, source_type)
        WHERE granted_from_project_id IS NULL
        DO UPDATE SET access_level = EXCLUDED.access_level, updated_at = NOW()
        "#,
        entity_id,
        item_type,
        user_id.as_ref(),
        access_level as _,
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}

#[tracing::instrument(skip(executor), err)]
pub async fn upsert_user_item_access_bulk<'e, E>(
    executor: E,
    user_ids: &[MacroUserIdStr<'_>],
    item_id: &str,
    item_type: &str,
    access_level: AccessLevel,
    _granted_from_channel_id: Option<Uuid>,
) -> anyhow::Result<()>
where
    E: Executor<'e, Database = Postgres>,
{
    if user_ids.is_empty() {
        return Ok(());
    }

    let entity_id = macro_uuid::string_to_uuid(item_id)?;
    let macro_ids: Vec<String> = user_ids.iter().map(|s| s.to_string()).collect();

    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        SELECT $1, $2, u.user_id, 'user', $3
        FROM UNNEST($4::text[]) as u(user_id)
        ON CONFLICT (entity_id, entity_type, source_id, source_type)
        WHERE granted_from_project_id IS NULL
        DO UPDATE SET access_level = EXCLUDED.access_level, updated_at = NOW()
        "#,
        entity_id,
        item_type,
        access_level as _,
        macro_ids.as_slice(),
    )
    .execute(executor)
    .await?;

    Ok(())
}

/// Inserts multiple UserItemAccess records in a single database query
/// The created_at and updated_at fields from the structs are ignored and NOW() is used instead
#[tracing::instrument(skip(db, access_records), err)]
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

    // Convert item_ids to UUIDs
    let entity_ids: Vec<Uuid> = valid_records
        .iter()
        .map(|record| macro_uuid::string_to_uuid(&record.item_id))
        .collect::<anyhow::Result<Vec<Uuid>>>()?;

    let source_ids: Vec<String> = valid_records
        .iter()
        .map(|record| record.user_id.clone())
        .collect();
    let entity_types: Vec<String> = valid_records
        .iter()
        .map(|record| record.item_type.clone())
        .collect();

    // Convert AccessLevel enum to strings for the query
    let access_level_strings: Vec<String> = valid_records
        .iter()
        .map(|record| record.access_level.to_string().to_lowercase())
        .collect();

    // Execute the batch insert with ON CONFLICT DO NOTHING for handling unique constraint violations
    sqlx::query!(
        r#"
        INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
        SELECT
            u.entity_id,
            u.entity_type,
            u.source_id,
            'user',
            u.access_level::"AccessLevel"
        FROM UNNEST(
            $1::uuid[],
            $2::text[],
            $3::text[],
            $4::text[]
        ) as u(
            entity_id,
            entity_type,
            source_id,
            access_level
        )
        ON CONFLICT (entity_id, entity_type, source_id, source_type)
        WHERE granted_from_project_id IS NULL
        DO NOTHING
        "#,
        &entity_ids,
        &entity_types as &[String],
        &source_ids as &[String],
        &access_level_strings as &[String],
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
        let user_id = MacroUserIdStr::parse_from_str("macro|test@test.com").unwrap();
        let item_id = "a0000000-0000-0000-0000-000000000001";
        let item_type = "document";
        let access_level = AccessLevel::Edit;
        let granted_from_channel_id = Some(Uuid::now_v7());

        let mut transaction = pool.begin().await?;

        // Insert a new record
        insert_user_item_access(
            &mut transaction,
            user_id.clone(),
            item_id,
            item_type,
            access_level,
            granted_from_channel_id,
        )
        .await?;

        let entity_id = macro_uuid::string_to_uuid(item_id)?;

        // Verify it exists
        let result = sqlx::query!(
            r#"
        SELECT COUNT(*) as count
        FROM entity_access
        WHERE source_id = $1 AND entity_id = $2 AND entity_type = $3
        AND access_level::text = $4 AND source_type = 'user'
        "#,
            user_id.as_ref(),
            entity_id,
            item_type,
            access_level.to_string(),
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
        let item_id = "b0000000-0000-0000-0000-000000000001";
        let item_type = "document";
        let access_level = AccessLevel::View;
        let granted_from_channel_id = Some(Uuid::now_v7());
        let user_ids = vec![
            MacroUserIdStr::parse_from_str("macro|user0@test.com").unwrap(),
            MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap(),
            MacroUserIdStr::parse_from_str("macro|user2@test.com").unwrap(),
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

        let ids: Vec<_> = user_ids.iter().map(|x| x.to_string()).collect();
        let entity_id = macro_uuid::string_to_uuid(item_id)?;

        // Verify all records exist
        let result = sqlx::query!(
            r#"
        SELECT COUNT(*) as count
        FROM entity_access
        WHERE source_id = ANY($1) AND entity_id = $2 AND entity_type = $3
        AND access_level::text = $4 AND source_type = 'user'
        "#,
            &ids,
            entity_id,
            item_type,
            access_level.to_string(),
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
                source_id,
                entity_id,
                entity_type,
                access_level::text as "access_level"
            FROM entity_access
            WHERE source_id = $1 AND entity_id = $2 AND source_type = 'user'
            "#,
                user_id.as_ref(),
                entity_id,
            )
            .fetch_one(&mut *transaction)
            .await?;

            assert_eq!(result.source_id, user_id.as_ref());
            assert_eq!(result.entity_id, entity_id);
            assert_eq!(result.entity_type, item_type);
            assert_eq!(result.access_level, Some(access_level.to_string()));
        }

        transaction.commit().await?;

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_item_access.sql")))]
    async fn test_insert_user_item_access_bulk_empty(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let mut transaction = pool.begin().await?;

        let empty_item_id = "c0000000-0000-0000-0000-000000000001";
        let entity_id = macro_uuid::string_to_uuid(empty_item_id)?;

        // Test with empty array
        upsert_user_item_access_bulk(
            &mut *transaction,
            &[],
            empty_item_id,
            "document",
            AccessLevel::View,
            None,
        )
        .await?;

        // Verify no records were inserted
        let result = sqlx::query!(
            r#"
        SELECT COUNT(*) as count
        FROM entity_access
        WHERE entity_id = $1
        "#,
            entity_id,
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
        let item_id = "d0000000-0000-0000-0000-000000000001";
        let item_type = "document";
        let access_level = AccessLevel::Owner;
        let granted_from_channel_id = Some(Uuid::now_v7());
        let user_ids = vec![
            MacroUserIdStr::parse_from_str("macro|user3@test.com").unwrap(),
            MacroUserIdStr::parse_from_str("macro|user4@test.com").unwrap(),
            MacroUserIdStr::parse_from_str("macro|user5@test.com").unwrap(),
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

        let ids: Vec<_> = user_ids.iter().map(|x| x.to_string()).collect();
        let entity_id = macro_uuid::string_to_uuid(item_id)?;

        // Verify all records exist
        let result = sqlx::query!(
            r#"
        SELECT COUNT(*) as count
        FROM entity_access
        WHERE source_id = ANY($1) AND entity_id = $2 AND entity_type = $3
        AND access_level::text = $4 AND source_type = 'user'
        "#,
            &ids,
            entity_id,
            item_type,
            access_level.to_string(),
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
        let item_id = "e0000000-0000-0000-0000-000000000001";
        let item_type = "document";
        let granted_from_channel_id = Some(Uuid::now_v7());
        let user_ids = vec![
            MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap(),
            MacroUserIdStr::parse_from_str("macro|user2@test.com").unwrap(),
        ];

        let mut transaction = pool.begin().await?;
        let entity_id = macro_uuid::string_to_uuid(item_id)?;

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

        let ids: Vec<_> = user_ids.iter().map(|x| x.to_string()).collect();

        // Verify initial insert
        let initial_result = sqlx::query!(
            r#"
        SELECT id, source_id, access_level::text as "access_level"
        FROM entity_access
        WHERE source_id = ANY($1) AND entity_id = $2 AND entity_type = $3
        AND source_type = 'user'
        ORDER BY source_id
        "#,
            &ids,
            entity_id,
            item_type,
        )
        .fetch_all(&mut *transaction)
        .await?;

        assert_eq!(
            initial_result.len(),
            2,
            "Should have inserted 2 records initially"
        );

        // Store the initial IDs to verify they don't change during upsert
        let initial_ids: Vec<i64> = initial_result.iter().map(|r| r.id).collect();

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

        let ids: Vec<_> = user_ids.iter().map(|x| x.to_string()).collect();

        // Verify the upsert updated the access levels but kept the same records
        let updated_result = sqlx::query!(
            r#"
        SELECT
            id,
            source_id,
            access_level::text as "access_level"
        FROM entity_access
        WHERE source_id = ANY($1) AND entity_id = $2 AND entity_type = $3
        AND source_type = 'user'
        ORDER BY source_id
        "#,
            &ids,
            entity_id,
            item_type,
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
            MacroUserIdStr::parse_from_str("macro|user1@test.com").unwrap(), // existing
            MacroUserIdStr::parse_from_str("macro|user3@test.com").unwrap(), // new
            MacroUserIdStr::parse_from_str("macro|user4@test.com").unwrap(), // new
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

        let ids: Vec<_> = mixed_user_ids.iter().map(|x| x.to_string()).collect();

        // Verify the result
        let final_result = sqlx::query!(
            r#"
        SELECT
            id,
            source_id,
            access_level::text as "access_level"
        FROM entity_access
        WHERE source_id = ANY($1) AND entity_id = $2 AND entity_type = $3
        AND source_type = 'user'
        ORDER BY source_id
        "#,
            &ids,
            entity_id,
            item_type,
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
        FROM entity_access
        WHERE (source_id = ANY($1) OR source_id = ANY($2))
        AND entity_id = $3 AND entity_type = $4
        AND source_type = 'user'
        "#,
            &ids,
            &["macro|user2@test.com".to_string()], // user2 from original insert, not in mixed_user_ids
            entity_id,
            item_type,
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
