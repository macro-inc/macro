use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use model_entity::EntityType;
use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::channel_share_permission::{
    UpdateChannelSharePermission, UpdateOperation,
};
use sqlx::{Pool, Postgres, Row};

use crate::domain::models::{
    CopyDocumentRepoArgs, CreateDocumentRepoArgs, EditDocumentRepoArgs, FileTypeUpdate,
    GithubPullRequest, GithubPullRequestsResponse,
};
use crate::domain::ports::DocumentRepo;
use crate::outbound::pg_document_repo::PgDocumentRepo;

const TEST_TEAM_ID: uuid::Uuid = uuid::uuid!("a0000000-0000-0000-0000-000000000001");
const SECOND_TEAM_ID: uuid::Uuid = uuid::uuid!("a0000000-0000-0000-0000-000000000002");

fn user_id(user_id: &str) -> macro_user_id::user_id::MacroUserIdStr<'static> {
    macro_user_id::user_id::MacroUserIdStr::parse_from_str(user_id)
        .unwrap()
        .into_owned()
}

fn create_document_args(
    user_id: &str,
    is_task: bool,
    team_id: Option<uuid::Uuid>,
) -> CreateDocumentRepoArgs {
    CreateDocumentRepoArgs {
        id: None,
        sha: "sha".to_string(),
        document_name: "task".to_string(),
        user_id: self::user_id(user_id),
        file_type: Some(model::document::FileType::Md),
        project_id: None,
        team_id,
        email_attachment_id: None,
        created_at: None,
        is_task,
        skip_history: false,
    }
}

async fn create_task_for_team(
    repo: &PgDocumentRepo,
    user_id: &str,
    team_id: uuid::Uuid,
) -> model::document::DocumentMetadata {
    repo.create_document(create_document_args(user_id, true, Some(team_id)))
        .await
        .unwrap()
}

async fn team_task_numbers(pool: &Pool<Postgres>, team_id: uuid::Uuid) -> Vec<i32> {
    sqlx::query(
        r#"
        SELECT task_num
        FROM team_task
        WHERE team_id = $1
        ORDER BY task_num
        "#,
    )
    .bind(team_id)
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| row.try_get("task_num").unwrap())
    .collect()
}

fn short_id_for_document_id(document_id: &str) -> String {
    let uuid = macro_uuid::string_to_uuid(document_id).unwrap();
    macro_uuid::ShortUuidConverter::default().from_uuid(&uuid)
}

