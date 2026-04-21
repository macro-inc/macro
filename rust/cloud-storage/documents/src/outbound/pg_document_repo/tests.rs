use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::channel_share_permission::{
    UpdateChannelSharePermission, UpdateOperation,
};
use sqlx::{Pool, Postgres};

use crate::domain::models::{EditDocumentRepoArgs, FileTypeUpdate};
use crate::domain::ports::DocumentRepo;
use crate::outbound::pg_document_repo::PgDocumentRepo;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_get_document_metadata(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool);

    // Document exists
    let metadata = repo
        .get_document_metadata("d0000000-0000-0000-0000-000000000001")
        .await
        .unwrap();
    assert_eq!(metadata.document_id, "d0000000-0000-0000-0000-000000000001");
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

    let basic = repo
        .get_basic_document("d0000000-0000-0000-0000-000000000001")
        .await
        .unwrap();
    assert_eq!(basic.document_id, "d0000000-0000-0000-0000-000000000001");
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

    repo.soft_delete_document("d0000000-0000-0000-0000-000000000001")
        .await
        .unwrap();

    // Verify deleted_at is set
    let row = sqlx::query!(
        r#"SELECT "deletedAt"::timestamptz as deleted_at FROM "Document" WHERE id = $1"#,
        "d0000000-0000-0000-0000-000000000001"
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
        .get_latest_document_version_id("d0000000-0000-0000-0000-000000000001")
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

    let (version_id, _uploaded) = repo
        .get_document_version_id("d0000000-0000-0000-0000-000000000001")
        .await
        .unwrap();
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
        .get_user_view_location(
            "macro|user@user.com",
            "d0000000-0000-0000-0000-000000000001",
        )
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
        document_id: "d0000000-0000-0000-0000-000000000001".to_string(),
        document_name: Some("new-name".to_string()),
        project_id: None,
        share_permission: None,
        file_type: None,
    })
    .await
    .unwrap();

    let doc = repo
        .get_basic_document("d0000000-0000-0000-0000-000000000001")
        .await
        .unwrap();
    assert_eq!(doc.document_name, "new-name");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_edit_document_set_file_type(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());

    repo.edit_document(EditDocumentRepoArgs {
        document_id: "d0000000-0000-0000-0000-000000000001".to_string(),
        document_name: None,
        project_id: None,
        share_permission: None,
        file_type: Some(FileTypeUpdate::Set(model_file_type::FileType::Rs)),
    })
    .await
    .unwrap();

    let doc = repo
        .get_basic_document("d0000000-0000-0000-0000-000000000001")
        .await
        .unwrap();
    assert_eq!(doc.file_type, Some("rs".to_string()));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_edit_document_clear_file_type(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());

    repo.edit_document(EditDocumentRepoArgs {
        document_id: "d0000000-0000-0000-0000-000000000001".to_string(),
        document_name: None,
        project_id: None,
        share_permission: None,
        file_type: Some(FileTypeUpdate::Clear),
    })
    .await
    .unwrap();

    let doc = repo
        .get_basic_document("d0000000-0000-0000-0000-000000000001")
        .await
        .unwrap();
    assert_eq!(doc.file_type, None);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_edit_document_project(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());

    repo.edit_document(EditDocumentRepoArgs {
        document_id: "d0000000-0000-0000-0000-000000000001".to_string(),
        document_name: None,
        project_id: Some("d0000000-0000-0000-0000-100000000001".to_string()),
        share_permission: None,
        file_type: None,
    })
    .await
    .unwrap();

    let doc = repo
        .get_basic_document("d0000000-0000-0000-0000-000000000001")
        .await
        .unwrap();
    assert_eq!(
        doc.project_id,
        Some("d0000000-0000-0000-0000-100000000001".to_string())
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_edit_document_remove_project(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());

    // First set a project
    repo.edit_document(EditDocumentRepoArgs {
        document_id: "d0000000-0000-0000-0000-000000000001".to_string(),
        document_name: None,
        project_id: Some("d0000000-0000-0000-0000-100000000001".to_string()),
        share_permission: None,
        file_type: None,
    })
    .await
    .unwrap();

    let doc = repo
        .get_basic_document("d0000000-0000-0000-0000-000000000001")
        .await
        .unwrap();
    assert_eq!(
        doc.project_id,
        Some("d0000000-0000-0000-0000-100000000001".to_string())
    );

    // Then remove it by passing empty string
    repo.edit_document(EditDocumentRepoArgs {
        document_id: "d0000000-0000-0000-0000-000000000001".to_string(),
        document_name: None,
        project_id: Some("".to_string()),
        share_permission: None,
        file_type: None,
    })
    .await
    .unwrap();

    let doc = repo
        .get_basic_document("d0000000-0000-0000-0000-000000000001")
        .await
        .unwrap();
    assert_eq!(doc.project_id, None);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_edit_document_share_permission(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());

    repo.edit_document(EditDocumentRepoArgs {
        document_id: "d0000000-0000-0000-0000-000000000001".to_string(),
        document_name: None,
        project_id: None,
        share_permission: Some(UpdateSharePermissionRequestV2 {
            is_public: Some(false),
            public_access_level: None,
            channel_share_permissions: None,
        }),
        file_type: None,
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
        "d0000000-0000-0000-0000-000000000001"
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
        document_id: "d0000000-0000-0000-0000-000000000001".to_string(),
        document_name: None,
        project_id: None,
        share_permission: Some(UpdateSharePermissionRequestV2 {
            is_public: None,
            public_access_level: Some(AccessLevel::Edit),
            channel_share_permissions: None,
        }),
        file_type: None,
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
        "d0000000-0000-0000-0000-000000000001"
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
        document_id: "d0000000-0000-0000-0000-000000000001".to_string(),
        document_name: Some("renamed".to_string()),
        project_id: Some("d0000000-0000-0000-0000-100000000001".to_string()),
        share_permission: Some(UpdateSharePermissionRequestV2 {
            is_public: Some(true),
            public_access_level: Some(AccessLevel::Edit),
            channel_share_permissions: None,
        }),
        file_type: None,
    })
    .await
    .unwrap();

    let doc = repo
        .get_basic_document("d0000000-0000-0000-0000-000000000001")
        .await
        .unwrap();
    assert_eq!(doc.document_name, "renamed");
    assert_eq!(
        doc.project_id,
        Some("d0000000-0000-0000-0000-100000000001".to_string())
    );

    let result = sqlx::query!(
        r#"
        SELECT sp."isPublic" as is_public, sp."publicAccessLevel" as "public_access_level?"
        FROM "SharePermission" sp
        JOIN "DocumentPermission" dp ON dp."sharePermissionId" = sp.id
        WHERE dp."documentId" = $1
        "#,
        "d0000000-0000-0000-0000-000000000001"
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

    repo.share_with_team(
        "macro|user@user.com",
        "d0000000-0000-0000-0000-000000000001",
    )
    .await
    .unwrap();

    // All 3 team members should have access rows
    let doc_uuid = macro_uuid::string_to_uuid("d0000000-0000-0000-0000-000000000001").unwrap();
    let rows = sqlx::query!(
        r#"
        SELECT source_id, access_level::text as "access_level"
        FROM entity_access
        WHERE entity_id = $1 AND entity_type = 'document'
        ORDER BY source_id
        "#,
        doc_uuid,
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(rows.len(), 2); // 1 owner and 1 team

    // Owner row should still be 'owner' (not downgraded)
    let owner_row = rows
        .iter()
        .find(|r| r.source_id == "macro|user@user.com")
        .unwrap();
    assert_eq!(owner_row.access_level, Some("owner".to_string()));

    // Teammates should have 'comment' access
    let t1 = rows
        .iter()
        .find(|r| r.source_id == "a0000000-0000-0000-0000-000000000001")
        .unwrap();
    assert_eq!(t1.access_level, Some("comment".to_string()));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_share_with_team_no_op_when_user_not_on_team(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());

    // teammate1 is on a team, but let's use a user that isn't on any team
    // We'll use a non-existent user id to simulate no team membership
    repo.share_with_team(
        "macro|no-team@user.com",
        "d0000000-0000-0000-0000-000000000001",
    )
    .await
    .unwrap();

    // Only the pre-existing owner row should exist
    let doc_uuid = macro_uuid::string_to_uuid("d0000000-0000-0000-0000-000000000001").unwrap();
    let count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!"
        FROM entity_access
        WHERE entity_id = $1 AND entity_type = 'document'
        "#,
        doc_uuid,
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
    repo.share_with_team(
        "macro|user@user.com",
        "d0000000-0000-0000-0000-000000000001",
    )
    .await
    .unwrap();
    repo.share_with_team(
        "macro|user@user.com",
        "d0000000-0000-0000-0000-000000000001",
    )
    .await
    .unwrap();

    let doc_uuid = macro_uuid::string_to_uuid("d0000000-0000-0000-0000-000000000001").unwrap();
    let count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!"
        FROM entity_access
        WHERE entity_id = $1 AND entity_type = 'document'
        "#,
        doc_uuid,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(count, 2); // owner + 1 team, no duplicates
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_share_with_team_skips_user_with_existing_direct_access(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());

    let doc_uuid = macro_uuid::string_to_uuid("d0000000-0000-0000-0000-000000000001").unwrap();

    // Give teammate1 direct user-sourced edit access before team sharing
    sqlx::query!(
        r#"
        INSERT INTO entity_access
            (entity_id, entity_type, source_id, source_type, access_level)
        VALUES ($1, 'document', 'macro|teammate1@user.com', 'user', 'edit')
        "#,
        doc_uuid,
    )
    .execute(&pool)
    .await
    .unwrap();

    repo.share_with_team(
        "macro|user@user.com",
        "d0000000-0000-0000-0000-000000000001",
    )
    .await
    .unwrap();

    // teammate1 should still have just their original edit row, not a second comment row
    let rows = sqlx::query!(
        r#"
        SELECT access_level::text as "access_level"
        FROM entity_access
        WHERE entity_id = $1 AND entity_type = 'document'
          AND source_id = 'macro|teammate1@user.com' AND source_type = 'user'
        "#,
        doc_uuid,
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

    // A teammate (not the owner) triggers the share — should still find the
    // same team and share with all members including the owner.
    repo.share_with_team(
        "macro|teammate1@user.com",
        "d0000000-0000-0000-0000-000000000001",
    )
    .await
    .unwrap();

    let doc_uuid = macro_uuid::string_to_uuid("d0000000-0000-0000-0000-000000000001").unwrap();
    let rows = sqlx::query!(
        r#"
        SELECT source_id, access_level::text as "access_level"
        FROM entity_access
        WHERE entity_id = $1 AND entity_type = 'document'
        ORDER BY source_id
        "#,
        doc_uuid,
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    // Owner keeps their original owner row (no duplicate), teammates get comment
    assert_eq!(rows.len(), 2);

    let owner = rows
        .iter()
        .find(|r| r.source_id == "macro|user@user.com")
        .unwrap();
    assert_eq!(owner.access_level, Some("owner".to_string()));

    let t1 = rows
        .iter()
        .find(|r| r.source_id == "a0000000-0000-0000-0000-000000000001")
        .unwrap();
    assert_eq!(t1.access_level, Some("comment".to_string()));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_edit_document_channel_share_creates_user_item_access(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());
    let channel_id = "c0000000-0000-0000-0000-000000000001";

    repo.edit_document(EditDocumentRepoArgs {
        document_id: "d0000000-0000-0000-0000-000000000001".to_string(),
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
        file_type: None,
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

    // Verify entity_access rows were created for the channel
    let doc_uuid = macro_uuid::string_to_uuid("d0000000-0000-0000-0000-000000000001").unwrap();

    let access_rows = sqlx::query!(
        r#"
        SELECT source_id, access_level::text as "access_level", source_type::text as "source_type"
        FROM entity_access
        WHERE entity_id = $1
          AND entity_type = 'document'
          AND source_id = $2
          AND source_type = 'channel'
        "#,
        doc_uuid,
        channel_id,
    )
    .fetch_all(&pool)
    .await
    .unwrap();

    assert_eq!(
        access_rows.len(),
        1,
        "Channel should have one entity_access row"
    );

    assert_eq!(access_rows[0].access_level, Some("view".to_string()));
    assert_eq!(access_rows[0].source_id, channel_id);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_edit_document_channel_share_idempotent(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());
    let channel_id = "c0000000-0000-0000-0000-000000000001";

    let make_args = || EditDocumentRepoArgs {
        document_id: "d0000000-0000-0000-0000-000000000001".to_string(),
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
        file_type: None,
    };

    // Call twice — second call should upsert without duplicates
    repo.edit_document(make_args()).await.unwrap();
    repo.edit_document(make_args()).await.unwrap();

    let doc_uuid = macro_uuid::string_to_uuid("d0000000-0000-0000-0000-000000000001").unwrap();
    let count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!"
        FROM entity_access
        WHERE entity_id = $1
          AND entity_type = 'document'
          AND source_id = $2
          AND source_type = 'channel'
        "#,
        doc_uuid,
        channel_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(
        count, 1,
        "Should still have exactly 1 channel row after idempotent upsert"
    );
}
