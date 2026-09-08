use std::time::Duration;

use agent::types::{ChatMessageContent, Role};
use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model::chat::NewChatMessage;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::{
    LinkShare, SharePermissionV2, UpdateSharePermissionRequestV2,
};
use sqlx::{Pool, Postgres, Row};

use super::PgChatRepo;
use crate::domain::models::{ChatErr, CopyChatArgs, CreateChatArgs, PatchChatArgs};
use crate::domain::ports::ChatRepo;

/// The no-team default permission for a chat — the repo persists whatever the
/// domain layer resolved, so tests pass it explicitly.
fn default_share_permission() -> SharePermissionV2 {
    SharePermissionV2::new_chat_share_permission(None)
}

use model_entity::EntityType;
use models_permissions::share_permission::team_share::{
    AuthorizedTeamShareCommand, TeamShareFacts, TeamShareLevel, TeamShareMaintenance,
    TeamShareRequest, authorize_team_share,
};
use uuid::Uuid;

fn test_owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|test@example.com".to_string()).unwrap()
}

fn team_policy(level: Option<Option<AccessLevel>>) -> UpdateSharePermissionRequestV2 {
    UpdateSharePermissionRequestV2 {
        team_share_access_level: level,
        link_share: None,
        link_share_access_level: None,
        channel_share_permissions: None,
    }
}

fn authorize(facts: &TeamShareFacts, level: Option<AccessLevel>) -> AuthorizedTeamShareCommand {
    authorize_team_share(
        Some(&facts.owner),
        facts,
        TeamShareRequest {
            access_level: Some(level),
            legacy_enabled: None,
        },
        TeamShareLevel::View,
    )
    .unwrap()
    .unwrap()
}

async fn set_team_level(repo: &PgChatRepo, chat_id: &str, level: Option<AccessLevel>) {
    let facts = repo.get_team_share_facts(chat_id).await.unwrap();
    repo.patch(
        facts.owner.clone(),
        chat_id,
        PatchChatArgs {
            name: None,
            project_id: None,
            share_permission: Some(team_policy(Some(level))),
        },
        Some(authorize(&facts, level)),
    )
    .await
    .unwrap();
}