async fn insert_github_pr_task(
    pool: &Pool<Postgres>,
    github_key: &str,
    task_short_id: &str,
    created_at: chrono::DateTime<chrono::Utc>,
) {
    sqlx::query(
        r#"
        INSERT INTO github_pr_tasks (id, github_key, task_id, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $4)
        "#,
    )
    .bind(uuid::Uuid::new_v4())
    .bind(github_key)
    .bind(task_short_id)
    .bind(created_at)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_second_team(pool: &Pool<Postgres>) {
    sqlx::query(
        r#"
        INSERT INTO public."macro_user" ("id", "username", "email", "stripe_customer_id")
        VALUES ($1, 'other', 'other@user.com', 'stripe_id_other')
        ON CONFLICT DO NOTHING
        "#,
    )
    .bind(uuid::uuid!("a4444444-4444-4444-4444-444444444444"))
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO public."User" ("id", "email", "stripeCustomerId", "organizationId", "macro_user_id")
        VALUES ('macro|other@user.com', 'other@user.com', 'stripe_id_other', 1, $1)
        ON CONFLICT DO NOTHING
        "#,
    )
    .bind(uuid::uuid!("a4444444-4444-4444-4444-444444444444"))
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO public."team" ("id", "name", "owner_id")
        VALUES ($1, 'second-team', 'macro|other@user.com')
        ON CONFLICT DO NOTHING
        "#,
    )
    .bind(SECOND_TEAM_ID)
    .execute(pool)
    .await
    .unwrap();

    sqlx::query(
        r#"
        INSERT INTO public."team_user" ("user_id", "team_id", "team_role")
        VALUES ('macro|other@user.com', $1, 'owner')
        ON CONFLICT DO NOTHING
        "#,
    )
    .bind(SECOND_TEAM_ID)
    .execute(pool)
    .await
    .unwrap();
}

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

    repo.share_with_team(&TEST_TEAM_ID, "d0000000-0000-0000-0000-000000000001")
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
async fn test_get_team_ids_for_user_returns_empty_when_user_not_on_team(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool);

    let team_ids = repo
        .get_team_ids_for_user("macro|no-team@user.com")
        .await
        .unwrap();

    assert!(team_ids.is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_share_with_team_idempotent(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());

    // Call twice — second call should be a no-op
    repo.share_with_team(&TEST_TEAM_ID, "d0000000-0000-0000-0000-000000000001")
        .await
        .unwrap();
    repo.share_with_team(&TEST_TEAM_ID, "d0000000-0000-0000-0000-000000000001")
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

    repo.share_with_team(&TEST_TEAM_ID, "d0000000-0000-0000-0000-000000000001")
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
async fn test_share_with_explicit_team_id(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());

    repo.share_with_team(&TEST_TEAM_ID, "d0000000-0000-0000-0000-000000000001")
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
async fn test_create_first_task_assigns_team_task_id_one(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());

    let metadata = create_task_for_team(&repo, "macro|user@user.com", TEST_TEAM_ID).await;
    let task_metadata = repo
        .get_team_task_metadata(&metadata.document_id)
        .await
        .unwrap()
        .unwrap();

    assert_eq!(task_metadata.team_id, TEST_TEAM_ID);
    assert_eq!(task_metadata.task_num, 1);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_create_multiple_tasks_same_team_assigns_sequence(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());

    for _ in 0..3 {
        create_task_for_team(&repo, "macro|user@user.com", TEST_TEAM_ID).await;
    }

    assert_eq!(team_task_numbers(&pool, TEST_TEAM_ID).await, vec![1, 2, 3]);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_create_tasks_different_teams_have_independent_sequences(pool: Pool<Postgres>) {
    insert_second_team(&pool).await;
    let repo = PgDocumentRepo::new(pool.clone());

    create_task_for_team(&repo, "macro|user@user.com", TEST_TEAM_ID).await;
    create_task_for_team(&repo, "macro|user@user.com", TEST_TEAM_ID).await;
    create_task_for_team(&repo, "macro|other@user.com", SECOND_TEAM_ID).await;

    assert_eq!(team_task_numbers(&pool, TEST_TEAM_ID).await, vec![1, 2]);
    assert_eq!(team_task_numbers(&pool, SECOND_TEAM_ID).await, vec![1]);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_concurrent_task_creates_same_team_get_unique_numbers(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());
    let mut handles = Vec::new();

    for _ in 0..8 {
        let repo = repo.clone();
        handles.push(tokio::spawn(async move {
            create_task_for_team(&repo, "macro|user@user.com", TEST_TEAM_ID).await;
        }));
    }

    for handle in handles {
        handle.await.unwrap();
    }

    assert_eq!(
        team_task_numbers(&pool, TEST_TEAM_ID).await,
        (1..=8).collect::<Vec<_>>()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_non_task_document_does_not_create_team_task_row(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool);

    let metadata = repo
        .create_document(create_document_args(
            "macro|user@user.com",
            false,
            Some(TEST_TEAM_ID),
        ))
        .await
        .unwrap();

    assert!(
        repo.get_team_task_metadata(&metadata.document_id)
            .await
            .unwrap()
            .is_none()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_task_without_team_id_does_not_create_team_task_row(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool);

    let metadata = repo
        .create_document(create_document_args("macro|user@user.com", true, None))
        .await
        .unwrap();

    assert!(
        repo.get_team_task_metadata(&metadata.document_id)
            .await
            .unwrap()
            .is_none()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_deleting_document_cascades_team_task_row(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());
    let metadata = create_task_for_team(&repo, "macro|user@user.com", TEST_TEAM_ID).await;

    repo.delete_document_by_id(&metadata.document_id)
        .await
        .unwrap();

    let count: i64 = sqlx::query(
        r#"
        SELECT COUNT(*) AS count
        FROM team_task
        WHERE document_id = $1
        "#,
    )
    .bind(&metadata.document_id)
    .fetch_one(&pool)
    .await
    .unwrap()
    .try_get("count")
    .unwrap();

    assert_eq!(count, 0);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_copying_task_allocates_new_team_task_number(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());
    let original = create_task_for_team(&repo, "macro|user@user.com", TEST_TEAM_ID).await;

    let copied = repo
        .copy_document(CopyDocumentRepoArgs {
            original_document: original,
            user_id: user_id("macro|user@user.com"),
            document_name: "copied task".to_string(),
            file_type: Some(model::document::FileType::Md),
            team_id: Some(TEST_TEAM_ID),
        })
        .await
        .unwrap();

    let copied_task_metadata = repo
        .get_team_task_metadata(&copied.document_id)
        .await
        .unwrap()
        .unwrap();

    assert_eq!(copied_task_metadata.task_num, 2);
    assert_eq!(team_task_numbers(&pool, TEST_TEAM_ID).await, vec![1, 2]);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_get_branch_name_context_prefers_github_and_team_task(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());
    sqlx::query!(
        r#"
        UPDATE team
        SET slug = 'ENG'
        WHERE id = $1
        "#,
        TEST_TEAM_ID,
    )
    .execute(&pool)
    .await
    .unwrap();

    sqlx::query!(
        r#"
        INSERT INTO github_links (id, macro_id, fusionauth_user_id, github_username, github_user_id)
        VALUES ($1, 'macro|user@user.com', $2, 'octocat', '12345')
        "#,
        uuid::uuid!("b0000000-0000-0000-0000-000000000001"),
        uuid::uuid!("b0000000-0000-0000-0000-000000000002"),
    )
    .execute(&pool)
    .await
    .unwrap();

    let task = create_task_for_team(&repo, "macro|user@user.com", TEST_TEAM_ID).await;
    let context = repo
        .get_branch_name_context(&task.document_id, "macro|user@user.com")
        .await
        .unwrap();

    assert_eq!(context.user_email, "user@user.com");
    assert_eq!(context.github_username, Some("octocat".to_string()));
    assert_eq!(context.team_slug, Some("ENG".to_string()));
    assert_eq!(context.team_task_id, Some(1));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_get_branch_name_context_falls_back_for_unknown_user(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool);

    let context = repo
        .get_branch_name_context(
            "d0000000-0000-0000-0000-000000000001",
            "macro|no-team@user.com",
        )
        .await
        .unwrap();

    assert_eq!(context.user_email, "no-team@user.com");
    assert_eq!(context.github_username, None);
    assert_eq!(context.team_slug, None);
    assert_eq!(context.team_task_id, None);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_get_github_pull_request_keys_orders_and_parses(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool.clone());
    let task = create_task_for_team(&repo, "macro|user@user.com", TEST_TEAM_ID).await;
    let other_task = create_task_for_team(&repo, "macro|user@user.com", TEST_TEAM_ID).await;
    let task_short_id = short_id_for_document_id(&task.document_id);
    let other_task_short_id = short_id_for_document_id(&other_task.document_id);
    let created_at = chrono::DateTime::parse_from_rfc3339("2026-01-01T00:00:00Z")
        .unwrap()
        .with_timezone(&chrono::Utc);

    insert_github_pr_task(&pool, "not-a-github-pr-key", &task_short_id, created_at).await;
    insert_github_pr_task(
        &pool,
        "macro/macro/pull/10",
        &task_short_id,
        created_at + chrono::Duration::seconds(1),
    )
    .await;
    insert_github_pr_task(
        &pool,
        "macro/api/pull/5",
        &task_short_id,
        created_at + chrono::Duration::seconds(1),
    )
    .await;
    insert_github_pr_task(
        &pool,
        "macro/macro/pull/20",
        &task_short_id,
        created_at + chrono::Duration::seconds(2),
    )
    .await;
    insert_github_pr_task(&pool, "other/repo/pull/1", &other_task_short_id, created_at).await;

    let github_keys = repo
        .get_task_github_pull_request_keys(&task_short_id)
        .await
        .unwrap();
    assert_eq!(
        github_keys,
        vec![
            "not-a-github-pr-key".to_string(),
            "macro/api/pull/5".to_string(),
            "macro/macro/pull/10".to_string(),
            "macro/macro/pull/20".to_string(),
        ]
    );

    let response = GithubPullRequestsResponse::from_github_keys(github_keys);
    assert_eq!(
        response.pull_requests,
        vec![
            GithubPullRequest {
                github_key: "macro/api/pull/5".to_string(),
                owner: "macro".to_string(),
                repo: "api".to_string(),
                number: 5,
                url: "https://github.com/macro/api/pull/5".to_string(),
                display_name: "macro/api#5".to_string(),
            },
            GithubPullRequest {
                github_key: "macro/macro/pull/10".to_string(),
                owner: "macro".to_string(),
                repo: "macro".to_string(),
                number: 10,
                url: "https://github.com/macro/macro/pull/10".to_string(),
                display_name: "macro/macro#10".to_string(),
            },
            GithubPullRequest {
                github_key: "macro/macro/pull/20".to_string(),
                owner: "macro".to_string(),
                repo: "macro".to_string(),
                number: 20,
                url: "https://github.com/macro/macro/pull/20".to_string(),
                display_name: "macro/macro#20".to_string(),
            },
        ]
    );
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

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    )
)]
async fn test_fetch_document_comments(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PgDocumentRepo::new(pool);

    // Test fetching comments for document-with-comments (which has 3 threads and 7 comments)
    let comment_threads = repo.get_document_comments("document-with-comments").await?;

    // Verify we got all threads
    assert_eq!(comment_threads.len(), 4);

    // Map threads by ID for easier testing
    let thread_map: std::collections::HashMap<i64, &crate::domain::models::CommentThread> =
        comment_threads
            .iter()
            .map(|t| (t.thread.thread_id, t))
            .collect();

    // Check thread 1001 (unresolved with 3 comments)
    let thread_1001 = thread_map.get(&1001).expect("Thread 1001 should exist");
    assert_eq!(thread_1001.comments.len(), 3);
    assert!(!thread_1001.thread.resolved);

    // Check thread 1002 (resolved with 3 comments)
    let thread_1002 = thread_map.get(&1002).expect("Thread 1002 should exist");
    assert_eq!(thread_1002.comments.len(), 3);
    assert!(thread_1002.thread.resolved);

    // Check thread 1003 (unresolved with 1 comment)
    let thread_1003 = thread_map.get(&1003).expect("Thread 1003 should exist");
    assert_eq!(thread_1003.comments.len(), 1);
    assert!(!thread_1003.thread.resolved);

    // Check specific comment content for thread 1001
    let first_comment = &thread_1001.comments[0];
    assert_eq!(first_comment.text, "Initial question on page 1");
    assert_eq!(first_comment.sender, Some("user@user.com".to_string()));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    )
)]
async fn test_fetch_document_comments_empty(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PgDocumentRepo::new(pool);

    // This document ID doesn't exist in our fixture, so should return empty results
    let comment_threads = repo.get_document_comments("non-existent-document").await?;

    // Verify we got an empty list
    assert_eq!(comment_threads.len(), 0);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    )
)]
async fn test_thread_deletion(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PgDocumentRepo::new(pool.clone());

    // First verify we have 2 threads in document-delete-test
    let threads_before = repo.get_document_comments("document-delete-test").await?;
    assert_eq!(threads_before.len(), 2);

    // Now mark one thread as deleted
    sqlx::query!(
        r#"
        UPDATE "Thread"
        SET "deletedAt" = NOW()
        WHERE "id" = 3001
        "#
    )
    .execute(&pool)
    .await?;

    // Fetch comments again - deleted threads should be filtered out
    let threads_after = repo.get_document_comments("document-delete-test").await?;

    // Verify only one thread remains and it's the correct one
    assert_eq!(threads_after.len(), 1);
    assert_eq!(threads_after[0].thread.thread_id, 3002);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(
        path = "../../../fixtures",
        scripts("document_pdf_comments_and_highlights")
    )
)]
async fn test_comment_deletion(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PgDocumentRepo::new(pool.clone());

    // First verify thread 1001 has 3 comments
    let threads_before = repo.get_document_comments("document-with-comments").await?;
    let thread_1001_before = threads_before
        .iter()
        .find(|t| t.thread.thread_id == 1001)
        .expect("Thread 1001 should exist");
    assert_eq!(thread_1001_before.comments.len(), 3);

    // Now mark one comment as deleted
    sqlx::query!(
        r#"
        UPDATE "Comment"
        SET "deletedAt" = NOW()
        WHERE "id" = 10001
        "#
    )
    .execute(&pool)
    .await?;

    // Fetch comments again - deleted comments should be filtered out
    let threads_after = repo.get_document_comments("document-with-comments").await?;
    let thread_1001_after = threads_after
        .iter()
        .find(|t| t.thread.thread_id == 1001)
        .expect("Thread 1001 should exist");

    // Verify one comment was filtered out
    assert_eq!(thread_1001_after.comments.len(), 2);

    // Verify the remaining comments are the ones we expect
    let comment_ids: Vec<i64> = thread_1001_after
        .comments
        .iter()
        .map(|c| c.comment_id)
        .collect();
    assert!(comment_ids.contains(&10002));
    assert!(comment_ids.contains(&10003));
    assert!(!comment_ids.contains(&10001));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_get_project_name(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool);

    let name = repo
        .get_project_name("d0000000-0000-0000-0000-100000000001")
        .await
        .unwrap();
    assert_eq!(name, "test_project_name");

    let result = repo.get_project_name("nonexistent").await;
    assert!(result.is_err());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_get_project_children(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool);

    let children = repo
        .get_project_children("d0000000-0000-0000-0000-100000000001")
        .await
        .unwrap();

    assert_eq!(children.len(), 2);

    let has_doc = children.iter().any(|e| {
        e.entity_type == EntityType::Document
            && e.entity_id == "d0000000-0000-0000-0000-000000000003"
    });
    assert!(has_doc, "should include the child document");

    let has_sub_project = children.iter().any(|e| {
        e.entity_type == EntityType::Project
            && e.entity_id == "d0000000-0000-0000-0000-100000000002"
    });
    assert!(has_sub_project, "should include the sub-project");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("documents_test_data"))
)]
async fn test_get_project_children_empty(pool: Pool<Postgres>) {
    let repo = PgDocumentRepo::new(pool);

    let children = repo
        .get_project_children("d0000000-0000-0000-0000-100000000002")
        .await
        .unwrap();

    assert!(children.is_empty());
}
