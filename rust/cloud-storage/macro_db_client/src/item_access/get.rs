use chrono::{DateTime, Utc};
use models_permissions::share_permission::access_level::AccessLevel;

/// A record from entity_access representing a user's access to an entity.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EntityAccessRecord {
    /// The entity ID (as a string, cast from UUID)
    pub entity_id: String,
    /// The entity type (e.g., "document", "project", "chat", "thread")
    pub entity_type: String,
    /// The source ID (user_id, team_id, or channel_id)
    pub source_id: String,
    /// The level of access granted
    pub access_level: AccessLevel,
    /// When this access record was created
    pub created_at: DateTime<Utc>,
    /// When this access record was last updated
    pub updated_at: DateTime<Utc>,
}

/// Gets the items owner and whether it's deleted
#[tracing::instrument(skip(db), err)]
pub async fn get_owner_and_deleted(
    db: &sqlx::Pool<sqlx::Postgres>,
    entity_id: &str,
    item_type: &str,
) -> anyhow::Result<(String, bool)> {
    let result = match item_type {
        "document" => {
            sqlx::query!(
                r#"SELECT owner, "deletedAt" as deleted_at FROM "Document" WHERE id=$1"#,
                entity_id
            )
            .map(|r| (r.owner, r.deleted_at.is_some()))
            .fetch_one(db)
            .await?
        }
        "chat" => {
            sqlx::query!(
                r#"SELECT "userId" as user_id, "deletedAt" as deleted_at FROM "Chat" WHERE id=$1"#,
                entity_id
            )
            .map(|r| (r.user_id, r.deleted_at.is_some()))
            .fetch_one(db)
            .await?
        }
        "project" => sqlx::query!(
            r#"SELECT "userId" as user_id, "deletedAt" as deleted_at FROM "Project" WHERE id=$1"#,
            entity_id
        )
        .map(|r| (r.user_id, r.deleted_at.is_some()))
        .fetch_one(db)
        .await?,
        _ => anyhow::bail!("unsupported item type"),
    };

    Ok(result)
}

/// Finds all access permissions for a given user on a project via entity_access.
#[tracing::instrument(skip(db))]
pub async fn get_user_item_access_for_project(
    db: &sqlx::Pool<sqlx::Postgres>,
    project_id: &str,
    user_id: &str,
) -> anyhow::Result<Vec<EntityAccessRecord>> {
    let entity_id = macro_uuid::string_to_uuid(project_id).unwrap();
    let access_records = sqlx::query!(
        r#"
        WITH user_source_ids AS (
            SELECT cp.channel_id::text as source_id FROM comms_channel_participants cp
                WHERE cp.user_id = $2 AND cp.left_at IS NULL
            UNION ALL
            SELECT t.team_id::text FROM team_user t
                WHERE t.user_id = $2
            UNION ALL
            SELECT $2
        )
        SELECT
            entity_id::text as "entity_id!",
            entity_type as "entity_type!",
            source_id as "source_id!",
            access_level as "access_level!: AccessLevel",
            created_at as "created_at!: DateTime<Utc>",
            updated_at as "updated_at!: DateTime<Utc>"
        FROM entity_access
        WHERE source_id = ANY(SELECT source_id FROM user_source_ids)
        AND entity_id = $1
        AND entity_type = 'project'
        "#,
        entity_id,
        user_id,
    )
    .map(|r| EntityAccessRecord {
        entity_id: r.entity_id,
        entity_type: r.entity_type,
        source_id: r.source_id,
        access_level: r.access_level,
        created_at: r.created_at,
        updated_at: r.updated_at,
    })
    .fetch_all(db)
    .await?;

    Ok(access_records)
}

