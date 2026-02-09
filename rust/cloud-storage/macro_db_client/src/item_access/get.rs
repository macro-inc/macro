use chrono::{DateTime, Utc};
use model::comms::{ChannelType, ParticipantRole};
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::user_item_access::UserItemAccess;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

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

/// Finds all explicit access permissions for a given user on a project and its entire parent hierarchy.
#[tracing::instrument(skip(db))]
pub async fn get_user_item_access_for_project(
    db: &sqlx::Pool<sqlx::Postgres>,
    project_id: &str,
    user_id: &str,
) -> anyhow::Result<Vec<UserItemAccess>> {
    let access_records = sqlx::query_as!(
        UserItemAccess,
        r#"
        -- recursively finds all parent projects for the given project.
        WITH RECURSIVE project_hierarchy AS (
            -- Base case: Start with the provided project itself.
            SELECT
                p.id as project_id
            FROM
                "Project" p
            WHERE
                p.id = $1 AND p."deletedAt" IS NULL

            UNION ALL

            -- Recursive case: Find the parent of the project from the previous step.
            SELECT
                parent.id as project_id
            FROM
                project_hierarchy ph
            JOIN "Project" parent ON parent.id = (
                SELECT "parentId" FROM "Project" WHERE id = ph.project_id AND "parentId" IS NOT NULL AND "deletedAt" IS NULL
            )
        )
        -- The main query to select from UserItemAccess
        SELECT
            id,
            user_id,
            item_id,
            item_type,
            granted_from_channel_id,
            access_level as "access_level!: AccessLevel",
            created_at as "created_at!: DateTime<Utc>",
            updated_at as "updated_at!: DateTime<Utc>"
        FROM "UserItemAccess"
        WHERE
            -- Filter for the specific user we are interested in.
            user_id = $2
            -- Filter for items that are either the project itself or one of the projects in its hierarchy.
            AND item_id IN (
                SELECT project_id FROM project_hierarchy
            )
        "#,
        project_id,
        user_id,
    )
        .fetch_all(db)
        .await?;

    Ok(access_records)
}

#[tracing::instrument(skip(db))]
pub async fn get_user_item_access_for_document(
    db: &sqlx::Pool<sqlx::Postgres>,
    document_id: &str,
    user_id: &str,
) -> anyhow::Result<Vec<UserItemAccess>> {
    let access_records = sqlx::query_as!(
        UserItemAccess,
        r#"
        -- recursively finds all parent projects for the given document.
        WITH RECURSIVE project_hierarchy AS (
            -- Base case: Start with the project directly associated with the document.
            SELECT
                p.id as project_id
            FROM
                "Document" d
            JOIN "Project" p ON d."projectId" = p.id AND p."deletedAt" IS NULL
            WHERE
                d.id = $1 AND d."deletedAt" IS NULL

            UNION ALL

            -- Recursive case: Find the parent of the project from the previous step.
            SELECT
                parent.id as project_id
            FROM
                project_hierarchy ph
            JOIN "Project" parent ON parent.id = (
                SELECT "parentId" FROM "Project" WHERE id = ph.project_id AND "parentId" IS NOT NULL AND "deletedAt" IS NULL
            )
        )
        -- The main query to select from UserItemAccess
        SELECT
            id,
            user_id,
            item_id,
            item_type,
            granted_from_channel_id,
            -- The `access_level` column is mapped directly to the `AccessLevel` Rust enum
            -- thanks to `#[derive(sqlx::Type)]`.
            access_level as "access_level!: AccessLevel",
            created_at as "created_at!: DateTime<Utc>",
            updated_at as "updated_at!: DateTime<Utc>"
        FROM "UserItemAccess"
        WHERE
            -- Filter for the specific user we are interested in.
            user_id = $2
            AND item_id IN (
                -- The document ID itself
                SELECT $1
                UNION
                -- All project IDs from the recursive CTE
                SELECT project_id FROM project_hierarchy
            )
        "#,
        document_id,
        user_id,
    )
        .fetch_all(db)
        .await?;

    Ok(access_records)
}