async fn seed_team_project(pool: &Pool<Postgres>) -> (Uuid, String) {
    let team = Uuid::now_v7();
    let project = Uuid::now_v7().to_string();
    let owner = test_owner();
    sqlx::query!(
        "INSERT INTO team (id, name, owner_id, seat_count) VALUES ($1, 'Team', $2, 1)",
        team,
        owner.as_ref()
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO team_user (team_id, user_id, team_role) VALUES ($1, $2, 'owner')",
        team,
        owner.as_ref()
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "Project" (id, name, "userId") VALUES ($1, 'Shared project', $2)"#,
        project,
        owner.as_ref()
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(r#"INSERT INTO "SharePermission" (id) VALUES ($1)"#, project)
        .execute(pool)
        .await
        .unwrap();
    sqlx::query!(
        r#"INSERT INTO "ProjectPermission" ("projectId", "sharePermissionId") VALUES ($1, $1)"#,
        project
    )
    .execute(pool)
    .await
    .unwrap();
    let mut tx = pool.begin().await.unwrap();
    let facts = share_permission_db_utils::team_share::load_facts(
        &mut tx,
        &EntityType::Project.with_entity_str(&project),
    )
    .await
    .unwrap();
    share_permission_db_utils::team_share::apply(
        &mut tx,
        &authorize(&facts, Some(AccessLevel::Comment)),
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    (team, project)
}

async fn team_grants(pool: &Pool<Postgres>, chat_id: &str) -> Vec<(Option<String>, String)> {
    sqlx::query!(r#"SELECT granted_from_project_id, access_level::text AS "level!" FROM entity_access WHERE entity_id = $1 AND entity_type = 'chat' AND source_type = 'team' ORDER BY granted_from_project_id NULLS FIRST"#, Uuid::parse_str(chat_id).unwrap())
        .fetch_all(pool).await.unwrap().into_iter().map(|row| (row.granted_from_project_id, row.level)).collect()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn canonical_chat_sharing_downgrades_preserves_omission_and_revisions(pool: Pool<Postgres>) {
    let (team, _) = seed_team_project(&pool).await;
    let repo = PgChatRepo::new(pool.clone());
    let chat = create_test_chat(&repo, "Canonical").await;
    for (index, level) in [AccessLevel::Edit, AccessLevel::View, AccessLevel::View]
        .into_iter()
        .enumerate()
    {
        set_team_level(&repo, &chat, Some(level)).await;
        let facts = repo.get_team_share_facts(&chat).await.unwrap();
        assert_eq!(facts.revision, index as i64 + 1);
        assert_eq!(facts.current.unwrap().team_id, team);
        assert_eq!(
            repo.get_permissions(&chat)
                .await
                .unwrap()
                .team_share_access_level,
            Some(level)
        );
        assert_eq!(
            team_grants(&pool, &chat).await,
            vec![(None, level.to_string())]
        );
    }
    patch_share_permission(&repo, &chat, team_policy(None)).await;
    assert_eq!(repo.get_team_share_facts(&chat).await.unwrap().revision, 3);
    for revision in [4, 5] {
        set_team_level(&repo, &chat, None).await;
        let facts = repo.get_team_share_facts(&chat).await.unwrap();
        assert_eq!(facts.revision, revision);
        assert!(facts.current.is_none());
        assert!(team_grants(&pool, &chat).await.is_empty());
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn create_copy_and_moves_commit_current_inheritance_without_copying_consent(
    pool: Pool<Postgres>,
) {
    let (_, project) = seed_team_project(&pool).await;
    let repo = PgChatRepo::new(pool.clone());
    let mut permission = default_share_permission();
    permission.team_share_access_level = Some(AccessLevel::Edit);
    let chat = repo
        .create(
            test_owner(),
            CreateChatArgs {
                name: "Placed".into(),
                project_id: Some(project.clone()),
            },
            permission.clone(),
        )
        .await
        .unwrap();
    assert!(
        repo.get_team_share_facts(&chat)
            .await
            .unwrap()
            .current
            .is_none()
    );
    assert_eq!(
        team_grants(&pool, &chat).await,
        vec![(Some(project.clone()), "comment".into())]
    );
    set_team_level(&repo, &chat, Some(AccessLevel::Edit)).await;
    let copy = repo
        .copy_chat(
            test_owner(),
            &chat,
            CopyChatArgs {
                name: "Copy".into(),
                project_id: Some(project.clone()),
            },
            permission,
        )
        .await
        .unwrap();
    let copied = repo.get_team_share_facts(&copy).await.unwrap();
    assert!(copied.current.is_none());
    assert_eq!(copied.revision, 0);
    assert_eq!(
        team_grants(&pool, &copy).await,
        vec![(Some(project.clone()), "comment".into())]
    );
    for destination in ["project-123", project.as_str(), ""] {
        repo.patch(
            test_owner(),
            &chat,
            PatchChatArgs {
                name: None,
                project_id: Some(destination.into()),
                share_permission: None,
            },
            None,
        )
        .await
        .unwrap();
        let mut expected = vec![(None, "edit".into())];
        if destination == project {
            expected.push((Some(project.clone()), "comment".into()));
        }
        assert_eq!(team_grants(&pool, &chat).await, expected);
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn mixed_patch_rolls_back_grants_revision_metadata_and_placement(pool: Pool<Postgres>) {
    let (_, project) = seed_team_project(&pool).await;
    let repo = PgChatRepo::new(pool.clone());
    let chat = create_test_chat(&repo, "Original").await;
    let facts = repo.get_team_share_facts(&chat).await.unwrap();
    // Fail after the canonical grant write, when the accompanying metadata is written.
    sqlx::query!(
        r#"ALTER TABLE "Chat" ADD CONSTRAINT test_reject_name CHECK (name <> 'Rejected')"#
    )
    .execute(&pool)
    .await
    .unwrap();
    let mut policy = team_policy(Some(Some(AccessLevel::Edit)));
    policy.link_share = Some(None);
    let before_permission = get_stored_share_permission(&pool, &chat).await;
    assert!(
        repo.patch(
            test_owner(),
            &chat,
            PatchChatArgs {
                name: Some("Rejected".into()),
                project_id: Some(project),
                share_permission: Some(policy)
            },
            Some(authorize(&facts, Some(AccessLevel::Edit)))
        )
        .await
        .is_err()
    );
    assert_eq!(repo.get_team_share_facts(&chat).await.unwrap(), facts);
    assert_eq!(
        get_stored_share_permission(&pool, &chat).await,
        before_permission
    );
    let metadata = repo.get_metadata(&chat).await.unwrap();
    assert_eq!(metadata.name, "Original");
    assert!(metadata.project_id.is_none());
    assert!(team_grants(&pool, &chat).await.is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn stale_owner_and_team_commands_reject_all_writes(pool: Pool<Postgres>) {
    seed_team_project(&pool).await;
    let repo = PgChatRepo::new(pool.clone());
    let chat = create_test_chat(&repo, "Original").await;
    let facts = repo.get_team_share_facts(&chat).await.unwrap();
    let other = MacroUserIdStr::try_from("macro|other@example.com".to_string()).unwrap();
    assert!(matches!(
        repo.patch(
            other,
            &chat,
            PatchChatArgs {
                name: Some("Changed".into()),
                project_id: None,
                share_permission: None
            },
            None
        )
        .await,
        Err(ChatErr::Access(_))
    ));
    set_team_level(&repo, &chat, None).await;
    assert!(matches!(
        repo.patch(
            test_owner(),
            &chat,
            PatchChatArgs {
                name: Some("Changed".into()),
                project_id: None,
                share_permission: Some(team_policy(Some(Some(AccessLevel::Edit))))
            },
            Some(authorize(&facts, Some(AccessLevel::Edit)))
        )
        .await,
        Err(ChatErr::Access(_))
    ));
    assert_eq!(repo.get_metadata(&chat).await.unwrap().name, "Original");
    assert!(team_grants(&pool, &chat).await.is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn restore_clears_departed_owner_consent_and_uses_stored_project(pool: Pool<Postgres>) {
    let (_, project) = seed_team_project(&pool).await;
    let repo = PgChatRepo::new(pool.clone());
    let chat = repo
        .create(
            test_owner(),
            CreateChatArgs {
                name: "Restore".into(),
                project_id: Some(project.clone()),
            },
            default_share_permission(),
        )
        .await
        .unwrap();
    set_team_level(&repo, &chat, Some(AccessLevel::Edit)).await;
    repo.delete(&chat).await.unwrap();
    let owner = test_owner();
    sqlx::query!("DELETE FROM team_user WHERE user_id = $1", owner.as_ref())
        .execute(&pool)
        .await
        .unwrap();
    sqlx::query!(
        r#"UPDATE "Project" SET "deletedAt" = NOW() WHERE id = $1"#,
        project
    )
    .execute(&pool)
    .await
    .unwrap();
    let facts = repo.get_team_share_facts(&chat).await.unwrap();
    assert!(facts.owner_team_id.is_none());
    repo.revert_delete(
        &chat,
        facts.clone(),
        Some(TeamShareMaintenance::Clear { expected: facts }),
    )
    .await
    .unwrap();
    let metadata = repo.get_metadata(&chat).await.unwrap();
    assert!(metadata.deleted_at.is_none());
    assert!(metadata.project_id.is_none());
    assert!(
        repo.get_permissions(&chat)
            .await
            .unwrap()
            .team_share_access_level
            .is_none()
    );
    assert!(team_grants(&pool, &chat).await.is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "fixtures", scripts("users"))
)]
async fn inheritance_failure_rolls_back_create_copy_move_and_restore(pool: Pool<Postgres>) {
    let (_, project) = seed_team_project(&pool).await;
    let repo = PgChatRepo::new(pool.clone());
    let chat = create_test_chat(&repo, "Original").await;
    sqlx::query!("ALTER TABLE entity_access ADD CONSTRAINT test_reject_chat_inheritance CHECK (entity_type <> 'chat' OR granted_from_project_id IS NULL)").execute(&pool).await.unwrap();
    assert!(
        repo.create(
            test_owner(),
            CreateChatArgs {
                name: "Rejected create".into(),
                project_id: Some(project.clone())
            },
            default_share_permission()
        )
        .await
        .is_err()
    );
    assert!(
        repo.copy_chat(
            test_owner(),
            &chat,
            CopyChatArgs {
                name: "Rejected copy".into(),
                project_id: Some(project.clone())
            },
            default_share_permission()
        )
        .await
        .is_err()
    );
    assert_eq!(
        sqlx::query_scalar!(r#"SELECT COUNT(*) FROM "Chat""#)
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(1)
    );
    assert!(
        repo.patch(
            test_owner(),
            &chat,
            PatchChatArgs {
                name: Some("Rejected move".into()),
                project_id: Some(project.clone()),
                share_permission: None
            },
            None
        )
        .await
        .is_err()
    );
    let metadata = repo.get_metadata(&chat).await.unwrap();
    assert_eq!(metadata.name, "Original");
    assert!(metadata.project_id.is_none());
    repo.delete(&chat).await.unwrap();
    // Simulate a trashed chat still assigned to a live shared project.
    sqlx::query!(
        r#"UPDATE "Chat" SET "projectId" = $1 WHERE id = $2"#,
        project,
        chat
    )
    .execute(&pool)
    .await
    .unwrap();
    let facts = repo.get_team_share_facts(&chat).await.unwrap();
    assert!(repo.revert_delete(&chat, facts, None).await.is_err());
    assert!(repo.get_metadata(&chat).await.unwrap().deleted_at.is_some());
    assert_eq!(
        sqlx::query_scalar!(
            r#"SELECT COUNT(*) FROM "UserHistory" WHERE "itemId" = $1"#,
            chat
        )
        .fetch_one(&pool)
        .await
        .unwrap(),
        Some(0)
    );
    sqlx::query!("ALTER TABLE entity_access DROP CONSTRAINT test_reject_chat_inheritance")
        .execute(&pool)
        .await
        .unwrap();
    let facts = repo.get_team_share_facts(&chat).await.unwrap();
    repo.revert_delete(&chat, facts, None).await.unwrap();
    assert_eq!(
        team_grants(&pool, &chat).await,
        vec![(Some(project), "comment".into())]
    );
}

#[derive(Debug, Eq, PartialEq)]
struct StoredSharePermission {
    id: String,
    link_share: Option<String>,
    link_share_access_level: Option<String>,
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
            sp."linkShareAccessLevel"::text AS "link_share_access_level?"
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
        None,
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
    let row = sqlx::query(r#"SELECT "userId", name FROM "Chat" WHERE id = $1"#)
        .bind(&chat_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(row.get::<String, _>("name"), "Test Chat");
    assert_eq!(row.get::<String, _>("userId"), "macro|test@example.com");
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

    let row = sqlx::query(
        r#"
        SELECT "access_level"::text as "access_level"
        FROM "entity_access"
        WHERE "source_id" = $1 AND "entity_id" = $2
        "#,
    )
    .bind("macro|test@example.com")
    .bind(macro_uuid::string_to_uuid(&chat_id).unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(
        row.get::<Option<String>, _>("access_level"),
        Some("owner".to_string())
    );
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

    let row = sqlx::query(
        r#"
        SELECT "itemType" FROM "UserHistory"
        WHERE "userId" = $1 AND "itemId" = $2
        "#,
    )
    .bind("macro|test@example.com")
    .bind(&chat_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(row.get::<String, _>("itemType"), "chat");
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

    let row = sqlx::query(r#"SELECT "projectId" FROM "Chat" WHERE id = $1"#)
        .bind(&chat_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(
        row.get::<Option<String>, _>("projectId"),
        Some("project-123".to_string())
    );
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

    let row = sqlx::query(r#"SELECT "deletedAt" FROM "Chat" WHERE id = $1"#)
        .bind(&chat_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    let deleted_at: Option<chrono::NaiveDateTime> = row.get("deletedAt");
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

    let count: (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*) FROM "UserHistory" WHERE "itemId" = $1 AND "itemType" = 'chat'"#,
    )
    .bind(&chat_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(count.0, 0);
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

    let count: (i64,) = sqlx::query_as(r#"SELECT COUNT(*) FROM "Chat" WHERE id = $1"#)
        .bind(&chat_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(count.0, 0);
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

    let count: (i64,) =
        sqlx::query_as(r#"SELECT COUNT(*) FROM "ChatPermission" WHERE "chatId" = $1"#)
            .bind(&chat_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(count.0, 0);
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
        None,
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
        None,
    )
    .await
    .unwrap();

    let row = sqlx::query(r#"SELECT "projectId" FROM "Chat" WHERE id = $1"#)
        .bind(&chat_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(
        row.get::<Option<String>, _>("projectId"),
        Some("project-123".to_string())
    );
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
        None,
    )
    .await
    .unwrap();

    let row = sqlx::query(r#"SELECT "projectId" FROM "Chat" WHERE id = $1"#)
        .bind(&chat_id)
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(row.get::<Option<String>, _>("projectId"), None::<String>);
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
    sqlx::query(
        r#"
        INSERT INTO "ChatMessage" ("chatId", "content", "role")
        VALUES ($1, '"hello"', 'user')
        "#,
    )
    .bind(&source_id)
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
    let msg_count: (i64,) =
        sqlx::query_as(r#"SELECT COUNT(*) FROM "ChatMessage" WHERE "chatId" = $1"#)
            .bind(&copied_id)
            .fetch_one(&pool)
            .await
            .unwrap();

    assert_eq!(msg_count.0, 1);
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

    repo.revert_delete(
        &chat_id,
        repo.get_team_share_facts(&chat_id).await.unwrap(),
        None,
    )
    .await
    .unwrap();

    // Confirm it's restored
    let chat = repo.get_metadata(&chat_id).await.unwrap();
    assert!(chat.deleted_at.is_none());

    // Confirm history was re-added
    let count: (i64,) = sqlx::query_as(
        r#"SELECT COUNT(*) FROM "UserHistory" WHERE "itemId" = $1 AND "itemType" = 'chat'"#,
    )
    .bind(&chat_id)
    .fetch_one(&pool)
    .await
    .unwrap();

    assert_eq!(count.0, 1);
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
            team_share_access_level: None,
            channel_share_permissions: None,
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
            team_share_access_level: None,
            channel_share_permissions: None,
        },
    )
    .await;
    patch_share_permission(
        &repo,
        &chat_id,
        UpdateSharePermissionRequestV2 {
            link_share: None,
            link_share_access_level: Some(None),
            team_share_access_level: None,
            channel_share_permissions: None,
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
            team_share_access_level: None,
            channel_share_permissions: None,
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
    assert_eq!(permission.team_share_access_level, None);

    let team_id = uuid::Uuid::now_v7();
    for level in [
        Some(AccessLevel::View),
        Some(AccessLevel::Comment),
        Some(AccessLevel::Edit),
        None,
    ] {
        sqlx::query!(
            r#"
            UPDATE "SharePermission"
            SET team_share_access_level = $2,
                team_share_team_id = $3
            WHERE id = $1
            "#,
            permission.id,
            level as _,
            level.map(|_| team_id),
        )
        .execute(&pool)
        .await
        .unwrap();
        let fresh_permission = repo.get_permissions(&chat_id).await.unwrap();
        assert_eq!(fresh_permission.team_share_access_level, level);
        assert_eq!(fresh_permission.link_share, permission.link_share);
        assert_eq!(
            fresh_permission.link_share_access_level,
            permission.link_share_access_level
        );
    }
}
