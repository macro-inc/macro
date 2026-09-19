use entity_access::domain::models::AccessError;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::team_share::{
    AuthorizedTeamShareCommand, TeamShareFacts, TeamShareLevel, TeamShareRequest,
    authorize_team_share,
};
use models_permissions::share_permission::{
    LinkShare, SharePermissionV2, UpdateSharePermissionRequestV2,
};
use sqlx::{PgPool, Pool, Postgres};
use uuid::Uuid;

use crate::domain::models::{ChatErr, CreateChatArgs, PatchChatRepoArgs};
use crate::domain::ports::ChatRepo;
use crate::outbound::postgres::PgChatRepo;

const OWNER: &str = "macro|test@example.com";
const TEAM_ID: Uuid = Uuid::from_u128(0xb2222222_2222_2222_2222_222222222222);

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(OWNER).unwrap().into_owned()
}

async fn create_chat(repo: &PgChatRepo, name: &str) -> String {
    repo.create(
        owner(),
        CreateChatArgs {
            name: name.to_string(),
            project_id: None,
        },
        SharePermissionV2::new_chat_share_permission(None),
    )
    .await
    .unwrap()
}

fn team_share_request(level: Option<AccessLevel>) -> UpdateSharePermissionRequestV2 {
    UpdateSharePermissionRequestV2 {
        link_share: None,
        link_share_access_level: None,
        team_share_access_level: Some(level),
        channel_share_permissions: None,
    }
}

/// Authorize `level` exactly as the domain service would for the persisted owner.
fn command(facts: &TeamShareFacts, level: Option<AccessLevel>) -> AuthorizedTeamShareCommand {
    authorize_team_share(
        Some(&facts.owner),
        facts,
        TeamShareRequest {
            access_level: Some(level),
            legacy_enabled: None,
        },
        TeamShareLevel::Edit,
    )
    .unwrap()
    .unwrap()
}

async fn patch_team_share(
    repo: &PgChatRepo,
    chat_id: &str,
    level: Option<AccessLevel>,
) -> Result<(), ChatErr> {
    let facts = repo.get_team_share_facts(chat_id).await?;
    repo.patch(
        owner(),
        chat_id,
        PatchChatRepoArgs {
            name: None,
            project_id: None,
            share_permission: Some(team_share_request(level)),
            team_share: Some(command(&facts, level)),
        },
    )
    .await
}

#[derive(Debug, PartialEq, Eq)]
struct StoredTeamShare {
    level: Option<String>,
    team_id: Option<Uuid>,
    revision: i64,
}

async fn stored_team_share(pool: &Pool<Postgres>, chat_id: &str) -> StoredTeamShare {
    let row = sqlx::query!(
        r#"
        SELECT
            sp.team_share_access_level::text AS "level?",
            sp.team_share_team_id AS "team_id?",
            sp.team_share_revision AS revision
        FROM "ChatPermission" cp
        JOIN "SharePermission" sp ON cp."sharePermissionId" = sp.id
        WHERE cp."chatId" = $1
        "#,
        chat_id,
    )
    .fetch_one(pool)
    .await
    .unwrap();
    StoredTeamShare {
        level: row.level,
        team_id: row.team_id,
        revision: row.revision,
    }
}