/// Finds all access permissions for a given user on a document via entity_access.
#[tracing::instrument(skip(db))]
pub async fn get_user_item_access_for_document(
    db: &sqlx::Pool<sqlx::Postgres>,
    document_id: &str,
    user_id: &str,
) -> anyhow::Result<Vec<EntityAccessRecord>> {
    let entity_id = macro_uuid::string_to_uuid(document_id).unwrap();
    let access_records = sqlx::query!(
        r#"
        WITH user_source_ids AS (
            SELECT cp.channel_id::text as source_id FROM comms_channel_participants cp
                WHERE cp.user_id = $2 AND cp.left_at IS NULL
            UNION ALL
            SELECT t.team_id::text FROM team_user t
                WHERE t.user_id = $2
            UNION ALL
            SELECT $2
        )
        SELECT
            entity_id::text as "entity_id!",
            entity_type as "entity_type!",
            source_id as "source_id!",
            access_level as "access_level!: AccessLevel",
            created_at as "created_at!: DateTime<Utc>",
            updated_at as "updated_at!: DateTime<Utc>"
        FROM entity_access
        WHERE source_id = ANY(SELECT source_id FROM user_source_ids)
        AND entity_id = $1
        AND entity_type = 'document'
        "#,
        entity_id,
        user_id,
    )
    .map(|r| EntityAccessRecord {
        entity_id: r.entity_id,
        entity_type: r.entity_type,
        source_id: r.source_id,
        access_level: r.access_level,
        created_at: r.created_at,
        updated_at: r.updated_at,
    })
    .fetch_all(db)
    .await?;

    Ok(access_records)
}

/// Finds all access permissions for a given user on a chat via entity_access.
#[tracing::instrument(skip(db))]
pub async fn get_user_item_access_for_chat(
    db: &sqlx::Pool<sqlx::Postgres>,
    chat_id: &str,
    user_id: &str,
) -> anyhow::Result<Vec<EntityAccessRecord>> {
    let entity_id = macro_uuid::string_to_uuid(chat_id).unwrap();
    let access_records = sqlx::query!(
        r#"
        WITH user_source_ids AS (
            SELECT cp.channel_id::text as source_id FROM comms_channel_participants cp
                WHERE cp.user_id = $2 AND cp.left_at IS NULL
            UNION ALL
            SELECT t.team_id::text FROM team_user t
                WHERE t.user_id = $2
            UNION ALL
            SELECT $2
        )
        SELECT
            entity_id::text as "entity_id!",
            entity_type as "entity_type!",
            source_id as "source_id!",
            access_level as "access_level!: AccessLevel",
            created_at as "created_at!: DateTime<Utc>",
            updated_at as "updated_at!: DateTime<Utc>"
        FROM entity_access
        WHERE source_id = ANY(SELECT source_id FROM user_source_ids)
        AND entity_id = $1
        AND entity_type = 'chat'
        "#,
        entity_id,
        user_id,
    )
    .map(|r| EntityAccessRecord {
        entity_id: r.entity_id,
        entity_type: r.entity_type,
        source_id: r.source_id,
        access_level: r.access_level,
        created_at: r.created_at,
        updated_at: r.updated_at,
    })
    .fetch_all(db)
    .await?;

    Ok(access_records)
}

/// Finds all access permissions for a given user on an email thread via entity_access.
#[tracing::instrument(skip(db))]
pub async fn get_user_item_access_for_thread(
    db: &sqlx::Pool<sqlx::Postgres>,
    thread_id: &str,
    user_id: &str,
) -> anyhow::Result<Vec<EntityAccessRecord>> {
    let entity_id = macro_uuid::string_to_uuid(thread_id).unwrap();
    let access_records = sqlx::query!(
        r#"
        WITH user_source_ids AS (
            SELECT cp.channel_id::text as source_id FROM comms_channel_participants cp
                WHERE cp.user_id = $2 AND cp.left_at IS NULL
            UNION ALL
            SELECT t.team_id::text FROM team_user t
                WHERE t.user_id = $2
            UNION ALL
            SELECT $2
        )
        SELECT
            entity_id::text as "entity_id!",
            entity_type as "entity_type!",
            source_id as "source_id!",
            access_level as "access_level!: AccessLevel",
            created_at as "created_at!: DateTime<Utc>",
            updated_at as "updated_at!: DateTime<Utc>"
        FROM entity_access
        WHERE source_id = ANY(SELECT source_id FROM user_source_ids)
        AND entity_id = $1
        AND entity_type = 'email_thread'
        "#,
        entity_id,
        user_id,
    )
    .map(|r| EntityAccessRecord {
        entity_id: r.entity_id,
        entity_type: r.entity_type,
        source_id: r.source_id,
        access_level: r.access_level,
        created_at: r.created_at,
        updated_at: r.updated_at,
    })
    .fetch_all(db)
    .await?;

    Ok(access_records)
}