/// Finds all explicit access permissions for a given user on a chat and its entire project hierarchy.
#[tracing::instrument(skip(db))]
pub async fn get_user_item_access_for_chat(
    db: &sqlx::Pool<sqlx::Postgres>,
    chat_id: &str,
    user_id: &str,
) -> anyhow::Result<Vec<UserItemAccess>> {
    let access_records = sqlx::query_as!(
        UserItemAccess,
        r#"
        -- recursively finds all parent projects for the given chat.
        WITH RECURSIVE project_hierarchy AS (
            -- Base case: Start with the project directly associated with the chat.
            SELECT
                p.id as project_id
            FROM
                "Chat" c
            JOIN "Project" p ON c."projectId" = p.id AND p."deletedAt" IS NULL
            WHERE
                c.id = $1 AND c."deletedAt" IS NULL

            UNION ALL

            -- Recursive case: Find the parent of the project from the previous step.
            SELECT
                parent.id as project_id
            FROM
                project_hierarchy ph
            JOIN "Project" parent ON parent.id = (
                SELECT "parentId" FROM "Project" WHERE id = ph.project_id AND "parentId" IS NOT NULL AND "deletedAt" IS NULL
            )
        )
        -- The main query to select from UserItemAccess
        SELECT
            id,
            user_id,
            item_id,
            item_type,
            granted_from_channel_id,
            access_level as "access_level!: AccessLevel",
            created_at as "created_at!: DateTime<Utc>",
            updated_at as "updated_at!: DateTime<Utc>"
        FROM "UserItemAccess"
        WHERE
            -- Filter for the specific user we are interested in.
            user_id = $2
            AND item_id IN (
                -- The chat ID itself
                SELECT $1
                UNION
                -- All project IDs from the recursive CTE
                SELECT project_id FROM project_hierarchy
            )
        "#,
        chat_id,
        user_id,
    )
        .fetch_all(db)
        .await?;

    Ok(access_records)
}

/// Finds all explicit access permissions for a given user on an email thread and its entire project hierarchy.
#[tracing::instrument(skip(db))]
pub async fn get_user_item_access_for_thread(
    db: &sqlx::Pool<sqlx::Postgres>,
    thread_id: &str,
    user_id: &str,
) -> anyhow::Result<Vec<UserItemAccess>> {
    let access_records = sqlx::query_as!(
        UserItemAccess,
        r#"
        -- recursively finds all parent projects for the given email thread.
        WITH RECURSIVE project_hierarchy AS (
            -- Base case: Start with the project directly associated with the thread.
            SELECT
                p.id as project_id
            FROM
                "EmailThreadPermission" etp
            JOIN "Project" p ON etp."projectId" = p.id AND p."deletedAt" IS NULL
            WHERE
                etp."threadId" = $1

            UNION ALL

            -- Recursive case: Find the parent of the project from the previous step.
            SELECT
                parent.id as project_id
            FROM
                project_hierarchy ph
            JOIN "Project" parent ON parent.id = (
                SELECT "parentId" FROM "Project" WHERE id = ph.project_id AND "parentId" IS NOT NULL AND "deletedAt" IS NULL
            )
        )
        -- The main query to select from UserItemAccess
        SELECT
            id,
            user_id,
            item_id,
            item_type,
            granted_from_channel_id,
            access_level as "access_level!: AccessLevel",
            created_at as "created_at!: DateTime<Utc>",
            updated_at as "updated_at!: DateTime<Utc>"
        FROM "UserItemAccess"
        WHERE
            -- Filter for the specific user we are interested in.
            user_id = $2
            AND item_id IN (
                -- The thread ID itself
                SELECT $1
                UNION
                -- All project IDs from the recursive CTE
                SELECT project_id FROM project_hierarchy
            )
        "#,
        thread_id,
        user_id,
    )
        .fetch_all(db)
        .await?;

    Ok(access_records)
}

struct ChannelRoleRow {
    role: Option<ParticipantRole>,
    channel_type: ChannelType,
    org_id: Option<i64>,
}

