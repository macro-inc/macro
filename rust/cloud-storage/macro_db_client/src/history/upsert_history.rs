use chrono::{DateTime, Utc};
use sqlx::{Postgres, Transaction};

/// Upserts an item into the ItemLastAccessed table
#[tracing::instrument(skip(transaction))]
pub async fn upsert_item_last_accessed(
    transaction: &mut Transaction<'_, Postgres>,
    item_id: &str,
    item_type: &str,
) -> anyhow::Result<()> {
    upsert_item_last_accessed_timestamp(transaction, item_id, item_type, &Utc::now()).await
}

/// Upserts an item into the ItemLastAccessed table with the specified timestamp
#[tracing::instrument(skip(transaction))]
pub async fn upsert_item_last_accessed_timestamp(
    transaction: &mut Transaction<'_, Postgres>,
    item_id: &str,
    item_type: &str,
    timestamp: &DateTime<Utc>,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO "ItemLastAccessed" ("item_id", "item_type", "last_accessed")
        VALUES ($1, $2, $3)
        ON CONFLICT ("item_id", "item_type") DO UPDATE
        SET "last_accessed" = $3;
        "#,
        item_id,
        item_type,
        timestamp.naive_utc()
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}

/// Upserts an item into the user's history
#[tracing::instrument(skip(transaction))]
pub async fn upsert_user_history(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: &str,
    item_id: &str,
    item_type: &str,
) -> anyhow::Result<()> {
    upsert_user_history_timestamp(transaction, user_id, item_id, item_type, &Utc::now()).await
}

/// Upserts an item into the user's history with the specified timestamp
#[tracing::instrument(skip(transaction))]
pub async fn upsert_user_history_timestamp(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: &str,
    item_id: &str,
    item_type: &str,
    timestamp: &DateTime<Utc>,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO "UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $4)
        ON CONFLICT ("userId", "itemId", "itemType") DO UPDATE
        SET "updatedAt" = $4;
        "#,
        user_id,
        item_id,
        item_type,
        timestamp.naive_utc()
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}

/// Batch upserts item(s) into the user's history
#[tracing::instrument(skip(transaction))]
async fn insert_user_history_batch(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: &str,
    item_ids: &Vec<String>,
    item_type: &str,
    timestamp: DateTime<Utc>,
) -> anyhow::Result<()> {
    let user_ids: Vec<String> = std::iter::repeat_n(user_id.to_string(), item_ids.len()).collect();
    let item_types: Vec<String> =
        std::iter::repeat_n(item_type.to_string(), item_ids.len()).collect();
    let timestamps: Vec<_> = vec![timestamp; item_ids.len()];

    sqlx::query!(
        r#"
        INSERT INTO "UserHistory" ("userId", "itemId", "itemType", "createdAt", "updatedAt")
        SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::timestamptz[], $5::timestamptz[])
        ON CONFLICT ("userId", "itemId", "itemType") DO UPDATE
        SET "updatedAt" = EXCLUDED."updatedAt"
        "#,
        &user_ids,
        item_ids,
        &item_types,
        &timestamps,
        &timestamps
    )
    .execute(transaction.as_mut())
    .await?;

    Ok(())
}

