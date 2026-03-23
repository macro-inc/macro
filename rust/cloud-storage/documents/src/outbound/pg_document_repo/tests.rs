use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::channel_share_permission::{
    UpdateChannelSharePermission, UpdateOperation,
};
use sqlx::{Pool, Postgres};

use crate::domain::models::EditDocumentRepoArgs;
use crate::domain::ports::DocumentRepo;
use crate::outbound::pg_document_repo::PgDocumentRepo;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_get_document_metadata(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool);

    // Document exists
    let metadata = repo.get_document_metadata("document-one").await.unwrap();
    assert_eq!(metadata.document_id, "document-one");
    assert_eq!(metadata.document_name, "test_document_name");
    assert_eq!(metadata.owner.as_ref(), "macro|user@user.com");
    assert_eq!(metadata.document_version_id, 1);
    assert_eq!(metadata.file_type, Some("txt".to_string()));

    // Document does not exist
    let result = repo.get_document_metadata("nonexistent").await;
    assert!(result.is_err());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_get_basic_document(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool);

    let basic = repo.get_basic_document("document-one").await.unwrap();
    assert_eq!(basic.document_id, "document-one");
    assert_eq!(basic.document_name, "test_document_name");
    assert_eq!(basic.owner.as_ref(), "macro|user@user.com");
    assert_eq!(basic.file_type, Some("txt".to_string()));

    // Not found
    let result = repo.get_basic_document("nonexistent").await;
    assert!(result.is_err());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_soft_delete_document(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());

    repo.soft_delete_document("document-one").await.unwrap();

    // Verify deleted_at is set
    let row = sqlx::query!(
        r#"SELECT "deletedAt"::timestamptz as deleted_at FROM "Document" WHERE id = $1"#,
        "document-one"
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(row.deleted_at.is_some());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_get_latest_document_version_id(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool);

    let (version_id, _uploaded) = repo
        .get_latest_document_version_id("document-one")
        .await
        .unwrap();
    assert_eq!(version_id, 1);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_get_document_version_id(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool);

    let (version_id, _uploaded) = repo.get_document_version_id("document-one").await.unwrap();
    assert_eq!(version_id, 1);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_get_user_view_location(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool);

    // No view location exists
    let location = repo
        .get_user_view_location("macro|user@user.com", "document-one")
        .await
        .unwrap();
    assert!(location.is_none());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_edit_document_name(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());

    repo.edit_document(EditDocumentRepoArgs {
        document_id: "document-one".to_string(),
        document_name: Some("new-name".to_string()),
        project_id: None,
        share_permission: None,
    })
    .await
    .unwrap();

    let doc = repo.get_basic_document("document-one").await.unwrap();
    assert_eq!(doc.document_name, "new-name");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_edit_document_project(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());

    repo.edit_document(EditDocumentRepoArgs {
        document_id: "document-one".to_string(),
        document_name: None,
        project_id: Some("new-project".to_string()),
        share_permission: None,
    })
    .await
    .unwrap();

    let doc = repo.get_basic_document("document-one").await.unwrap();
    assert_eq!(doc.project_id, Some("new-project".to_string()));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_edit_document_remove_project(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());

    // First set a project
    repo.edit_document(EditDocumentRepoArgs {
        document_id: "document-one".to_string(),
        document_name: None,
        project_id: Some("new-project".to_string()),
        share_permission: None,
    })
    .await
    .unwrap();

    let doc = repo.get_basic_document("document-one").await.unwrap();
    assert_eq!(doc.project_id, Some("new-project".to_string()));

    // Then remove it by passing empty string
    repo.edit_document(EditDocumentRepoArgs {
        document_id: "document-one".to_string(),
        document_name: None,
        project_id: Some("".to_string()),
        share_permission: None,
    })
    .await
    .unwrap();

    let doc = repo.get_basic_document("document-one").await.unwrap();
    assert_eq!(doc.project_id, None);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_edit_document_share_permission(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());

    repo.edit_document(EditDocumentRepoArgs {
        document_id: "document-one".to_string(),
        document_name: None,
        project_id: None,
        share_permission: Some(UpdateSharePermissionRequestV2 {
            is_public: Some(false),
            public_access_level: None,
            channel_share_permissions: None,
        }),
    })
    .await
    .unwrap();

    // Verify the share permission was updated
    let result = sqlx::query!(
        r#"
        SELECT sp."isPublic" as is_public, sp."publicAccessLevel" as "public_access_level?"
        FROM "SharePermission" sp
        JOIN "DocumentPermission" dp ON dp."sharePermissionId" = sp.id
        WHERE dp."documentId" = $1
        "#,
        "document-one"
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(!result.is_public);
    assert!(result.public_access_level.is_none());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_edit_document_set_public_access_level(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());

    repo.edit_document(EditDocumentRepoArgs {
        document_id: "document-one".to_string(),
        document_name: None,
        project_id: None,
        share_permission: Some(UpdateSharePermissionRequestV2 {
            is_public: None,
            public_access_level: Some(AccessLevel::Edit),
            channel_share_permissions: None,
        }),
    })
    .await
    .unwrap();

    let result = sqlx::query!(
        r#"
        SELECT sp."publicAccessLevel" as "public_access_level?"
        FROM "SharePermission" sp
        JOIN "DocumentPermission" dp ON dp."sharePermissionId" = sp.id
        WHERE dp."documentId" = $1
        "#,
        "document-one"
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(result.public_access_level, Some("edit".to_string()));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_edit_document_name_and_project(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());

    repo.edit_document(EditDocumentRepoArgs {
        document_id: "document-one".to_string(),
        document_name: Some("renamed".to_string()),
        project_id: Some("new-project".to_string()),
        share_permission: Some(UpdateSharePermissionRequestV2 {
            is_public: Some(true),
            public_access_level: Some(AccessLevel::Edit),
            channel_share_permissions: None,
        }),
    })
    .await
    .unwrap();

    let doc = repo.get_basic_document("document-one").await.unwrap();
    assert_eq!(doc.document_name, "renamed");
    assert_eq!(doc.project_id, Some("new-project".to_string()));

    let result = sqlx::query!(
        r#"
        SELECT sp."isPublic" as is_public, sp."publicAccessLevel" as "public_access_level?"
        FROM "SharePermission" sp
        JOIN "DocumentPermission" dp ON dp."sharePermissionId" = sp.id
        WHERE dp."documentId" = $1
        "#,
        "document-one"
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(result.is_public);
    assert_eq!(result.public_access_level, Some("edit".to_string()));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_share_with_team_creates_access_for_team_members(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());

    repo.share_with_team("macro|user@user.com", "document-one")
        .await
        .unwrap();

    let team_id = uuid::Uuid::parse_str("a0000000-0000-0000-0000-000000000001").unwrap();

    // All 3 team members should have access rows
    let rows = sqlx::query!(
        r#"
        SELECT "user_id", "access_level"::text as "access_level", "granted_from_team_id"
        FROM "UserItemAccess"
        WHERE "item_id" = 'document-one' AND "item_type" = 'document'
        ORDER BY "user_id"
        "#,
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(rows.len(), 3);

    // Owner row should still be 'owner' (not downgraded) and have no team grant
    let owner_row = rows
        .iter()
        .find(|r| r.user_id == "macro|user@user.com")
        .unwrap();
    assert_eq!(owner_row.access_level, Some("owner".to_string()));
    assert_eq!(owner_row.granted_from_team_id, None);

    // Teammates should have 'comment' access with granted_from_team_id set
    let t1 = rows
        .iter()
        .find(|r| r.user_id == "macro|teammate1@user.com")
        .unwrap();
    assert_eq!(t1.access_level, Some("comment".to_string()));
    assert_eq!(t1.granted_from_team_id, Some(team_id));

    let t2 = rows
        .iter()
        .find(|r| r.user_id == "macro|teammate2@user.com")
        .unwrap();
    assert_eq!(t2.access_level, Some("comment".to_string()));
    assert_eq!(t2.granted_from_team_id, Some(team_id));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_share_with_team_no_op_when_user_not_on_team(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());

    // teammate1 is on a team, but let's use a user that isn't on any team
    // We'll use a non-existent user id to simulate no team membership
    repo.share_with_team("macro|no-team@user.com", "document-one")
        .await
        .unwrap();

    // Only the pre-existing owner row should exist
    let count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!"
        FROM "UserItemAccess"
        WHERE "item_id" = 'document-one' AND "item_type" = 'document'
        "#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(count, 1); // just the owner row from fixtures
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_share_with_team_idempotent(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());

    // Call twice — second call should be a no-op
    repo.share_with_team("macro|user@user.com", "document-one")
        .await
        .unwrap();
    repo.share_with_team("macro|user@user.com", "document-one")
        .await
        .unwrap();

    let count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!"
        FROM "UserItemAccess"
        WHERE "item_id" = 'document-one' AND "item_type" = 'document'
        "#,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(count, 3); // owner + 2 teammates, no duplicates
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_share_with_team_preserves_channel_granted_access(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());

    // Give teammate1 access via a channel before team sharing
    let channel_id = uuid::Uuid::now_v7();
    sqlx::query!(
        r#"
        INSERT INTO "UserItemAccess"
            ("id", "user_id", "item_id", "item_type", "access_level",
             "granted_from_channel_id", "created_at", "updated_at")
        VALUES ($1, $2, 'document-one', 'document', 'edit', $3, NOW(), NOW())
        "#,
        uuid::Uuid::now_v7(),
        "macro|teammate1@user.com",
        channel_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    repo.share_with_team("macro|user@user.com", "document-one")
        .await
        .unwrap();

    // teammate1 should have both: channel-granted edit + team-shared comment
    let rows = sqlx::query!(
        r#"
        SELECT "access_level"::text as "access_level", "granted_from_channel_id"
        FROM "UserItemAccess"
        WHERE "item_id" = 'document-one' AND "item_type" = 'document'
          AND "user_id" = 'macro|teammate1@user.com'
        ORDER BY "granted_from_channel_id" NULLS LAST
        "#,
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].access_level, Some("edit".to_string()));
    assert_eq!(rows[0].granted_from_channel_id, Some(channel_id));
    assert_eq!(rows[1].access_level, Some("comment".to_string()));
    assert!(rows[1].granted_from_channel_id.is_none());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_share_with_team_skips_user_with_existing_direct_access(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());

    // Give teammate1 direct (non-channel) edit access before team sharing
    sqlx::query!(
        r#"
        INSERT INTO "UserItemAccess"
            ("id", "user_id", "item_id", "item_type", "access_level",
             "granted_from_channel_id", "created_at", "updated_at")
        VALUES ($1, $2, 'document-one', 'document', 'edit', NULL, NOW(), NOW())
        "#,
        uuid::Uuid::now_v7(),
        "macro|teammate1@user.com",
    )
    .execute(&pool)
    .await
    .unwrap();

    repo.share_with_team("macro|user@user.com", "document-one")
        .await
        .unwrap();

    // teammate1 should still have just their original edit row, not a second comment row
    let rows = sqlx::query!(
        r#"
        SELECT "access_level"::text as "access_level"
        FROM "UserItemAccess"
        WHERE "item_id" = 'document-one' AND "item_type" = 'document'
          AND "user_id" = 'macro|teammate1@user.com'
        "#,
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].access_level, Some("edit".to_string()));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_share_with_team_called_by_teammate(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());

    let team_id = uuid::Uuid::parse_str("a0000000-0000-0000-0000-000000000001").unwrap();

    // A teammate (not the owner) triggers the share — should still find the
    // same team and share with all members including the owner.
    repo.share_with_team("macro|teammate1@user.com", "document-one")
        .await
        .unwrap();

    let rows = sqlx::query!(
        r#"
        SELECT "user_id", "access_level"::text as "access_level", "granted_from_team_id"
        FROM "UserItemAccess"
        WHERE "item_id" = 'document-one' AND "item_type" = 'document'
        ORDER BY "user_id"
        "#,
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    // Owner keeps their original owner row (no duplicate), teammates get comment
    assert_eq!(rows.len(), 3);

    let owner = rows
        .iter()
        .find(|r| r.user_id == "macro|user@user.com")
        .unwrap();
    assert_eq!(owner.access_level, Some("owner".to_string()));

    let t1 = rows
        .iter()
        .find(|r| r.user_id == "macro|teammate1@user.com")
        .unwrap();
    assert_eq!(t1.access_level, Some("comment".to_string()));
    assert_eq!(t1.granted_from_team_id, Some(team_id));

    let t2 = rows
        .iter()
        .find(|r| r.user_id == "macro|teammate2@user.com")
        .unwrap();
    assert_eq!(t2.access_level, Some("comment".to_string()));
    assert_eq!(t2.granted_from_team_id, Some(team_id));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_edit_document_channel_share_creates_user_item_access(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());
    let channel_id = "c0000000-0000-0000-0000-000000000001";

    repo.edit_document(EditDocumentRepoArgs {
        document_id: "document-one".to_string(),
        document_name: None,
        project_id: None,
        share_permission: Some(UpdateSharePermissionRequestV2 {
            is_public: None,
            public_access_level: None,
            channel_share_permissions: Some(vec![UpdateChannelSharePermission {
                operation: UpdateOperation::Add,
                channel_id: channel_id.to_string(),
                access_level: Some(AccessLevel::View),
            }]),
        }),
    })
    .await
    .unwrap();

    // Verify ChannelSharePermission was created
    let csp_count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!"
        FROM "ChannelSharePermission"
        WHERE "channel_id" = $1::text
        "#,
        channel_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(
        csp_count, 1,
        "Should have created one ChannelSharePermission"
    );

    // Verify UserItemAccess rows were created for all 3 active channel participants
    let channel_uuid = uuid::Uuid::parse_str(channel_id).unwrap();

    let access_rows = sqlx::query!(
        r#"
        SELECT "user_id", "access_level"::text as "access_level", "granted_from_channel_id"
        FROM "UserItemAccess"
        WHERE "item_id" = 'document-one'
          AND "item_type" = 'document'
          AND "granted_from_channel_id" = $1
        ORDER BY "user_id"
        "#,
        channel_uuid,
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(
        access_rows.len(),
        3,
        "All 3 channel participants should have UserItemAccess rows"
    );

    for row in &access_rows {
        assert_eq!(row.access_level, Some("view".to_string()));
        assert_eq!(row.granted_from_channel_id, Some(channel_uuid));
    }

    let user_ids: Vec<&str> = access_rows.iter().map(|r| r.user_id.as_str()).collect();
    assert!(user_ids.contains(&"macro|user@user.com"));
    assert!(user_ids.contains(&"macro|teammate1@user.com"));
    assert!(user_ids.contains(&"macro|teammate2@user.com"));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_edit_document_channel_share_idempotent(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());
    let channel_id = "c0000000-0000-0000-0000-000000000001";
    let channel_uuid = uuid::Uuid::parse_str(channel_id).unwrap();

    let make_args = || EditDocumentRepoArgs {
        document_id: "document-one".to_string(),
        document_name: None,
        project_id: None,
        share_permission: Some(UpdateSharePermissionRequestV2 {
            is_public: None,
            public_access_level: None,
            channel_share_permissions: Some(vec![UpdateChannelSharePermission {
                operation: UpdateOperation::Add,
                channel_id: channel_id.to_string(),
                access_level: Some(AccessLevel::View),
            }]),
        }),
    };

    // Call twice — second call should upsert without duplicates
    repo.edit_document(make_args()).await.unwrap();
    repo.edit_document(make_args()).await.unwrap();

    let count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!"
        FROM "UserItemAccess"
        WHERE "item_id" = 'document-one'
          AND "item_type" = 'document'
          AND "granted_from_channel_id" = $1
        "#,
        channel_uuid,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(
        count, 3,
        "Should still have exactly 3 rows after idempotent upsert"
    );
}
