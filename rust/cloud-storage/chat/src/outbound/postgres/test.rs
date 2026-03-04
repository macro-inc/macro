use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{Pool, Postgres};

use super::PgChatRepo;
use crate::domain::ports::ChatRepo;
use crate::models::{CopyChatArgs, CreateChatArgs, PatchChatArgs};

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
        )
        .await
        .unwrap();

    assert!(!chat_id.is_empty());

    // verify the chat row exists
    let row = sqlx::query!(
        r#"SELECT "userId", name FROM "Chat" WHERE id = $1"#,
        &chat_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(row.name, "Test Chat");
    assert_eq!(row.userId, "macro|test@example.com");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn create_chat_creates_permission(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool.clone());
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com")
        .unwrap()
        .into_owned();

    let chat_id = repo
        .create(
            user_id,
            CreateChatArgs {
                name: "Perm Chat".to_string(),
                project_id: None,
            },
        )
        .await
        .unwrap();

    let perm = sqlx::query!(
        r#"SELECT "sharePermissionId" FROM "ChatPermission" WHERE "chatId" = $1"#,
        &chat_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert!(!perm.sharePermissionId.is_empty());
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
        )
        .await
        .unwrap();

    let access = sqlx::query!(
        r#"
        SELECT "access_level"::text as "access_level"
        FROM "UserItemAccess"
        WHERE "user_id" = $1 AND "item_id" = $2 AND "item_type" = 'chat'
        "#,
        "macro|test@example.com",
        &chat_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(access.access_level, Some("owner".to_string()));
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
        )
        .await
        .unwrap();

    let history = sqlx::query!(
        r#"
        SELECT "itemType" FROM "UserHistory"
        WHERE "userId" = $1 AND "itemId" = $2
        "#,
        "macro|test@example.com",
        &chat_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(history.itemType, "chat");
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
        )
        .await
        .unwrap();

    let row = sqlx::query!(r#"SELECT "projectId" FROM "Chat" WHERE id = $1"#, &chat_id,)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(row.projectId, Some("project-123".to_string()));
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
    assert!(result.is_err());
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
        )
        .await
        .unwrap();

    repo.delete(&chat_id).await.unwrap();

    let row = sqlx::query!(r#"SELECT "deletedAt" FROM "Chat" WHERE id = $1"#, &chat_id,)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert!(row.deletedAt.is_some());
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
        )
        .await
        .unwrap();

    repo.delete(&chat_id).await.unwrap();

    let count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM "UserHistory" WHERE "itemId" = $1 AND "itemType" = 'chat'"#,
        &chat_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(count, Some(0));
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
        )
        .await
        .unwrap();

    repo.permanently_delete(&chat_id).await.unwrap();

    let count = sqlx::query_scalar!(r#"SELECT COUNT(*) FROM "Chat" WHERE id = $1"#, &chat_id,)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(count, Some(0));
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
        )
        .await
        .unwrap();

    repo.permanently_delete(&chat_id).await.unwrap();

    let count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM "ChatPermission" WHERE "chatId" = $1"#,
        &chat_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(count, Some(0));
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
        )
        .await
        .unwrap();

    repo.permanently_delete(&chat_id).await.unwrap();

    let count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM "UserItemAccess" WHERE "item_id" = $1 AND "item_type" = 'chat'"#,
        &chat_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(count, Some(0));
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

    let row = sqlx::query!(r#"SELECT "projectId" FROM "Chat" WHERE id = $1"#, &chat_id,)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(row.projectId, Some("project-123".to_string()));
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

    let row = sqlx::query!(r#"SELECT "projectId" FROM "Chat" WHERE id = $1"#, &chat_id,)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(row.projectId, None);
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
        )
        .await
        .unwrap();

    let response = repo.get_chat(&chat_id).await.unwrap();

    assert_eq!(response.id, chat_id);
    assert_eq!(response.name, "Full Chat");
    assert_eq!(response.user_id, "macro|test@example.com");
    assert!(response.model.is_some());
    assert!(response.messages.is_empty());
    assert!(response.web_citations.is_empty());
    assert!(!response.available_models.is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn get_chat_not_found_returns_error(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool);

    let result = repo.get_chat("nonexistent-id").await;
    assert!(result.is_err());
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
        )
        .await
        .unwrap();

    assert_ne!(source_id, copied_id);

    // Verify the copy has the right name
    let copy = repo.get_metadata(&copied_id).await.unwrap();
    assert_eq!(copy.name, "Copied Chat");

    // Verify the message was copied
    let msg_count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) FROM "ChatMessage" WHERE "chatId" = $1"#,
        &copied_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(msg_count, Some(1));
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
        r#"SELECT COUNT(*) FROM "UserHistory" WHERE "itemId" = $1 AND "itemType" = 'chat'"#,
        &chat_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(count, Some(1));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn get_permissions_returns_share_permission(pool: Pool<Postgres>) {
    let repo = PgChatRepo::new(pool.clone());
    let user_id = MacroUserIdStr::parse_from_str("macro|test@example.com")
        .unwrap()
        .into_owned();

    let chat_id = repo
        .create(
            user_id,
            CreateChatArgs {
                name: "Perms Chat".to_string(),
                project_id: None,
            },
        )
        .await
        .unwrap();

    let perms = repo.get_permissions(&chat_id).await.unwrap();

    assert!(!perms.id.is_empty());
    assert_eq!(perms.owner, "macro|test@example.com");
    assert!(perms.is_public);
}