#[cfg(test)]
mod tests {
    use crate::item_access::get::{
        get_user_item_access_for_chat, get_user_item_access_for_document,
        get_user_item_access_for_project, get_user_item_access_for_thread, EntityAccessRecord,
    };
    use models_permissions::share_permission::access_level::AccessLevel;
    use std::collections::HashSet;

    // Helper function to make test assertions cleaner
    fn to_entity_id_set(records: &[EntityAccessRecord]) -> HashSet<String> {
        records.iter().map(|r| r.entity_id.clone()).collect()
    }

    // ==================== Document Tests ====================

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_doc")))]
    async fn test_get_access_for_nested_document(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get all permissions for 'user-1' on the deeply nested document.
        // EXPECTATION: Should return 3 records:
        // 1. Direct access on the document.
        // 2. Inherited access from 'p-parent'.
        // 3. Inherited access from 'p-grandparent'.

        let permissions = get_user_item_access_for_document(
            &pool,
            "d0000000-0000-0000-0000-00000000c11d",
            "user-1",
        )
        .await?;

        assert_eq!(
            permissions.len(),
            3,
            "Expected to find 3 access records (direct + 2 inherited)"
        );

        let expected_entity_ids: HashSet<String> = [
            "d0000000-0000-0000-0000-00000000c11d".to_string(),
            "00000000-0000-0000-0000-000000aae001".to_string(),
            "00000000-0000-0000-0000-000000aae002".to_string(),
        ]
        .into_iter()
        .collect();

        assert_eq!(to_entity_id_set(&permissions), expected_entity_ids);

        // Verify the details of each permission
        for p in permissions {
            match p.entity_id.as_str() {
                "d0000000-0000-0000-0000-00000000c11d" => {
                    assert_eq!(p.access_level, AccessLevel::View)
                }
                "00000000-0000-0000-0000-000000aae001" => {
                    assert_eq!(p.access_level, AccessLevel::Edit)
                }
                "00000000-0000-0000-0000-000000aae002" => {
                    assert_eq!(p.access_level, AccessLevel::Owner)
                }
                _ => panic!("Unexpected entity_id found in results"),
            }
        }

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_doc")))]
    async fn test_get_access_for_standalone_document(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get permissions for 'user-1' on the standalone document, which has no project parent.
        // EXPECTATION: Should return exactly 1 record for the direct permission.

        let permissions = get_user_item_access_for_document(
            &pool,
            "d0000000-0000-0000-0000-000000057a1d",
            "user-1",
        )
        .await?;

        assert_eq!(
            permissions.len(),
            1,
            "Expected only one direct access record"
        );
        let perm = &permissions[0];
        assert_eq!(perm.entity_id, "d0000000-0000-0000-0000-000000057a1d");
        assert_eq!(perm.access_level, AccessLevel::Comment);

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_doc")))]
    async fn test_access_is_correctly_scoped_to_user(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get permissions for 'user-2' on the nested document.
        // EXPECTATION: Should return only the single permission granted to 'user-2', and none of user-1's permissions.

        let permissions = get_user_item_access_for_document(
            &pool,
            "d0000000-0000-0000-0000-00000000c11d",
            "user-2",
        )
        .await?;

        assert_eq!(
            permissions.len(),
            1,
            "Expected only the access record for user-2"
        );
        let perm = &permissions[0];
        assert_eq!(perm.source_id, "user-2");
        assert_eq!(perm.entity_id, "d0000000-0000-0000-0000-00000000c11d");
        assert_eq!(perm.access_level, AccessLevel::View);

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_doc")))]
    async fn test_no_access_returns_empty(pool: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
        // SCENARIO: Query for a user who has no access at all to the item or its hierarchy.
        // We'll use 'user-2' and ask for the standalone document, which only 'user-1' has access to.
        // EXPECTATION: Should return an empty vector.

        let permissions = get_user_item_access_for_document(
            &pool,
            "d0000000-0000-0000-0000-000000057a1d",
            "user-2",
        )
        .await?;
        assert!(
            permissions.is_empty(),
            "Expected no permissions to be returned"
        );

        Ok(())
    }

    // ==================== Chat Tests ====================

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_chat")))]
    async fn test_get_access_for_nested_chat(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get all permissions for 'user-1' on the nested chat.
        // EXPECTATION: Should return 3 records:
        // 1. Direct access on the chat.
        // 2. Inherited access from 'p-parent'.
        // 3. Inherited access from 'p-grandparent'.

        let permissions = get_user_item_access_for_chat(
            &pool,
            "c0000000-0000-0000-0000-00000000c11d",
            "user-1",
        )
        .await?;

        assert_eq!(
            permissions.len(),
            3,
            "Expected 3 access records (direct + 2 inherited)"
        );

        let expected_entity_ids: HashSet<String> = [
            "c0000000-0000-0000-0000-00000000c11d".to_string(),
            "00000000-0000-0000-0000-000000aae001".to_string(),
            "00000000-0000-0000-0000-000000aae002".to_string(),
        ]
        .into_iter()
        .collect();

        assert_eq!(to_entity_id_set(&permissions), expected_entity_ids);

        // Verify the details of each permission
        for p in permissions {
            match p.entity_id.as_str() {
                "c0000000-0000-0000-0000-00000000c11d" => {
                    assert_eq!(p.access_level, AccessLevel::View)
                }
                "00000000-0000-0000-0000-000000aae001" => {
                    assert_eq!(p.access_level, AccessLevel::Edit)
                }
                "00000000-0000-0000-0000-000000aae002" => {
                    assert_eq!(p.access_level, AccessLevel::Owner)
                }
                _ => panic!("Unexpected entity_id found in results: {}", p.entity_id),
            }
        }

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_chat")))]
    async fn test_get_access_for_standalone_chat(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get permissions for 'user-1' on the standalone chat, which has no project parent.
        // EXPECTATION: Should return exactly 1 record for the direct permission.

        let permissions = get_user_item_access_for_chat(
            &pool,
            "c0000000-0000-0000-0000-000000057a1d",
            "user-1",
        )
        .await?;

        assert_eq!(
            permissions.len(),
            1,
            "Expected only one direct access record"
        );
        let perm = &permissions[0];
        assert_eq!(perm.entity_id, "c0000000-0000-0000-0000-000000057a1d");
        assert_eq!(perm.access_level, AccessLevel::Comment);

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_chat")))]
    async fn test_chat_access_is_correctly_scoped_to_user(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get permissions for 'user-2' on the nested chat.
        // EXPECTATION: Should return only the single permission granted to 'user-2', not any of user-1's permissions.

        let permissions = get_user_item_access_for_chat(
            &pool,
            "c0000000-0000-0000-0000-00000000c11d",
            "user-2",
        )
        .await?;

        assert_eq!(
            permissions.len(),
            1,
            "Expected only the access record for user-2"
        );
        let perm = &permissions[0];
        assert_eq!(perm.source_id, "user-2");
        assert_eq!(perm.entity_id, "c0000000-0000-0000-0000-00000000c11d");
        assert_eq!(perm.access_level, AccessLevel::View);

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_chat")))]
    async fn test_no_access_for_chat_returns_empty(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Query for a user who has no access at all to the item or its hierarchy.
        // We'll use 'user-2' and ask for the standalone chat, which only 'user-1' has access to.
        // EXPECTATION: Should return an empty vector.

        let permissions = get_user_item_access_for_chat(
            &pool,
            "c0000000-0000-0000-0000-000000057a1d",
            "user-2",
        )
        .await?;
        assert!(
            permissions.is_empty(),
            "Expected no permissions to be returned"
        );

        Ok(())
    }

    // ==================== Project Tests ====================

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_project")))]
    async fn test_get_access_starting_from_child_project(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get all permissions for 'user-1' starting from the lowest project (child).
        // EXPECTATION: Should return 3 records, one for the child, parent, and grandparent project.

        let permissions = get_user_item_access_for_project(
            &pool,
            "00000000-0000-0000-0000-000000aae003",
            "user-1",
        )
        .await?;

        assert_eq!(
            permissions.len(),
            3,
            "Expected 3 access records (self + 2 ancestors)"
        );

        let expected_entity_ids: HashSet<String> = [
            "00000000-0000-0000-0000-000000aae003".to_string(),
            "00000000-0000-0000-0000-000000aae001".to_string(),
            "00000000-0000-0000-0000-000000aae002".to_string(),
        ]
        .into_iter()
        .collect();

        assert_eq!(to_entity_id_set(&permissions), expected_entity_ids);

        // Verify the details of each permission
        for p in permissions {
            match p.entity_id.as_str() {
                "00000000-0000-0000-0000-000000aae003" => {
                    assert_eq!(p.access_level, AccessLevel::View)
                }
                "00000000-0000-0000-0000-000000aae001" => {
                    assert_eq!(p.access_level, AccessLevel::Edit)
                }
                "00000000-0000-0000-0000-000000aae002" => {
                    assert_eq!(p.access_level, AccessLevel::Owner)
                }
                _ => panic!("Unexpected entity_id found in results: {}", p.entity_id),
            }
        }

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_project")))]
    async fn test_get_access_starting_from_parent_project(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get permissions for 'user-1' starting from the middle project (parent).
        // EXPECTATION: Should return 2 records: parent and grandparent. It should NOT include child.

        let permissions = get_user_item_access_for_project(
            &pool,
            "00000000-0000-0000-0000-000000aae001",
            "user-1",
        )
        .await?;

        assert_eq!(
            permissions.len(),
            2,
            "Expected 2 access records (self + 1 ancestor)"
        );

        let expected_entity_ids: HashSet<String> = [
            "00000000-0000-0000-0000-000000aae001".to_string(),
            "00000000-0000-0000-0000-000000aae002".to_string(),
        ]
        .into_iter()
        .collect();

        assert_eq!(to_entity_id_set(&permissions), expected_entity_ids);

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_project")))]
    async fn test_project_access_is_correctly_scoped_to_user(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get permissions for 'user-2' on the parent project.
        // EXPECTATION: Should return only the single permission granted to 'user-2', not any of user-1's.

        let permissions = get_user_item_access_for_project(
            &pool,
            "00000000-0000-0000-0000-000000aae001",
            "user-2",
        )
        .await?;

        assert_eq!(
            permissions.len(),
            1,
            "Expected only the access record for user-2"
        );
        let perm = &permissions[0];
        assert_eq!(perm.source_id, "user-2");
        assert_eq!(perm.entity_id, "00000000-0000-0000-0000-000000aae001");
        assert_eq!(perm.access_level, AccessLevel::Comment);

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_project")))]
    async fn test_no_access_for_project_returns_empty(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Query for a user who has no access to a project or its hierarchy.
        // We'll use 'user-1' and ask for the isolated project, which only 'user-2' has access to.
        // EXPECTATION: Should return an empty vector.

        let permissions = get_user_item_access_for_project(
            &pool,
            "00000000-0000-0000-0000-000000aae004",
            "user-1",
        )
        .await?;
        assert!(
            permissions.is_empty(),
            "Expected no permissions to be returned"
        );

        Ok(())
    }

    // ==================== Thread Tests ====================

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_thread")))]
    async fn test_get_access_for_nested_thread(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get all permissions for 'user-1' on the nested thread.
        // EXPECTATION: Should return 3 records:
        // 1. Direct access on the thread.
        // 2. Inherited access from 'p-parent'.
        // 3. Inherited access from 'p-grandparent'.

        let permissions = get_user_item_access_for_thread(
            &pool,
            "e0000000-0000-0000-0000-000000070001",
            "user-1",
        )
        .await?;

        assert_eq!(
            permissions.len(),
            3,
            "Expected 3 access records (direct + 2 inherited)"
        );

        let expected_entity_ids: HashSet<String> = [
            "e0000000-0000-0000-0000-000000070001".to_string(),
            "00000000-0000-0000-0000-000000aae001".to_string(),
            "00000000-0000-0000-0000-000000aae002".to_string(),
        ]
        .into_iter()
        .collect();

        assert_eq!(to_entity_id_set(&permissions), expected_entity_ids);

        // Verify the details of each permission
        for p in permissions {
            match p.entity_id.as_str() {
                "e0000000-0000-0000-0000-000000070001" => {
                    assert_eq!(p.access_level, AccessLevel::View)
                }
                "00000000-0000-0000-0000-000000aae001" => {
                    assert_eq!(p.access_level, AccessLevel::Edit)
                }
                "00000000-0000-0000-0000-000000aae002" => {
                    assert_eq!(p.access_level, AccessLevel::Owner)
                }
                _ => panic!("Unexpected entity_id found in results: {}", p.entity_id),
            }
        }

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_thread")))]
    async fn test_get_access_for_standalone_thread(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get permissions for 'user-1' on the standalone thread, which has no project parent.
        // EXPECTATION: Should return exactly 1 record for the direct permission.

        let permissions = get_user_item_access_for_thread(
            &pool,
            "e0000000-0000-0000-0000-000000070002",
            "user-1",
        )
        .await?;

        assert_eq!(
            permissions.len(),
            1,
            "Expected only one direct access record"
        );
        let perm = &permissions[0];
        assert_eq!(perm.entity_id, "e0000000-0000-0000-0000-000000070002");
        assert_eq!(perm.access_level, AccessLevel::Comment);

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_thread")))]
    async fn test_thread_access_is_correctly_scoped_to_user(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get permissions for 'user-2' on the nested thread.
        // EXPECTATION: Should return only the single permission granted to 'user-2', not any of user-1's permissions.

        let permissions = get_user_item_access_for_thread(
            &pool,
            "e0000000-0000-0000-0000-000000070001",
            "user-2",
        )
        .await?;

        assert_eq!(
            permissions.len(),
            1,
            "Expected only the access record for user-2"
        );
        let perm = &permissions[0];
        assert_eq!(perm.source_id, "user-2");
        assert_eq!(perm.entity_id, "e0000000-0000-0000-0000-000000070001");
        assert_eq!(perm.access_level, AccessLevel::View);

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_thread")))]
    async fn test_no_access_for_thread_returns_empty(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Query for a user who has no access at all to the item or its hierarchy.
        // We'll use 'user-2' and ask for the standalone thread, which only 'user-1' has access to.
        // EXPECTATION: Should return an empty vector.

        let permissions = get_user_item_access_for_thread(
            &pool,
            "e0000000-0000-0000-0000-000000070002",
            "user-2",
        )
        .await?;
        assert!(
            permissions.is_empty(),
            "Expected no permissions to be returned"
        );

        Ok(())
    }
}
