use std::time::Duration;

use agent::types::{ChatMessageContent, Role};
use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model::chat::NewChatMessage;
use model_entity::EntityType;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::channel_share_permission::{
    UpdateChannelSharePermission, UpdateOperation,
};
use models_permissions::share_permission::{
    LinkShare, SharePermissionV2, UpdateSharePermissionRequestV2,
};
use sqlx::{Pool, Postgres};

use super::PgChatRepo;
use crate::domain::models::{ChatErr, CopyChatArgs, CreateChatArgs, PatchChatArgs};
use crate::domain::ports::ChatRepo;

/// The no-team default permission for a chat — the repo persists whatever the
/// domain layer resolved, so tests pass it explicitly.
fn default_share_permission() -> SharePermissionV2 {
    SharePermissionV2::new_chat_share_permission(None)
}

#[derive(Debug, Eq, PartialEq)]
struct StoredSharePermission {
    id: String,
    link_share: Option<String>,
    link_share_access_level: Option<String>,
    team_share_access_level: Option<String>,
}

async fn get_stored_share_permission(
    pool: &Pool<Postgres>,
    chat_id: &str,
) -> StoredSharePermission {
    let row = sqlx::query!(
        r#"
        SELECT
            sp.id,
            sp."linkShare" AS "link_share?",
            sp."linkShareAccessLevel"::text AS "link_share_access_level?",
            sp."teamShareAccessLevel"::text AS "team_share_access_level?"
        FROM "ChatPermission" cp
        JOIN "SharePermission" sp ON cp."sharePermissionId" = sp.id
        WHERE cp."chatId" = $1
        "#,
        chat_id,
    )
    .fetch_one(pool)
    .await
    .unwrap();

    StoredSharePermission {
        id: row.id,
        link_share: row.link_share,
        link_share_access_level: row.link_share_access_level,
        team_share_access_level: row.team_share_access_level,
    }
}

/// The team the fixture user (the chat owner in these tests) is added to by
/// [`add_owner_to_team`]. The fixture itself leaves the owner without a team.
const OWNER_TEAM_ID: uuid::Uuid = uuid::uuid!("7ea00000-0000-4000-8000-000000000001");

async fn add_owner_to_team(pool: &Pool<Postgres>) {
    sqlx::query!(
        r#"INSERT INTO team (id, name, owner_id) VALUES ($1, 'Owner Team', 'macro|test@example.com')"#,
        OWNER_TEAM_ID,
    )
    .execute(pool)
    .await
    .unwrap();

    sqlx::query!(
        r#"INSERT INTO team_user (user_id, team_id, team_role) VALUES ('macro|test@example.com', $1, 'owner')"#,
        OWNER_TEAM_ID,
    )
    .execute(pool)
    .await
    .unwrap();
}

/// A `source_type = 'team'` row in `entity_access` for a chat.
#[derive(Debug, Eq, PartialEq)]
struct TeamEntityAccess {
    source_id: String,
    access_level: String,
    granted_from_project_id: Option<String>,
}

async fn get_team_entity_access(pool: &Pool<Postgres>, chat_id: &str) -> Vec<TeamEntityAccess> {
    let chat_uuid = macro_uuid::string_to_uuid(chat_id).unwrap();
    sqlx::query!(
        r#"
        SELECT
            source_id,
            access_level::text AS "access_level!",
            granted_from_project_id
        FROM entity_access
        WHERE entity_id = $1 AND entity_type = $2 AND source_type = 'team'
        ORDER BY id
        "#,
        chat_uuid,
        EntityType::Chat.as_ref(),
    )
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| TeamEntityAccess {
        source_id: row.source_id,
        access_level: row.access_level,
        granted_from_project_id: row.granted_from_project_id,
    })
    .collect()
}

/// Count the chat's `entity_access` rows with the given source type.
async fn count_entity_access(pool: &Pool<Postgres>, chat_id: &str, source_type: &str) -> i64 {
    let chat_uuid = macro_uuid::string_to_uuid(chat_id).unwrap();
    sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) AS "count!"
        FROM entity_access
        WHERE entity_id = $1
          AND entity_type = $2
          AND source_type::text = $3
        "#,
        chat_uuid,
        EntityType::Chat.as_ref(),
        source_type,
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