/// Adds user history for a project tree
#[tracing::instrument(skip(transaction))]
pub async fn add_user_history_for_project_tree(
    transaction: &mut Transaction<'_, Postgres>,
    user_id: &str,
    project_ids: &Vec<String>,
    document_ids: &Vec<String>,
) -> anyhow::Result<()> {
    let now: DateTime<Utc> = Utc::now();

    insert_user_history_batch(transaction, user_id, project_ids, "project", now).await?;
    insert_user_history_batch(transaction, user_id, document_ids, "document", now).await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::{Pool, Postgres};

    #[sqlx::test(fixtures(path = "../../fixtures"))]
    async fn test_upsert_item_last_accessed(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let last_accessed = sqlx::query!(
            r#"
            INSERT INTO "ItemLastAccessed" ("item_id", "item_type", "last_accessed") VALUES ($1, $2, NOW())
            RETURNING "last_accessed" as last_accessed
            "#, 
            "d1", 
            "document"
        )
        .map(|row| row.last_accessed)
        .fetch_one(&pool.clone())
        .await?;

        let mut transaction = pool.begin().await?;
        upsert_item_last_accessed(&mut transaction, "d1", "document").await?;
        transaction.commit().await?;

        let updated_last_access = sqlx::query!(
            r#"
            SELECT last_accessed FROM "ItemLastAccessed" WHERE item_id = $1
            "#,
            "d1"
        )
        .map(|row| row.last_accessed)
        .fetch_one(&pool)
        .await?;

        assert_ne!(last_accessed, updated_last_access);

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_history")))]
    async fn test_upsert_user_history(pool: Pool<Postgres>) {
        let mut transaction = pool.begin().await.unwrap();
        upsert_user_history(
            &mut transaction,
            "macro|user@user.com",
            "document-one",
            "document",
        )
        .await
        .unwrap();
        transaction.commit().await.unwrap();

        let time = sqlx::query!(
            r#"
            SELECT "createdAt" as created_at, "updatedAt" as updated_at FROM "UserHistory" WHERE "userId" = $1 AND "itemId" = $2
            "#,
            "macro|user@user.com",
            "document-one"
        )
        .fetch_one(&pool.clone())
        .await
        .unwrap();

        assert_ne!(time.created_at, time.updated_at);

        let mut transaction = pool.begin().await.unwrap();
        upsert_user_history(
            &mut transaction,
            "macro|user@user.com",
            "document-two",
            "document",
        )
        .await
        .unwrap();
        transaction.commit().await.unwrap();

        let time = sqlx::query!(
            r#"
            SELECT "createdAt" as created_at, "updatedAt" as updated_at FROM "UserHistory" WHERE "userId" = $1 AND "itemId" = $2
            "#,
            "macro|user@user.com",
            "document-two"
        )
        .fetch_one(&pool.clone())
        .await
        .unwrap();

        assert_eq!(time.created_at, time.updated_at);
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("basic_user_history")))]
    async fn test_add_user_history_for_project_tree(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let user_id = "macro|user@user.com";

        let mut transaction = pool.begin().await?;

        // Fetch initial timestamps for existing user history (document-one)
        let initial = sqlx::query!(
            r#"
        SELECT "createdAt" as created_at, "updatedAt" as updated_at
        FROM "UserHistory"
        WHERE "userId" = $1 AND "itemId" = $2
        "#,
            user_id,
            "document-one"
        )
        .fetch_one(&mut *transaction)
        .await?;

        let project_ids = vec!["project-alpha".to_string()]; // project doesn't need to exist for this test
        let document_ids = vec!["document-one".to_string(), "document-two".to_string()];

        // Call function under test
        add_user_history_for_project_tree(&mut transaction, user_id, &project_ids, &document_ids)
            .await?;

        // Confirm document-one was updated
        let updated = sqlx::query!(
            r#"
        SELECT "createdAt" as created_at, "updatedAt" as updated_at
        FROM "UserHistory"
        WHERE "userId" = $1 AND "itemId" = $2
        "#,
            user_id,
            "document-one"
        )
        .fetch_one(&mut *transaction)
        .await?;

        assert_eq!(initial.created_at, updated.created_at);
        assert!(
            updated.updated_at > initial.updated_at,
            "expected updated_at to be bumped"
        );

        // Confirm document-two was inserted
        let inserted = sqlx::query!(
            r#"
        SELECT "createdAt" as created_at, "updatedAt" as updated_at
        FROM "UserHistory"
        WHERE "userId" = $1 AND "itemId" = $2
        "#,
            user_id,
            "document-two"
        )
        .fetch_one(&mut *transaction)
        .await?;

        assert_eq!(inserted.created_at, inserted.updated_at);

        // Confirm fake project was inserted (even though no actual "Project" exists)
        let project = sqlx::query!(
            r#"
        SELECT "createdAt" as created_at, "updatedAt" as updated_at
        FROM "UserHistory"
        WHERE "userId" = $1 AND "itemId" = $2 AND "itemType" = 'project'
        "#,
            user_id,
            "project-alpha"
        )
        .fetch_one(&mut *transaction)
        .await?;

        assert_eq!(project.created_at, project.updated_at);

        transaction.commit().await?;
        Ok(())
    }
}
