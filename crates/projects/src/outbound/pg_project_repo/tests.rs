use std::collections::HashMap;

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model::document::FileType;
use model::folder::{FileSystemNode, FileSystemNodeWithIds, FolderItem};
use model::item::Item;
use model::project::ProjectPreviewV2;
use models_permissions::share_permission::access_level::AccessLevel;
use sqlx::{Pool, Postgres};

use super::PgProjectRepo;
use crate::domain::models::{CreateProjectArgs, EditProjectArgs, UploadFolderRepoArgs};
use crate::domain::ports::ProjectRepo;

const ROOT_ID: &str = "10000000-0000-0000-0000-000000000001";
const CHILD_ID: &str = "10000000-0000-0000-0000-000000000002";
const DELETED_ID: &str = "10000000-0000-0000-0000-000000000009";

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn history_listing_differs_from_owner_pending_listing(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgProjectRepo::new(pool);

    let viewed = repo.get_projects_for_user("macro|viewer@test.com").await?;
    assert_eq!(
        viewed
            .iter()
            .map(|project| project.id.as_str())
            .collect::<Vec<_>>(),
        vec!["10000000-0000-0000-0000-000000000005", ROOT_ID]
    );

    let owner_pending = repo
        .get_pending_root_projects("macro|owner@test.com")
        .await?;
    assert_eq!(owner_pending.len(), 1);
    assert_eq!(
        owner_pending[0].project.id,
        "10000000-0000-0000-0000-000000000006"
    );
    assert_eq!(
        owner_pending[0].upload_request_id.as_deref(),
        Some("request-owner")
    );

    let viewer_pending = repo
        .get_pending_root_projects("macro|viewer@test.com")
        .await?;
    assert_eq!(viewer_pending.len(), 1);
    assert_eq!(
        viewer_pending[0].project.id,
        "10000000-0000-0000-0000-000000000007"
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn basic_lookup_includes_deleted_but_full_lookup_excludes_it(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgProjectRepo::new(pool);

    let basic = repo
        .get_basic_project(DELETED_ID)
        .await?
        .expect("deleted project");
    assert!(basic.deleted_at.is_some());
    assert!(repo.get_project_by_id(DELETED_ID).await?.is_none());
    assert!(repo.get_project_by_id(ROOT_ID).await?.is_some());
    assert!(repo.get_basic_project("missing").await?.is_none());
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn children_are_depth_one_filtered_and_type_ordered(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgProjectRepo::new(pool);
    let children = repo.get_project_children(ROOT_ID).await?;

    let children = children
        .into_iter()
        .map(|item| match item {
            Item::Project(project) => ("project", project.id),
            Item::Document(document) => ("document", document.document_id),
            Item::Chat(chat) => ("chat", chat.id),
        })
        .collect::<Vec<_>>();
    assert_eq!(
        children,
        vec![
            ("project", CHILD_ID.to_owned()),
            (
                "document",
                "20000000-0000-0000-0000-000000000001".to_owned()
            ),
            ("chat", "30000000-0000-0000-0000-000000000001".to_owned()),
        ]
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn preview_preserves_found_and_missing_input_entries(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgProjectRepo::new(pool);
    let missing = "10000000-0000-0000-0000-000000000099".to_owned();
    let previews = repo
        .batch_get_project_preview(&[CHILD_ID.to_owned(), missing.clone()])
        .await?;

    match &previews[0] {
        ProjectPreviewV2::Found(project) => {
            assert_eq!(project.id, CHILD_ID);
            assert_eq!(project.path, vec!["Root", "First child"]);
        }
        ProjectPreviewV2::DoesNotExist(_) => panic!("child should exist"),
    }
    match &previews[1] {
        ProjectPreviewV2::DoesNotExist(project) => assert_eq!(project.id, missing),
        ProjectPreviewV2::Found(_) => panic!("missing project should not be found"),
    }
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn reads_share_permissions_and_bumps_modified_timestamp(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgProjectRepo::new(pool);
    let permission = repo.get_project_share_permission(ROOT_ID).await?;
    assert_eq!(permission.id, "share-root");
    assert_eq!(permission.owner, "macro|owner@test.com");
    assert_eq!(permission.public_access_level, Some(AccessLevel::Edit));
    assert_eq!(
        permission.channel_share_permissions.expect("channel").len(),
        1
    );

    let before = repo
        .get_project_by_id(ROOT_ID)
        .await?
        .expect("root")
        .updated_at;
    repo.update_project_modified(ROOT_ID).await?;
    let after = repo
        .get_project_by_id(ROOT_ID)
        .await?
        .expect("root")
        .updated_at;
    assert!(after > before);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn create_is_atomic_and_inserts_all_metadata(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PgProjectRepo::new(pool.clone());
    let permission =
        models_permissions::share_permission::SharePermissionV2::new_project_share_permission();
    let project = repo
        .create_project(CreateProjectArgs {
            user_id: "macro|owner@test.com".to_owned(),
            name: "Created".to_owned(),
            parent_id: Some(ROOT_ID.to_owned()),
            share_permission: permission.clone(),
        })
        .await?;

    let metadata_count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) AS "count!"
        FROM "ProjectPermission" permission
        JOIN "UserHistory" history ON history."itemId" = permission."projectId"
        JOIN entity_access access ON access.entity_id::text = permission."projectId"
        WHERE permission."projectId" = $1
          AND history."itemType" = 'project'
          AND access.access_level = 'owner'
        "#,
        project.id,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(metadata_count, 1);

    assert!(
        repo.create_project(CreateProjectArgs {
            user_id: "macro|owner@test.com".to_owned(),
            name: "Must roll back".to_owned(),
            parent_id: Some("missing-parent".to_owned()),
            share_permission: permission,
        })
        .await
        .is_err()
    );
    let rolled_back = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM "Project" WHERE name = 'Must roll back'"#
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(rolled_back, 0);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn edit_supports_parent_flags_and_sharing(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PgProjectRepo::new(pool);
    let unchanged = repo
        .edit_project(EditProjectArgs {
            project_id: CHILD_ID.to_owned(),
            name: Some("Renamed".to_owned()),
            update_parent: false,
            parent_id: None,
            share_permission: None,
        })
        .await?;
    assert_eq!(unchanged.parent_id.as_deref(), Some(ROOT_ID));

    let moved = repo
        .edit_project(EditProjectArgs {
            project_id: CHILD_ID.to_owned(),
            name: None,
            update_parent: true,
            parent_id: Some("10000000-0000-0000-0000-000000000005".to_owned()),
            share_permission: None,
        })
        .await?;
    assert_eq!(
        moved.parent_id.as_deref(),
        Some("10000000-0000-0000-0000-000000000005")
    );

    let cleared = repo
        .edit_project(EditProjectArgs {
            project_id: ROOT_ID.to_owned(),
            name: None,
            update_parent: true,
            parent_id: None,
            share_permission: Some(
                models_permissions::share_permission::UpdateSharePermissionRequestV2 {
                    is_public: Some(false),
                    public_access_level: Some(AccessLevel::Edit),
                    channel_share_permissions: None,
                },
            ),
        })
        .await?;
    assert!(cleared.parent_id.is_none());
    let permission = repo.get_project_share_permission(ROOT_ID).await?;
    assert!(!permission.is_public);
    assert_eq!(permission.public_access_level, None);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn recursive_detection_and_soft_delete_output(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PgProjectRepo::new(pool.clone());
    assert!(repo.is_project_recursively_nested(ROOT_ID, ROOT_ID).await?);
    assert!(
        repo.is_project_recursively_nested(ROOT_ID, CHILD_ID)
            .await?
    );
    assert!(
        !repo
            .is_project_recursively_nested(CHILD_ID, "10000000-0000-0000-0000-000000000005")
            .await?
    );

    let result = repo.soft_delete_project(ROOT_ID).await?;
    assert_eq!(result.project_ids.len(), 3);
    assert_eq!(result.document_ids.len(), 2);
    assert_eq!(result.chat_ids.len(), 2);
    let remaining_history = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM "UserHistory" WHERE "itemId" = $1"#,
        ROOT_ID,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(remaining_history, 0);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn revert_restores_subtree_and_handles_parent_state(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgProjectRepo::new(pool.clone());
    sqlx::query!(
        r#"UPDATE "Project" SET "parentId" = $2 WHERE id = $1"#,
        ROOT_ID,
        DELETED_ID
    )
    .execute(&pool)
    .await?;
    repo.soft_delete_project(ROOT_ID).await?;
    let restored = repo
        .revert_delete_project(ROOT_ID, Some(DELETED_ID.to_owned()))
        .await?;
    assert_eq!(restored.project_ids.len(), 4);
    assert!(
        repo.get_basic_project(ROOT_ID)
            .await?
            .expect("root")
            .parent_id
            .is_none()
    );
    assert!(repo.get_project_by_id(CHILD_ID).await?.is_some());

    repo.soft_delete_project(CHILD_ID).await?;
    repo.revert_delete_project(CHILD_ID, Some(ROOT_ID.to_owned()))
        .await?;
    assert_eq!(
        repo.get_basic_project(CHILD_ID)
            .await?
            .expect("child")
            .parent_id
            .as_deref(),
        Some(ROOT_ID)
    );
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn purge_returns_outputs_and_removes_access_and_permissions(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgProjectRepo::new(pool.clone());
    let deleted = repo.soft_delete_project(ROOT_ID).await?;
    let document_id = &deleted.document_ids[0];
    let bom_id = sqlx::query_scalar!(
        r#"INSERT INTO "DocumentBom" ("documentId") VALUES ($1) RETURNING id"#,
        document_id,
    )
    .fetch_one(&pool)
    .await?;
    sqlx::query!(
        r#"
        INSERT INTO "BomPart" (sha, path, "documentBomId")
        VALUES ('shared-sha', 'one', $1), ('shared-sha', 'two', $1), ('other-sha', 'three', $1)
        "#,
        bom_id,
    )
    .execute(&pool)
    .await?;

    let result = repo.purge_deleted_project_tree(ROOT_ID).await?;
    assert_eq!(result.project_ids.len(), 4);
    assert_eq!(result.documents.len(), 2);
    assert_eq!(result.chat_ids.len(), 2);
    assert_eq!(
        result.bom_shas,
        vec![("other-sha".to_owned(), 1), ("shared-sha".to_owned(), 2)]
    );

    let purged_ids = result
        .project_ids
        .iter()
        .chain(result.documents.iter().map(|(id, _)| id))
        .chain(&result.chat_ids)
        .cloned()
        .collect::<Vec<_>>();
    let remaining_access = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM entity_access WHERE entity_id::text = ANY($1)"#,
        &purged_ids,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(remaining_access, 0);
    let remaining_permissions = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM "ProjectPermission" WHERE "projectId" = ANY($1)"#,
        &result.project_ids,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(remaining_permissions, 0);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn purge_rolls_back_all_deletions(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PgProjectRepo::new(pool.clone());
    repo.soft_delete_project(ROOT_ID).await?;

    let mut transaction = pool.begin().await?;
    let result = super::delete::purge_deleted_project_tree(&mut transaction, ROOT_ID).await?;
    assert!(!result.project_ids.is_empty());
    transaction.rollback().await?;

    assert!(repo.get_basic_project(ROOT_ID).await?.is_some());
    let access_count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM entity_access WHERE entity_id::text = $1"#,
        ROOT_ID,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(access_count, 2);
    let permission_count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM "ProjectPermission" WHERE "projectId" = $1"#,
        ROOT_ID,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(permission_count, 1);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn upload_folder_preserves_tree_metadata_and_compensates(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgProjectRepo::new(pool.clone());
    let file = FolderItem {
        name: "nested.pdf".to_owned(),
        full_name: "nested.pdf".to_owned(),
        file_type: Some(FileType::Pdf),
        relative_path: "/Upload/Nested".to_owned(),
        sha: "upload-sha".to_owned(),
    };
    let root_folder = FileSystemNode::Folder(HashMap::from([
        (
            "Nested".to_owned(),
            FileSystemNode::Folder(HashMap::from([(
                "nested.pdf".to_owned(),
                FileSystemNode::File(file),
            )])),
        ),
        ("Empty".to_owned(), FileSystemNode::Folder(HashMap::new())),
    ]));
    let result = repo
        .upload_folder(UploadFolderRepoArgs {
            user_id: MacroUserIdStr::parse_from_str("macro|owner@test.com")?.into_owned(),
            share_permission:
                models_permissions::share_permission::SharePermissionV2::new_project_share_permission(),
            root_folder,
            root_folder_name: "Upload".to_owned(),
            upload_request_id: "lambda-request-id".to_owned(),
            parent_id: Some(ROOT_ID.to_owned()),
        })
        .await?;

    assert_eq!(result.project_ids.len(), 3);
    assert_eq!(result.documents.len(), 1);
    let FileSystemNodeWithIds::Folder { project_id, .. } = &result.file_system else {
        panic!("root must be a folder");
    };
    let root = sqlx::query!(
        r#"
        SELECT "parentId" AS parent_id, "uploadPending" AS upload_pending,
               "uploadRequestId" AS upload_request_id
        FROM "Project" WHERE id = $1
        "#,
        project_id,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(root.parent_id.as_deref(), Some(ROOT_ID));
    assert!(root.upload_pending);
    assert_eq!(root.upload_request_id.as_deref(), Some("lambda-request-id"));
    assert_eq!(result.documents[0].project_name.as_deref(), Some("Nested"));

    let document_ids = result
        .documents
        .iter()
        .map(|document| document.document_id.clone())
        .collect::<Vec<_>>();
    repo.delete_uploaded_tree(&result.project_ids, &document_ids)
        .await?;
    let remaining = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM "Project" WHERE id = ANY($1)"#,
        &result.project_ids,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(remaining, 0);
    let remaining_access = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM entity_access WHERE entity_id::text = ANY($1)"#,
        &document_ids,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(remaining_access, 0);
    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("projects_test_data"))
)]
async fn mark_uploaded_is_recursive_and_rejects_missing_root(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PgProjectRepo::new(pool.clone());
    let uploaded_tree = repo
        .mark_projects_uploaded("10000000-0000-0000-0000-000000000006")
        .await?;
    assert_eq!(uploaded_tree.id, "10000000-0000-0000-0000-000000000006");
    assert_eq!(uploaded_tree.name, "Owner pending");
    assert_eq!(uploaded_tree.user_id.as_ref(), "macro|owner@test.com");
    assert_eq!(uploaded_tree.parent_id, None);
    assert!(uploaded_tree.upload_pending_transitioned);

    let mut project_ids = uploaded_tree.project_ids;
    project_ids.sort();
    assert_eq!(
        project_ids,
        [
            "10000000-0000-0000-0000-000000000006".to_owned(),
            "10000000-0000-0000-0000-000000000008".to_owned(),
        ]
    );
    let pending = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM "Project" WHERE id = ANY($1) AND "uploadPending""#,
        &project_ids,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(pending, 0);

    let repeated = repo
        .mark_projects_uploaded("10000000-0000-0000-0000-000000000006")
        .await?;
    assert!(!repeated.upload_pending_transitioned);
    let mut repeated_project_ids = repeated.project_ids;
    repeated_project_ids.sort();
    assert_eq!(repeated_project_ids, project_ids);

    let missing_error = repo.mark_projects_uploaded("missing").await.unwrap_err();
    assert!(matches!(missing_error, sqlx::Error::RowNotFound));
    Ok(())
}