async fn direct_team_rows(pool: &Pool<Postgres>, chat_id: &str) -> Vec<AccessLevel> {
    sqlx::query_scalar!(
        r#"
        SELECT access_level AS "access_level: AccessLevel"
        FROM entity_access
        WHERE entity_id = $1 AND entity_type = 'chat' AND source_type = 'team'
          AND granted_from_project_id IS NULL
        ORDER BY access_level
        "#,
        Uuid::parse_str(chat_id).unwrap(),
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

fn unshared() -> StoredTeamShare {
    StoredTeamShare {
        level: None,
        team_id: None,
        revision: 0,
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("users", "team"))
)]
async fn get_team_share_facts_reads_owner_team_and_null_state(pool: PgPool) {
    let repo = PgChatRepo::new(pool.clone());
    let chat_id = create_chat(&repo, "Facts").await;

    let facts = repo.get_team_share_facts(&chat_id).await.unwrap();

    assert_eq!(facts.entity.entity_type, EntityType::Chat);
    assert_eq!(facts.entity.entity_id, chat_id);
    assert_eq!(facts.owner, owner());
    assert_eq!(facts.owner_team_id, Some(TEAM_ID));
    assert_eq!(facts.current, None);
    assert_eq!(facts.revision, 0);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("users"))
)]
async fn get_team_share_facts_without_team_has_no_owner_team(pool: PgPool) {
    let repo = PgChatRepo::new(pool.clone());
    let chat_id = create_chat(&repo, "No team").await;

    let facts = repo.get_team_share_facts(&chat_id).await.unwrap();

    assert_eq!(facts.owner_team_id, None);
    assert_eq!(facts.current, None);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("users", "team"))
)]
async fn patch_applies_team_share_command_and_inserts_direct_team_entity_access(pool: PgPool) {
    let repo = PgChatRepo::new(pool.clone());
    let chat_id = create_chat(&repo, "Shared").await;

    patch_team_share(&repo, &chat_id, Some(AccessLevel::Edit))
        .await
        .unwrap();
    assert_eq!(
        stored_team_share(&pool, &chat_id).await,
        StoredTeamShare {
            level: Some("edit".to_string()),
            team_id: Some(TEAM_ID),
            revision: 1,
        }
    );
    assert_eq!(direct_team_rows(&pool, &chat_id).await, [AccessLevel::Edit]);

    // A downgrade replaces the managed grant instead of adding a second row.
    patch_team_share(&repo, &chat_id, Some(AccessLevel::View))
        .await
        .unwrap();
    assert_eq!(
        stored_team_share(&pool, &chat_id).await,
        StoredTeamShare {
            level: Some("view".to_string()),
            team_id: Some(TEAM_ID),
            revision: 2,
        }
    );
    assert_eq!(direct_team_rows(&pool, &chat_id).await, [AccessLevel::View]);

    let facts = repo.get_team_share_facts(&chat_id).await.unwrap();
    assert_eq!(
        facts.current.map(|grant| (grant.team_id, grant.level)),
        Some((TEAM_ID, TeamShareLevel::View))
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("users", "team"))
)]
async fn patch_clear_command_removes_managed_team_entity_access_and_bumps_revision(pool: PgPool) {
    let repo = PgChatRepo::new(pool.clone());
    let chat_id = create_chat(&repo, "Cleared").await;
    patch_team_share(&repo, &chat_id, Some(AccessLevel::Comment))
        .await
        .unwrap();

    patch_team_share(&repo, &chat_id, None).await.unwrap();

    assert_eq!(
        stored_team_share(&pool, &chat_id).await,
        StoredTeamShare {
            level: None,
            team_id: None,
            revision: 2,
        }
    );
    assert!(direct_team_rows(&pool, &chat_id).await.is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("users", "team"))
)]
async fn patch_with_team_level_but_no_command_returns_unauthorized(pool: PgPool) {
    let repo = PgChatRepo::new(pool.clone());
    let chat_id = create_chat(&repo, "Original").await;

    let result = repo
        .patch(
            owner(),
            &chat_id,
            PatchChatRepoArgs {
                name: Some("Renamed".to_string()),
                project_id: None,
                share_permission: Some(team_share_request(Some(AccessLevel::Edit))),
                team_share: None,
            },
        )
        .await;

    assert!(matches!(
        result,
        Err(ChatErr::Access(AccessError::Unauthorized))
    ));
    assert_eq!(stored_team_share(&pool, &chat_id).await, unshared());
    assert!(direct_team_rows(&pool, &chat_id).await.is_empty());
    // The whole patch is rolled back, not just the team share.
    assert_eq!(repo.get_metadata(&chat_id).await.unwrap().name, "Original");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("users", "team"))
)]
async fn patch_rejects_command_for_other_chat_or_mismatched_level(pool: PgPool) {
    let repo = PgChatRepo::new(pool.clone());
    let chat_id = create_chat(&repo, "Target").await;
    let other_chat_id = create_chat(&repo, "Other").await;
    let facts = repo.get_team_share_facts(&chat_id).await.unwrap();
    let other_facts = repo.get_team_share_facts(&other_chat_id).await.unwrap();

    let wrong_chat = repo
        .patch(
            owner(),
            &chat_id,
            PatchChatRepoArgs {
                name: None,
                project_id: None,
                share_permission: Some(team_share_request(Some(AccessLevel::Edit))),
                team_share: Some(command(&other_facts, Some(AccessLevel::Edit))),
            },
        )
        .await;
    assert!(matches!(wrong_chat, Err(ChatErr::BadRequest(_))));

    let wrong_level = repo
        .patch(
            owner(),
            &chat_id,
            PatchChatRepoArgs {
                name: None,
                project_id: None,
                share_permission: Some(team_share_request(Some(AccessLevel::View))),
                team_share: Some(command(&facts, Some(AccessLevel::Edit))),
            },
        )
        .await;
    assert!(matches!(wrong_level, Err(ChatErr::BadRequest(_))));

    assert_eq!(stored_team_share(&pool, &chat_id).await, unshared());
    assert_eq!(stored_team_share(&pool, &other_chat_id).await, unshared());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("users", "team"))
)]
async fn patch_stale_command_returns_conflict(pool: PgPool) {
    let repo = PgChatRepo::new(pool.clone());
    let chat_id = create_chat(&repo, "Stale").await;
    let facts = repo.get_team_share_facts(&chat_id).await.unwrap();
    let stale = command(&facts, Some(AccessLevel::Edit));

    patch_team_share(&repo, &chat_id, Some(AccessLevel::Edit))
        .await
        .unwrap();

    let replay = repo
        .patch(
            owner(),
            &chat_id,
            PatchChatRepoArgs {
                name: None,
                project_id: None,
                share_permission: Some(team_share_request(Some(AccessLevel::Edit))),
                team_share: Some(stale),
            },
        )
        .await;

    assert!(matches!(replay, Err(ChatErr::Conflict(_))));
    assert_eq!(stored_team_share(&pool, &chat_id).await.revision, 1);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("users", "team"))
)]
async fn patch_team_share_and_link_share_in_one_call_persists_both(pool: PgPool) {
    let repo = PgChatRepo::new(pool.clone());
    let chat_id = create_chat(&repo, "Both").await;
    let facts = repo.get_team_share_facts(&chat_id).await.unwrap();

    repo.patch(
        owner(),
        &chat_id,
        PatchChatRepoArgs {
            name: Some("Renamed".to_string()),
            project_id: None,
            share_permission: Some(UpdateSharePermissionRequestV2 {
                link_share: Some(Some(LinkShare::Team)),
                link_share_access_level: Some(Some(AccessLevel::Comment)),
                team_share_access_level: Some(Some(AccessLevel::Edit)),
                channel_share_permissions: None,
            }),
            team_share: Some(command(&facts, Some(AccessLevel::Edit))),
        },
    )
    .await
    .unwrap();

    let permission = repo.get_permissions(&chat_id).await.unwrap();
    assert_eq!(permission.link_share, Some(LinkShare::Team));
    assert_eq!(
        permission.link_share_access_level,
        Some(AccessLevel::Comment)
    );
    assert_eq!(permission.team_share_access_level, Some(AccessLevel::Edit));
    assert_eq!(repo.get_metadata(&chat_id).await.unwrap().name, "Renamed");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("users", "team"))
)]
async fn get_permissions_reads_team_share_access_level(pool: PgPool) {
    let repo = PgChatRepo::new(pool.clone());
    let chat_id = create_chat(&repo, "Read").await;
    assert_eq!(
        repo.get_permissions(&chat_id)
            .await
            .unwrap()
            .team_share_access_level,
        None
    );

    patch_team_share(&repo, &chat_id, Some(AccessLevel::Comment))
        .await
        .unwrap();

    assert_eq!(
        repo.get_permissions(&chat_id)
            .await
            .unwrap()
            .team_share_access_level,
        Some(AccessLevel::Comment)
    );
}