#[tracing::instrument(skip(db), err)]
pub async fn get_user_channel_role(
    db: &Pool<Postgres>,
    channel_id: &Uuid,
    user_id: &str,
    user_org_id: Option<i64>,
) -> anyhow::Result<Option<ParticipantRole>> {
    let row = sqlx::query_as!(
        ChannelRoleRow,
        r#"
        SELECT
            cp.role as "role?: ParticipantRole",
            c.channel_type as "channel_type!: ChannelType",
            c.org_id
        FROM comms_channels c
        LEFT JOIN comms_channel_participants cp
            ON cp.channel_id = c.id AND cp.user_id = $2 AND cp.left_at IS NULL
        WHERE c.id = $1
        "#,
        channel_id,
        user_id,
    )
    .fetch_optional(db)
    .await?;

    let Some(row) = row else {
        return Ok(None);
    };

    let role = match row.channel_type {
        ChannelType::Public => Some(row.role.unwrap_or(ParticipantRole::Member)),
        ChannelType::Organization => {
            let org_match = user_org_id
                .zip(row.org_id)
                .is_some_and(|(user_org, ch_org)| user_org == ch_org);

            if org_match {
                Some(row.role.unwrap_or(ParticipantRole::Member))
            } else {
                row.role
            }
        }
        ChannelType::Private | ChannelType::DirectMessage => row.role,
    };

    Ok(role)
}

#[tracing::instrument(skip(db), err)]
pub async fn channel_exists(db: &Pool<Postgres>, channel_id: &Uuid) -> anyhow::Result<bool> {
    let exists = sqlx::query_scalar::<_, bool>(
        r#"
        SELECT EXISTS(
            SELECT 1
            FROM comms_channels
            WHERE id = $1
        )
        "#,
    )
    .bind(channel_id)
    .fetch_one(db)
    .await?;

    Ok(exists)
}

#[cfg(test)]
mod tests {
    use crate::item_access::get::{
        channel_exists, get_user_channel_role, get_user_item_access_for_chat,
        get_user_item_access_for_document, get_user_item_access_for_project,
        get_user_item_access_for_thread,
    };
    use model::comms::ParticipantRole;
    use models_permissions::share_permission::access_level::AccessLevel;
    use models_permissions::user_item_access::UserItemAccess;
    use std::collections::HashSet;
    use uuid::Uuid;