/// A share permission update that only touches the team share.
fn team_share_request(
    team_share_access_level: Option<Option<AccessLevel>>,
) -> UpdateSharePermissionRequestV2 {
    UpdateSharePermissionRequestV2 {
        link_share: None,
        link_share_access_level: None,
        channel_share_permissions: None,
        team_share_access_level,
    }
}

async fn create_test_chat(repo: &PgChatRepo, name: &str) -> String {
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com")
        .unwrap()
        .into_owned();
    repo.create(
        user_id,
        CreateChatArgs {
            name: name.to_string(),
            project_id: None,
        },
        default_share_permission(),
    )
    .await
    .unwrap()
}

async fn patch_share_permission(
    repo: &PgChatRepo,
    chat_id: &str,
    share_permission: UpdateSharePermissionRequestV2,
) {
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com")
        .unwrap()
        .into_owned();
    repo.patch(
        user_id,
        chat_id,
        PatchChatArgs {
            name: None,
            project_id: None,
            share_permission: Some(share_permission),
        },
    )
    .await
    .unwrap();
}

async fn create_chat_with_message(repo: &PgChatRepo) -> (String, String) {
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com")
        .unwrap()
        .into_owned();
    let chat_id = repo
        .create(
            user_id,
            CreateChatArgs {
                name: "Message update test".to_string(),
                project_id: None,
            },
            default_share_permission(),
        )
        .await
        .unwrap();
    let now = Utc::now();
    let message_id = crate::domain::ports::MessageRepo::create(
        repo,
        &chat_id,
        NewChatMessage {
            id: None,
            content: ChatMessageContent::Text("initial content".to_string()),
            role: Role::User,
            attachments: None,
            model: "test-model".to_string(),
            created_at: now,
            updated_at: now,
        },
    )
    .await
    .unwrap();

    (chat_id, message_id)
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn create_chat_returns_id(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool.clone());
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com")
        .unwrap()
        .into_owned();

    let chat_id = repo
        .create(
            user_id,
            CreateChatArgs {
                name: "Test Chat".to_string(),
                project_id: None,
            },
            default_share_permission(),
        )
        .await
        .unwrap();

    assert!(!chat_id.is_empty());

    // verify the chat row exists
    let row = sqlx::query!(
        r#"SELECT "userId" AS "user_id", name FROM "Chat" WHERE id = $1"#,
        &chat_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(row.name, "Test Chat");
    assert_eq!(row.user_id, "macro|test@example.com");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn create_message_bumps_chat_updated_at(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool);
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com")
        .unwrap()
        .into_owned();

    let chat_id = repo
        .create(
            user_id,
            CreateChatArgs {
                name: "Active Chat".to_string(),
                project_id: None,
            },
            default_share_permission(),
        )
        .await
        .unwrap();
    let original_updated_at = repo
        .get_metadata(&chat_id)
        .await
        .unwrap()
        .updated_at
        .unwrap();

    tokio::time::sleep(Duration::from_millis(10)).await;
    let now = Utc::now();
    crate::domain::ports::MessageRepo::create(
        &repo,
        &chat_id,
        NewChatMessage {
            id: None,
            content: ChatMessageContent::Text("hello".to_string()),
            role: Role::User,
            attachments: None,
            model: "test-model".to_string(),
            created_at: now,
            updated_at: now,
        },
    )
    .await
    .unwrap();

    let updated_at = repo
        .get_metadata(&chat_id)
        .await
        .unwrap()
        .updated_at
        .unwrap();
    assert!(updated_at > original_updated_at);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn delete_message_returns_parent_chat_id_and_removes_message(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool);
    let (chat_id, message_id) = create_chat_with_message(&repo).await;

    let deleted_from_chat_id = crate::domain::ports::MessageRepo::delete(&repo, &message_id)
        .await
        .unwrap();

    assert_eq!(deleted_from_chat_id, chat_id);
    assert!(matches!(
        crate::domain::ports::MessageRepo::get_message_content(&repo, &chat_id, &message_id).await,
        Err(ChatErr::NotFound)
    ));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn update_message_content_bumps_chat_updated_at(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool);
    let (chat_id, message_id) = create_chat_with_message(&repo).await;
    let original_updated_at = repo
        .get_metadata(&chat_id)
        .await
        .unwrap()
        .updated_at
        .unwrap();

    tokio::time::sleep(Duration::from_millis(10)).await;
    repo.update_message_content(
        &chat_id,
        &message_id,
        &ChatMessageContent::Text("final content".to_string()),
    )
    .await
    .unwrap();

    let updated_at = repo
        .get_metadata(&chat_id)
        .await
        .unwrap()
        .updated_at
        .unwrap();
    assert!(updated_at > original_updated_at);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn update_interim_message_content_does_not_bump_chat(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool);
    let (chat_id, message_id) = create_chat_with_message(&repo).await;
    let original_updated_at = repo
        .get_metadata(&chat_id)
        .await
        .unwrap()
        .updated_at
        .unwrap();

    tokio::time::sleep(Duration::from_millis(10)).await;
    repo.update_interim_message_content(
        &chat_id,
        &message_id,
        &ChatMessageContent::Text("interim content".to_string()),
    )
    .await
    .unwrap();

    let updated_at = repo
        .get_metadata(&chat_id)
        .await
        .unwrap()
        .updated_at
        .unwrap();
    assert_eq!(updated_at, original_updated_at);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn nonexistent_message_does_not_bump_chat(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool);
    let (chat_id, _) = create_chat_with_message(&repo).await;
    let original_updated_at = repo
        .get_metadata(&chat_id)
        .await
        .unwrap()
        .updated_at
        .unwrap();

    tokio::time::sleep(Duration::from_millis(10)).await;
    repo.update_message_content(
        &chat_id,
        "nonexistent-message",
        &ChatMessageContent::Text("final content".to_string()),
    )
    .await
    .unwrap();

    let updated_at = repo
        .get_metadata(&chat_id)
        .await
        .unwrap()
        .updated_at
        .unwrap();
    assert_eq!(updated_at, original_updated_at);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn create_chat_creates_public_view_permission(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool.clone());
    let chat_id = create_test_chat(&repo, "Perm Chat").await;

    let permission = get_stored_share_permission(&pool, &chat_id).await;
    assert!(!permission.id.is_empty());
    assert_eq!(permission.link_share.as_deref(), Some("PUBLIC"));
    assert_eq!(permission.link_share_access_level.as_deref(), Some("view"));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn create_chat_creates_user_item_access(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool.clone());
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com")
        .unwrap()
        .into_owned();

    let chat_id = repo
        .create(
            user_id,
            CreateChatArgs {
                name: "Access Chat".to_string(),
                project_id: None,
            },
            default_share_permission(),
        )
        .await
        .unwrap();

    let access_level = sqlx::query_scalar!(
        r#"
        SELECT "access_level"::text AS "access_level!"
        FROM "entity_access"
        WHERE "source_id" = $1 AND "entity_id" = $2
        "#,
        "macro|test@example.com",
        macro_uuid::string_to_uuid(&chat_id).unwrap(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(access_level, "owner");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn create_chat_creates_user_history(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool.clone());
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com")
        .unwrap()
        .into_owned();

    let chat_id = repo
        .create(
            user_id,
            CreateChatArgs {
                name: "History Chat".to_string(),
                project_id: None,
            },
            default_share_permission(),
        )
        .await
        .unwrap();

    let item_type = sqlx::query_scalar!(
        r#"
        SELECT "itemType"::text AS "item_type!" FROM "UserHistory"
        WHERE "userId" = $1 AND "itemId" = $2
        "#,
        "macro|test@example.com",
        &chat_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(item_type, "chat");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn create_chat_with_project_id(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool.clone());
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com")
        .unwrap()
        .into_owned();

    let chat_id = repo
        .create(
            user_id,
            CreateChatArgs {
                name: "Project Chat".to_string(),
                project_id: Some("project-123".to_string()),
            },
            default_share_permission(),
        )
        .await
        .unwrap();

    let project_id =
        sqlx::query_scalar!(r#"SELECT "projectId" FROM "Chat" WHERE id = $1"#, &chat_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(project_id.as_deref(), Some("project-123"));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn get_chat_returns_chat(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool.clone());
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com")
        .unwrap()
        .into_owned();

    let chat_id = repo
        .create(
            user_id,
            CreateChatArgs {
                name: "Get Me".to_string(),
                project_id: None,
            },
            default_share_permission(),
        )
        .await
        .unwrap();

    let chat = repo.get_metadata(&chat_id).await.unwrap();

    assert_eq!(chat.id, chat_id);
    assert_eq!(chat.name, "Get Me");
    assert_eq!(chat.user_id, "macro|test@example.com");
    assert!(chat.created_at.is_some());
    assert!(chat.updated_at.is_some());
    assert!(chat.deleted_at.is_none());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn get_chat_not_found(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool);

    let result = repo.get_metadata("nonexistent-id").await;
    assert!(matches!(result, Err(ChatErr::NotFound)));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn soft_delete_chat_sets_deleted_at(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool.clone());
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com")
        .unwrap()
        .into_owned();

    let chat_id = repo
        .create(
            user_id,
            CreateChatArgs {
                name: "Delete Me".to_string(),
                project_id: None,
            },
            default_share_permission(),
        )
        .await
        .unwrap();

    repo.delete(&chat_id).await.unwrap();

    let deleted_at =
        sqlx::query_scalar!(r#"SELECT "deletedAt" FROM "Chat" WHERE id = $1"#, &chat_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert!(deleted_at.is_some());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn soft_delete_chat_removes_history(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool.clone());
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com")
        .unwrap()
        .into_owned();

    let chat_id = repo
        .create(
            user_id,
            CreateChatArgs {
                name: "History Delete".to_string(),
                project_id: None,
            },
            default_share_permission(),
        )
        .await
        .unwrap();

    repo.delete(&chat_id).await.unwrap();

    let count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM "UserHistory" WHERE "itemId" = $1 AND "itemType" = 'chat'"#,
        &chat_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(count, 0);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn permanently_delete_chat_removes_row(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool.clone());
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com")
        .unwrap()
        .into_owned();

    let chat_id = repo
        .create(
            user_id,
            CreateChatArgs {
                name: "Perm Delete".to_string(),
                project_id: None,
            },
            default_share_permission(),
        )
        .await
        .unwrap();

    repo.permanently_delete(&chat_id).await.unwrap();

    let count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM "Chat" WHERE id = $1"#,
        &chat_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(count, 0);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn permanently_delete_chat_removes_permissions(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool.clone());
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com")
        .unwrap()
        .into_owned();

    let chat_id = repo
        .create(
            user_id,
            CreateChatArgs {
                name: "Perm Delete Perms".to_string(),
                project_id: None,
            },
            default_share_permission(),
        )
        .await
        .unwrap();

    repo.permanently_delete(&chat_id).await.unwrap();

    let count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM "ChatPermission" WHERE "chatId" = $1"#,
        &chat_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(count, 0);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn permanently_delete_chat_removes_user_item_access(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool.clone());
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com")
        .unwrap()
        .into_owned();

    let chat_id = repo
        .create(
            user_id,
            CreateChatArgs {
                name: "Perm Delete Access".to_string(),
                project_id: None,
            },
            default_share_permission(),
        )
        .await
        .unwrap();

    repo.permanently_delete(&chat_id).await.unwrap();

    let count: i64 = sqlx::query!(
        r#"SELECT COUNT(id) AS result FROM "entity_access" WHERE "entity_id" = $1"#,
        &macro_uuid::string_to_uuid(&chat_id).unwrap(),
    )
    .map(|r| r.result.unwrap_or(0))
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(count, 0);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn patch_chat_updates_name(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool.clone());
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com")
        .unwrap()
        .into_owned();

    let chat_id = repo
        .create(
            user_id,
            CreateChatArgs {
                name: "Original".to_string(),
                project_id: None,
            },
            default_share_permission(),
        )
        .await
        .unwrap();

    let patch_user_id = MacroUserIdStr::parse_from_str("macro|test@example.com")
        .unwrap()
        .into_owned();
    repo.patch(
        patch_user_id,
        &chat_id,
        PatchChatArgs {
            name: Some("Renamed".to_string()),
            project_id: None,
            share_permission: None,
        },
    )
    .await
    .unwrap();

    let chat = repo.get_metadata(&chat_id).await.unwrap();
    assert_eq!(chat.name, "Renamed");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn patch_chat_updates_project(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool.clone());
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com")
        .unwrap()
        .into_owned();

    let chat_id = repo
        .create(
            user_id,
            CreateChatArgs {
                name: "Project Chat".to_string(),
                project_id: None,
            },
            default_share_permission(),
        )
        .await
        .unwrap();

    let patch_user_id = MacroUserIdStr::parse_from_str("macro|test@example.com")
        .unwrap()
        .into_owned();
    repo.patch(
        patch_user_id,
        &chat_id,
        PatchChatArgs {
            name: None,
            project_id: Some("project-123".to_string()),
            share_permission: None,
        },
    )
    .await
    .unwrap();

    let project_id =
        sqlx::query_scalar!(r#"SELECT "projectId" FROM "Chat" WHERE id = $1"#, &chat_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(project_id.as_deref(), Some("project-123"));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn patch_chat_clears_project(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool.clone());
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com")
        .unwrap()
        .into_owned();

    let chat_id = repo
        .create(
            user_id,
            CreateChatArgs {
                name: "Clear Project".to_string(),
                project_id: Some("project-123".to_string()),
            },
            default_share_permission(),
        )
        .await
        .unwrap();

    let patch_user_id = MacroUserIdStr::parse_from_str("macro|test@example.com")
        .unwrap()
        .into_owned();
    repo.patch(
        patch_user_id,
        &chat_id,
        PatchChatArgs {
            name: None,
            project_id: Some("".to_string()),
            share_permission: None,
        },
    )
    .await
    .unwrap();

    let project_id =
        sqlx::query_scalar!(r#"SELECT "projectId" FROM "Chat" WHERE id = $1"#, &chat_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(project_id, None);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn get_chat_returns_full_response(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool.clone());
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com")
        .unwrap()
        .into_owned();

    let chat_id = repo
        .create(
            user_id,
            CreateChatArgs {
                name: "Full Chat".to_string(),
                project_id: None,
            },
            default_share_permission(),
        )
        .await
        .unwrap();

    let response = repo.get_chat(&chat_id).await.unwrap();

    assert_eq!(response.id, chat_id);
    assert_eq!(response.name, "Full Chat");
    assert_eq!(response.user_id, "macro|test@example.com");
    assert!(response.model.is_some());
    assert!(response.messages.is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn get_chat_not_found_returns_error(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool);

    let result = repo.get_chat("nonexistent-id").await;
    assert!(matches!(result, Err(ChatErr::NotFound)));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn copy_chat_creates_new_chat_with_same_messages(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool.clone());
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com")
        .unwrap()
        .into_owned();

    let source_id = repo
        .create(
            user_id.clone(),
            CreateChatArgs {
                name: "Source Chat".to_string(),
                project_id: None,
            },
            default_share_permission(),
        )
        .await
        .unwrap();

    // Insert a message into the source chat
    sqlx::query!(
        r#"
        INSERT INTO "ChatMessage" ("chatId", "content", "role")
        VALUES ($1, '"hello"', 'user')
        "#,
        &source_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    let copied_id = repo
        .copy_chat(
            user_id,
            &source_id,
            CopyChatArgs {
                name: "Copied Chat".to_string(),
                project_id: None,
            },
            default_share_permission(),
        )
        .await
        .unwrap();

    assert_ne!(source_id, copied_id);

    // Verify the copy has the right name
    let copy = repo.get_metadata(&copied_id).await.unwrap();
    assert_eq!(copy.name, "Copied Chat");

    // Verify the message was copied
    let msg_count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM "ChatMessage" WHERE "chatId" = $1"#,
        &copied_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(msg_count, 1);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn revert_delete_restores_chat(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool.clone());
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com")
        .unwrap()
        .into_owned();

    let chat_id = repo
        .create(
            user_id,
            CreateChatArgs {
                name: "Revert Me".to_string(),
                project_id: None,
            },
            default_share_permission(),
        )
        .await
        .unwrap();

    repo.delete(&chat_id).await.unwrap();

    // Confirm it's deleted
    let chat = repo.get_metadata(&chat_id).await.unwrap();
    assert!(chat.deleted_at.is_some());

    repo.revert_delete(&chat_id, None).await.unwrap();

    // Confirm it's restored
    let chat = repo.get_metadata(&chat_id).await.unwrap();
    assert!(chat.deleted_at.is_none());

    // Confirm history was re-added
    let count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM "UserHistory" WHERE "itemId" = $1 AND "itemType" = 'chat'"#,
        &chat_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(count, 1);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn patch_chat_sets_team_share_and_defaults_explicit_null_level_to_view(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool.clone());
    let chat_id = create_test_chat(&repo, "Team Chat").await;

    patch_share_permission(
        &repo,
        &chat_id,
        UpdateSharePermissionRequestV2 {
            link_share: Some(Some(LinkShare::Team)),
            link_share_access_level: Some(None),
            channel_share_permissions: None,
            team_share_access_level: None,
        },
    )
    .await;

    let permission = get_stored_share_permission(&pool, &chat_id).await;
    assert_eq!(permission.link_share.as_deref(), Some("TEAM"));
    assert_eq!(permission.link_share_access_level.as_deref(), Some("view"));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn patch_chat_defaults_explicit_null_level_for_existing_link_share(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool.clone());
    let chat_id = create_test_chat(&repo, "Default View Chat").await;

    patch_share_permission(
        &repo,
        &chat_id,
        UpdateSharePermissionRequestV2 {
            link_share: None,
            link_share_access_level: Some(Some(AccessLevel::Edit)),
            channel_share_permissions: None,
            team_share_access_level: None,
        },
    )
    .await;
    patch_share_permission(
        &repo,
        &chat_id,
        UpdateSharePermissionRequestV2 {
            link_share: None,
            link_share_access_level: Some(None),
            channel_share_permissions: None,
            team_share_access_level: None,
        },
    )
    .await;

    let permission = get_stored_share_permission(&pool, &chat_id).await;
    assert_eq!(permission.link_share.as_deref(), Some("PUBLIC"));
    assert_eq!(permission.link_share_access_level.as_deref(), Some("view"));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn patch_chat_disables_link_sharing_and_clears_both_levels(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool.clone());
    let chat_id = create_test_chat(&repo, "Private Chat").await;

    patch_share_permission(
        &repo,
        &chat_id,
        UpdateSharePermissionRequestV2 {
            link_share: Some(None),
            link_share_access_level: Some(Some(AccessLevel::Edit)),
            channel_share_permissions: None,
            team_share_access_level: None,
        },
    )
    .await;

    let permission = get_stored_share_permission(&pool, &chat_id).await;
    assert_eq!(permission.link_share, None);
    assert_eq!(permission.link_share_access_level, None);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn get_permissions_reads_link_share_columns(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool.clone());
    let chat_id = create_test_chat(&repo, "Perms Chat").await;

    let permission = repo.get_permissions(&chat_id).await.unwrap();
    assert_eq!(permission.link_share, Some(LinkShare::Public));
    assert_eq!(permission.link_share_access_level, Some(AccessLevel::View));

    sqlx::query!(
        r#"
        UPDATE "SharePermission" sp
        SET
            "linkShare" = 'TEAM',
            "linkShareAccessLevel" = 'edit'
        FROM "ChatPermission" cp
        WHERE cp."sharePermissionId" = sp.id AND cp."chatId" = $1
        "#,
        &chat_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    let permission = repo.get_permissions(&chat_id).await.unwrap();

    assert!(!permission.id.is_empty());
    assert_eq!(permission.owner, "macro|test@example.com");
    assert_eq!(permission.link_share, Some(LinkShare::Team));
    assert_eq!(permission.link_share_access_level, Some(AccessLevel::Edit));
}

// -- Team share --

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn create_chat_leaves_team_share_unset(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool.clone());
    let chat_id = create_test_chat(&repo, "Fresh Chat").await;

    let permission = get_stored_share_permission(&pool, &chat_id).await;
    assert_eq!(permission.team_share_access_level, None);
    assert!(get_team_entity_access(&pool, &chat_id).await.is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn patch_chat_sets_team_share_and_grants_owner_team_access(pool: Pool<Postgres>) {
    add_owner_to_team(&pool).await;
    let repo = PgChatRepo::new(pool.clone());
    let chat_id = create_test_chat(&repo, "Team Shared Chat").await;

    patch_share_permission(
        &repo,
        &chat_id,
        team_share_request(Some(Some(AccessLevel::View))),
    )
    .await;

    let permission = get_stored_share_permission(&pool, &chat_id).await;
    assert_eq!(permission.team_share_access_level.as_deref(), Some("view"));
    // The link share is a separate mechanism and stays at the chat default.
    assert_eq!(permission.link_share.as_deref(), Some("PUBLIC"));
    assert_eq!(permission.link_share_access_level.as_deref(), Some("view"));

    assert_eq!(
        get_team_entity_access(&pool, &chat_id).await,
        vec![TeamEntityAccess {
            source_id: OWNER_TEAM_ID.to_string(),
            access_level: "view".to_string(),
            granted_from_project_id: None,
        }]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn patch_chat_changes_team_share_level_in_place(pool: Pool<Postgres>) {
    add_owner_to_team(&pool).await;
    let repo = PgChatRepo::new(pool.clone());
    let chat_id = create_test_chat(&repo, "Team Shared Chat").await;

    patch_share_permission(
        &repo,
        &chat_id,
        team_share_request(Some(Some(AccessLevel::View))),
    )
    .await;
    patch_share_permission(
        &repo,
        &chat_id,
        team_share_request(Some(Some(AccessLevel::Edit))),
    )
    .await;

    let permission = get_stored_share_permission(&pool, &chat_id).await;
    assert_eq!(permission.team_share_access_level.as_deref(), Some("edit"));
    assert_eq!(
        get_team_entity_access(&pool, &chat_id).await,
        vec![TeamEntityAccess {
            source_id: OWNER_TEAM_ID.to_string(),
            access_level: "edit".to_string(),
            granted_from_project_id: None,
        }]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn patch_chat_clears_team_share_and_revokes_owner_team_access(pool: Pool<Postgres>) {
    add_owner_to_team(&pool).await;
    let repo = PgChatRepo::new(pool.clone());
    let chat_id = create_test_chat(&repo, "Team Shared Chat").await;

    patch_share_permission(
        &repo,
        &chat_id,
        team_share_request(Some(Some(AccessLevel::Edit))),
    )
    .await;
    patch_share_permission(&repo, &chat_id, team_share_request(Some(None))).await;

    let permission = get_stored_share_permission(&pool, &chat_id).await;
    assert_eq!(permission.team_share_access_level, None);
    assert!(get_team_entity_access(&pool, &chat_id).await.is_empty());
    // Revoking the team grant leaves the owner's own access alone.
    assert_eq!(count_entity_access(&pool, &chat_id, "user").await, 1);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn patch_chat_team_share_without_team_is_bad_request_and_rolls_back(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool.clone());
    let chat_id = create_test_chat(&repo, "Solo Chat").await;
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com")
        .unwrap()
        .into_owned();

    let err = repo
        .patch(
            user_id,
            &chat_id,
            PatchChatArgs {
                name: Some("Renamed".to_string()),
                project_id: None,
                share_permission: Some(team_share_request(Some(Some(AccessLevel::View)))),
            },
        )
        .await
        .unwrap_err();

    match err {
        ChatErr::BadRequest(message) => assert!(
            message.contains("not in a team"),
            "unexpected message: {message}"
        ),
        other => panic!("expected a bad request error, got {other:?}"),
    }

    // The whole patch is one transaction, so nothing was persisted.
    let permission = get_stored_share_permission(&pool, &chat_id).await;
    assert_eq!(permission.team_share_access_level, None);
    assert!(get_team_entity_access(&pool, &chat_id).await.is_empty());
    assert_eq!(repo.get_metadata(&chat_id).await.unwrap().name, "Solo Chat");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn patch_chat_clears_team_share_without_team_as_no_op(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool.clone());
    let chat_id = create_test_chat(&repo, "Solo Chat").await;

    patch_share_permission(&repo, &chat_id, team_share_request(Some(None))).await;

    let permission = get_stored_share_permission(&pool, &chat_id).await;
    assert_eq!(permission.team_share_access_level, None);
    assert!(get_team_entity_access(&pool, &chat_id).await.is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn patch_chat_channel_share_leaves_team_share_untouched(pool: Pool<Postgres>) {
    add_owner_to_team(&pool).await;
    let repo = PgChatRepo::new(pool.clone());
    let chat_id = create_test_chat(&repo, "Team Shared Chat").await;

    patch_share_permission(
        &repo,
        &chat_id,
        team_share_request(Some(Some(AccessLevel::View))),
    )
    .await;
    patch_share_permission(
        &repo,
        &chat_id,
        UpdateSharePermissionRequestV2 {
            link_share: None,
            link_share_access_level: None,
            channel_share_permissions: Some(vec![UpdateChannelSharePermission {
                operation: UpdateOperation::Add,
                channel_id: "channel-1".to_string(),
                access_level: Some(AccessLevel::Edit),
            }]),
            team_share_access_level: None,
        },
    )
    .await;

    let permission = get_stored_share_permission(&pool, &chat_id).await;
    assert_eq!(permission.team_share_access_level.as_deref(), Some("view"));
    assert_eq!(
        get_team_entity_access(&pool, &chat_id).await,
        vec![TeamEntityAccess {
            source_id: OWNER_TEAM_ID.to_string(),
            access_level: "view".to_string(),
            granted_from_project_id: None,
        }]
    );
    assert_eq!(count_entity_access(&pool, &chat_id, "channel").await, 1);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn patch_chat_link_share_leaves_team_share_untouched(pool: Pool<Postgres>) {
    add_owner_to_team(&pool).await;
    let repo = PgChatRepo::new(pool.clone());
    let chat_id = create_test_chat(&repo, "Team Shared Chat").await;

    patch_share_permission(
        &repo,
        &chat_id,
        team_share_request(Some(Some(AccessLevel::Edit))),
    )
    .await;
    patch_share_permission(
        &repo,
        &chat_id,
        UpdateSharePermissionRequestV2 {
            link_share: Some(None),
            link_share_access_level: None,
            channel_share_permissions: None,
            team_share_access_level: None,
        },
    )
    .await;

    let permission = get_stored_share_permission(&pool, &chat_id).await;
    assert_eq!(permission.link_share, None);
    assert_eq!(permission.link_share_access_level, None);
    assert_eq!(permission.team_share_access_level.as_deref(), Some("edit"));
    assert_eq!(get_team_entity_access(&pool, &chat_id).await.len(), 1);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn get_permissions_reads_team_share_access_level(pool: Pool<Postgres>) {
    add_owner_to_team(&pool).await;
    let repo = PgChatRepo::new(pool.clone());
    let chat_id = create_test_chat(&repo, "Team Shared Chat").await;

    let permission = repo.get_permissions(&chat_id).await.unwrap();
    assert_eq!(permission.team_share_access_level, None);

    patch_share_permission(
        &repo,
        &chat_id,
        team_share_request(Some(Some(AccessLevel::Edit))),
    )
    .await;

    let permission = repo.get_permissions(&chat_id).await.unwrap();
    assert_eq!(permission.team_share_access_level, Some(AccessLevel::Edit));
    assert_eq!(permission.owner, "macro|test@example.com");
    // Link share fields are reported independently of the team share.
    assert_eq!(permission.link_share, Some(LinkShare::Public));
    assert_eq!(permission.link_share_access_level, Some(AccessLevel::View));
}