    // Helper function to make test assertions cleaner
    fn to_item_id_set(records: &[UserItemAccess]) -> HashSet<String> {
        records.iter().map(|r| r.item_id.clone()).collect()
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_doc")))]
    async fn test_get_access_for_nested_document(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get all permissions for 'user-1' on the deeply nested document 'd-child'.
        // EXPECTATION: Should return 3 records:
        // 1. Direct access on 'd-child'.
        // 2. Inherited access from 'p-parent'.
        // 3. Inherited access from 'p-grandparent'.

        let permissions = get_user_item_access_for_document(&pool, "d-child", "user-1").await?;

        assert_eq!(
            permissions.len(),
            3,
            "Expected to find 3 access records (direct + 2 inherited)"
        );

        let expected_item_ids: HashSet<String> = [
            "d-child".to_string(),
            "p-parent".to_string(),
            "p-grandparent".to_string(),
        ]
        .into_iter()
        .collect();

        assert_eq!(to_item_id_set(&permissions), expected_item_ids);

        // Verify the details of each permission
        for p in permissions {
            match p.item_id.as_str() {
                "d-child" => assert_eq!(p.access_level, AccessLevel::View),
                "p-parent" => assert_eq!(p.access_level, AccessLevel::Edit),
                "p-grandparent" => assert_eq!(p.access_level, AccessLevel::Owner),
                _ => panic!("Unexpected item_id found in results"),
            }
        }

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_doc")))]
    async fn test_get_access_for_standalone_document(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get permissions for 'user-1' on 'd-standalone', which has no project parent.
        // EXPECTATION: Should return exactly 1 record for the direct permission.

        let permissions =
            get_user_item_access_for_document(&pool, "d-standalone", "user-1").await?;

        assert_eq!(
            permissions.len(),
            1,
            "Expected only one direct access record"
        );
        let perm = &permissions[0];
        assert_eq!(perm.item_id, "d-standalone");
        assert_eq!(perm.access_level, AccessLevel::Comment);
        assert_eq!(
            perm.granted_from_channel_id,
            Some(Uuid::parse_str("20000000-0000-0000-0000-00000000000c")?)
        );

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_doc")))]
    async fn test_access_is_correctly_scoped_to_user(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get permissions for 'user-2' on 'd-child'.
        // EXPECTATION: Should return only the single permission granted to 'user-2', and none of user-1's permissions.

        let permissions = get_user_item_access_for_document(&pool, "d-child", "user-2").await?;

        assert_eq!(
            permissions.len(),
            1,
            "Expected only the access record for user-2"
        );
        let perm = &permissions[0];
        assert_eq!(perm.user_id, "user-2");
        assert_eq!(perm.item_id, "d-child");
        assert_eq!(perm.access_level, AccessLevel::View);

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_doc")))]
    async fn test_no_access_returns_empty(pool: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
        // SCENARIO: Query for a user who has no access at all to the item or its hierarchy.
        // We'll use 'user-2' and ask for 'd-standalone', which only 'user-1' has access to.
        // EXPECTATION: Should return an empty vector.

        let permissions =
            get_user_item_access_for_document(&pool, "d-standalone", "user-2").await?;
        assert!(
            permissions.is_empty(),
            "Expected no permissions to be returned"
        );

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_chat")))]
    async fn test_get_access_for_nested_chat(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get all permissions for 'user-1' on the nested chat 'chat-child'.
        // EXPECTATION: Should return 3 records:
        // 1. Direct access on 'chat-child'.
        // 2. Inherited access from 'p-parent'.
        // 3. Inherited access from 'p-grandparent'.

        let permissions = get_user_item_access_for_chat(&pool, "chat-child", "user-1").await?;

        assert_eq!(
            permissions.len(),
            3,
            "Expected 3 access records (direct + 2 inherited)"
        );

        let expected_item_ids: HashSet<String> = [
            "chat-child".to_string(),
            "p-parent".to_string(),
            "p-grandparent".to_string(),
        ]
        .into_iter()
        .collect();

        assert_eq!(to_item_id_set(&permissions), expected_item_ids);

        // Verify the details of each permission
        for p in permissions {
            match p.item_id.as_str() {
                "chat-child" => assert_eq!(p.access_level, AccessLevel::View),
                "p-parent" => assert_eq!(p.access_level, AccessLevel::Edit),
                "p-grandparent" => assert_eq!(p.access_level, AccessLevel::Owner),
                _ => panic!("Unexpected item_id found in results: {}", p.item_id),
            }
        }

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_chat")))]
    async fn test_get_access_for_standalone_chat(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get permissions for 'user-1' on 'chat-standalone', which has no project parent.
        // EXPECTATION: Should return exactly 1 record for the direct permission.

        let permissions = get_user_item_access_for_chat(&pool, "chat-standalone", "user-1").await?;

        assert_eq!(
            permissions.len(),
            1,
            "Expected only one direct access record"
        );
        let perm = &permissions[0];
        assert_eq!(perm.item_id, "chat-standalone");
        assert_eq!(perm.access_level, AccessLevel::Comment);

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_chat")))]
    async fn test_chat_access_is_correctly_scoped_to_user(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get permissions for 'user-2' on 'chat-child'.
        // EXPECTATION: Should return only the single permission granted to 'user-2', not any of user-1's permissions.

        let permissions = get_user_item_access_for_chat(&pool, "chat-child", "user-2").await?;

        assert_eq!(
            permissions.len(),
            1,
            "Expected only the access record for user-2"
        );
        let perm = &permissions[0];
        assert_eq!(perm.user_id, "user-2");
        assert_eq!(perm.item_id, "chat-child");
        assert_eq!(perm.access_level, AccessLevel::View);

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_chat")))]
    async fn test_no_access_for_chat_returns_empty(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Query for a user who has no access at all to the item or its hierarchy.
        // We'll use 'user-2' and ask for 'chat-standalone', which only 'user-1' has access to.
        // EXPECTATION: Should return an empty vector.

        let permissions = get_user_item_access_for_chat(&pool, "chat-standalone", "user-2").await?;
        assert!(
            permissions.is_empty(),
            "Expected no permissions to be returned"
        );

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_project")))]
    async fn test_get_access_starting_from_child_project(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get all permissions for 'user-1' starting from the lowest project 'p-child'.
        // EXPECTATION: Should return 3 records, one for the child, parent, and grandparent project.

        let permissions = get_user_item_access_for_project(&pool, "p-child", "user-1").await?;

        assert_eq!(
            permissions.len(),
            3,
            "Expected 3 access records (self + 2 ancestors)"
        );

        let expected_item_ids: HashSet<String> = [
            "p-child".to_string(),
            "p-parent".to_string(),
            "p-grandparent".to_string(),
        ]
        .into_iter()
        .collect();

        assert_eq!(to_item_id_set(&permissions), expected_item_ids);

        // Verify the details of each permission
        for p in permissions {
            match p.item_id.as_str() {
                "p-child" => assert_eq!(p.access_level, AccessLevel::View),
                "p-parent" => assert_eq!(p.access_level, AccessLevel::Edit),
                "p-grandparent" => assert_eq!(p.access_level, AccessLevel::Owner),
                _ => panic!("Unexpected item_id found in results: {}", p.item_id),
            }
        }

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_project")))]
    async fn test_get_access_starting_from_parent_project(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get permissions for 'user-1' starting from the middle project 'p-parent'.
        // EXPECTATION: Should return 2 records: 'p-parent' and 'p-grandparent'. It should NOT include 'p-child'.

        let permissions = get_user_item_access_for_project(&pool, "p-parent", "user-1").await?;

        assert_eq!(
            permissions.len(),
            2,
            "Expected 2 access records (self + 1 ancestor)"
        );

        let expected_item_ids: HashSet<String> =
            ["p-parent".to_string(), "p-grandparent".to_string()]
                .into_iter()
                .collect();

        assert_eq!(to_item_id_set(&permissions), expected_item_ids);

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_project")))]
    async fn test_project_access_is_correctly_scoped_to_user(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get permissions for 'user-2' on 'p-parent'.
        // EXPECTATION: Should return only the single permission granted to 'user-2', not any of user-1's.

        let permissions = get_user_item_access_for_project(&pool, "p-parent", "user-2").await?;

        assert_eq!(
            permissions.len(),
            1,
            "Expected only the access record for user-2"
        );
        let perm = &permissions[0];
        assert_eq!(perm.user_id, "user-2");
        assert_eq!(perm.item_id, "p-parent");
        assert_eq!(perm.access_level, AccessLevel::Comment);

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_project")))]
    async fn test_no_access_for_project_returns_empty(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Query for a user who has no access to a project or its hierarchy.
        // We'll use 'user-1' and ask for 'p-isolated', which only 'user-2' has access to.
        // EXPECTATION: Should return an empty vector.

        let permissions = get_user_item_access_for_project(&pool, "p-isolated", "user-1").await?;
        assert!(
            permissions.is_empty(),
            "Expected no permissions to be returned"
        );

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_thread")))]
    async fn test_get_access_for_nested_thread(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get all permissions for 'user-1' on the nested thread 'thread-nested'.
        // EXPECTATION: Should return 3 records:
        // 1. Direct access on 'thread-nested'.
        // 2. Inherited access from 'p-parent'.
        // 3. Inherited access from 'p-grandparent'.

        let permissions = get_user_item_access_for_thread(&pool, "thread-nested", "user-1").await?;

        assert_eq!(
            permissions.len(),
            3,
            "Expected 3 access records (direct + 2 inherited)"
        );

        let expected_item_ids: HashSet<String> = [
            "thread-nested".to_string(),
            "p-parent".to_string(),
            "p-grandparent".to_string(),
        ]
        .into_iter()
        .collect();

        assert_eq!(to_item_id_set(&permissions), expected_item_ids);

        // Verify the details of each permission
        for p in permissions {
            match p.item_id.as_str() {
                "thread-nested" => assert_eq!(p.access_level, AccessLevel::View),
                "p-parent" => assert_eq!(p.access_level, AccessLevel::Edit),
                "p-grandparent" => assert_eq!(p.access_level, AccessLevel::Owner),
                _ => panic!("Unexpected item_id found in results: {}", p.item_id),
            }
        }

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_thread")))]
    async fn test_get_access_for_standalone_thread(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get permissions for 'user-1' on 'thread-standalone', which has no project parent.
        // EXPECTATION: Should return exactly 1 record for the direct permission.

        let permissions =
            get_user_item_access_for_thread(&pool, "thread-standalone", "user-1").await?;

        assert_eq!(
            permissions.len(),
            1,
            "Expected only one direct access record"
        );
        let perm = &permissions[0];
        assert_eq!(perm.item_id, "thread-standalone");
        assert_eq!(perm.access_level, AccessLevel::Comment);

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_thread")))]
    async fn test_thread_access_is_correctly_scoped_to_user(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Get permissions for 'user-2' on 'thread-nested'.
        // EXPECTATION: Should return only the single permission granted to 'user-2', not any of user-1's permissions.

        let permissions = get_user_item_access_for_thread(&pool, "thread-nested", "user-2").await?;

        assert_eq!(
            permissions.len(),
            1,
            "Expected only the access record for user-2"
        );
        let perm = &permissions[0];
        assert_eq!(perm.user_id, "user-2");
        assert_eq!(perm.item_id, "thread-nested");
        assert_eq!(perm.access_level, AccessLevel::View);

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("uia_access_level_thread")))]
    async fn test_no_access_for_thread_returns_empty(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        // SCENARIO: Query for a user who has no access at all to the item or its hierarchy.
        // We'll use 'user-2' and ask for 'thread-standalone', which only 'user-1' has access to.
        // EXPECTATION: Should return an empty vector.

        let permissions =
            get_user_item_access_for_thread(&pool, "thread-standalone", "user-2").await?;
        assert!(
            permissions.is_empty(),
            "Expected no permissions to be returned"
        );

        Ok(())
    }

    const PUBLIC_CH: &str = "a0000000-0000-0000-0000-000000000001";
    const ORG_CH: &str = "a0000000-0000-0000-0000-000000000002";
    const PRIVATE_CH: &str = "a0000000-0000-0000-0000-000000000003";

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_channel_role")))]
    async fn test_public_channel_non_participant_defaults_to_member(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        let role =
            get_user_channel_role(&pool, &Uuid::parse_str(PUBLIC_CH)?, "user-1", Some(1)).await?;
        assert_eq!(role, Some(ParticipantRole::Member));
        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_channel_role")))]
    async fn test_org_channel_matching_org_defaults_non_matching_org_rejected(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        let ch = Uuid::parse_str(ORG_CH)?;

        let role = get_user_channel_role(&pool, &ch, "user-2", Some(1)).await?;
        assert_eq!(role, Some(ParticipantRole::Member));

        let role = get_user_channel_role(&pool, &ch, "user-2", Some(999)).await?;
        assert_eq!(role, None);

        let role = get_user_channel_role(&pool, &ch, "user-1", Some(1)).await?;
        assert_eq!(role, Some(ParticipantRole::Admin));

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_channel_role")))]
    async fn test_private_channel_requires_participation(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        let ch = Uuid::parse_str(PRIVATE_CH)?;

        let role = get_user_channel_role(&pool, &ch, "user-1", Some(1)).await?;
        assert_eq!(role, Some(ParticipantRole::Owner));

        let role = get_user_channel_role(&pool, &ch, "user-2", None).await?;
        assert_eq!(role, None);

        Ok(())
    }

    #[sqlx::test(fixtures(path = "../../fixtures", scripts("user_channel_role")))]
    async fn test_channel_exists_returns_expected_values(
        pool: sqlx::Pool<sqlx::Postgres>,
    ) -> anyhow::Result<()> {
        let existing = Uuid::parse_str(PRIVATE_CH)?;
        assert!(channel_exists(&pool, &existing).await?);

        let missing = Uuid::parse_str("ffffffff-ffff-ffff-ffff-ffffffffffff")?;
        assert!(!channel_exists(&pool, &missing).await?);

        Ok(())
    }
}
