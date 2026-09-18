use macro_db_migrator::MACRO_DB_MIGRATIONS;
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

use crate::domain::models::{CreateProjectArgs, EditProjectArgs, ProjectError};
use crate::domain::ports::ProjectRepo;
use crate::outbound::pg_project_repo::PgProjectRepo;

const OWNER: &str = "macro|test@example.com";
const TEAM_ID: Uuid = Uuid::from_u128(0xb2222222_2222_2222_2222_222222222222);

async fn create_project(repo: &PgProjectRepo, name: &str) -> String {
    repo.create_project(CreateProjectArgs {
        user_id: OWNER.to_owned(),
        name: name.to_string(),
        parent_id: None,
        share_permission: SharePermissionV2::new_project_share_permission(None),
    })
    .await
    .unwrap()
    .id
}

fn team_share_request(level: Option<AccessLevel>) -> UpdateSharePermissionRequestV2 {
    UpdateSharePermissionRequestV2 {
        link_share: None,
        link_share_access_level: None,
        team_share_access_level: Some(level),
        channel_share_permissions: None,
    }
}

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

async fn edit_team_share(
    repo: &PgProjectRepo,
    project_id: &str,
    level: Option<AccessLevel>,
) -> Result<(), ProjectError> {
    let facts = repo.get_team_share_facts(project_id).await?;
    repo.edit_project(EditProjectArgs {
        project_id: project_id.to_string(),
        name: None,
        update_parent: false,
        parent_id: None,
        share_permission: Some(team_share_request(level)),
        team_share: Some(command(&facts, level)),
    })
    .await
    .map(|_| ())
}

#[derive(Debug, PartialEq, Eq)]
struct StoredTeamShare {
    level: Option<String>,
    team_id: Option<Uuid>,
    revision: i64,
}

async fn stored_team_share(pool: &Pool<Postgres>, project_id: &str) -> StoredTeamShare {
    let row = sqlx::query!(
        r#"
        SELECT
            sp.team_share_access_level::text AS "level?",
            sp.team_share_team_id AS "team_id?",
            sp.team_share_revision AS revision
        FROM "ProjectPermission" pp
        JOIN "SharePermission" sp ON pp."sharePermissionId" = sp.id
        WHERE pp."projectId" = $1
        "#,
        project_id,
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

async fn inherited_team_rows(
    pool: &Pool<Postgres>,
    project_id: &str,
) -> Vec<(Uuid, String, AccessLevel)> {
    sqlx::query!(
        r#"
        SELECT entity_id, entity_type, access_level AS "access_level: AccessLevel"
        FROM entity_access
        WHERE granted_from_project_id = $1 AND source_type = 'team'
        ORDER BY entity_id
        "#,
        project_id,
    )
    .fetch_all(pool)
    .await
    .unwrap()
    .into_iter()
    .map(|row| (row.entity_id, row.entity_type, row.access_level))
    .collect()
}

async fn insert_folder_document(pool: &Pool<Postgres>, project_id: &str, document_id: Uuid) {
    sqlx::query!(
        r#"INSERT INTO "Document" (id, name, owner, "projectId")
        VALUES ($1, 'Nested', $2, $3)"#,
        document_id.to_string(),
        OWNER,
        project_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

async fn direct_team_rows(pool: &Pool<Postgres>, project_id: &str) -> Vec<AccessLevel> {
    sqlx::query_scalar!(
        r#"
        SELECT access_level AS "access_level: AccessLevel"
        FROM entity_access
        WHERE entity_id = $1 AND entity_type = 'project' AND source_type = 'team'
          AND granted_from_project_id IS NULL
        ORDER BY access_level
        "#,
        Uuid::parse_str(project_id).unwrap(),
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
    let repo = PgProjectRepo::new(pool.clone());
    let project_id = create_project(&repo, "Facts").await;

    let facts = repo.get_team_share_facts(&project_id).await.unwrap();

    assert_eq!(facts.entity.entity_type, EntityType::Project);
    assert_eq!(facts.entity.entity_id, project_id);
    assert_eq!(facts.owner.as_ref(), OWNER);
    assert_eq!(facts.owner_team_id, Some(TEAM_ID));
    assert_eq!(facts.current, None);
    assert_eq!(facts.revision, 0);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("users"))
)]
async fn get_team_share_facts_without_team_has_no_owner_team(pool: PgPool) {
    let repo = PgProjectRepo::new(pool.clone());
    let project_id = create_project(&repo, "No team").await;

    let facts = repo.get_team_share_facts(&project_id).await.unwrap();

    assert_eq!(facts.owner_team_id, None);
    assert_eq!(facts.current, None);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("users", "team"))
)]
async fn edit_applies_team_share_command_and_inserts_direct_team_entity_access(pool: PgPool) {
    let repo = PgProjectRepo::new(pool.clone());
    let project_id = create_project(&repo, "Shared").await;

    edit_team_share(&repo, &project_id, Some(AccessLevel::Edit))
        .await
        .unwrap();
    assert_eq!(
        stored_team_share(&pool, &project_id).await,
        StoredTeamShare {
            level: Some("edit".to_string()),
            team_id: Some(TEAM_ID),
            revision: 1,
        }
    );
    assert_eq!(
        direct_team_rows(&pool, &project_id).await,
        [AccessLevel::Edit]
    );

    edit_team_share(&repo, &project_id, Some(AccessLevel::View))
        .await
        .unwrap();
    assert_eq!(
        stored_team_share(&pool, &project_id).await,
        StoredTeamShare {
            level: Some("view".to_string()),
            team_id: Some(TEAM_ID),
            revision: 2,
        }
    );
    assert_eq!(
        direct_team_rows(&pool, &project_id).await,
        [AccessLevel::View]
    );

    let facts = repo.get_team_share_facts(&project_id).await.unwrap();
    assert_eq!(
        facts.current.map(|grant| (grant.team_id, grant.level)),
        Some((TEAM_ID, TeamShareLevel::View))
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("users", "team"))
)]
async fn edit_team_share_copies_and_clears_nested_document_grants(pool: PgPool) {
    let repo = PgProjectRepo::new(pool.clone());
    let project_id = create_project(&repo, "Folder").await;
    let document_id = Uuid::from_u128(0xc3333333_3333_3333_3333_333333333333);
    insert_folder_document(&pool, &project_id, document_id).await;

    edit_team_share(&repo, &project_id, Some(AccessLevel::Edit))
        .await
        .unwrap();
    assert_eq!(
        inherited_team_rows(&pool, &project_id).await,
        [(document_id, "document".to_string(), AccessLevel::Edit)]
    );

    let stale_id = Uuid::from_u128(0xc5555555_5555_5555_5555_555555555555);
    sqlx::query!(
        r#"INSERT INTO entity_access
            (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
        VALUES ($1, 'email_thread', $2, 'team', 'edit', $3)"#,
        stale_id,
        TEAM_ID.to_string(),
        project_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    edit_team_share(&repo, &project_id, Some(AccessLevel::View))
        .await
        .unwrap();
    assert_eq!(
        inherited_team_rows(&pool, &project_id).await,
        [(document_id, "document".to_string(), AccessLevel::View)]
    );

    let later_id = Uuid::from_u128(0xc4444444_4444_4444_4444_444444444444);
    insert_folder_document(&pool, &project_id, later_id).await;
    sqlx::query!(
        r#"INSERT INTO entity_access
            (entity_id, entity_type, source_id, source_type, access_level, granted_from_project_id)
        VALUES ($1, 'document', $2, 'team', 'view', $3)"#,
        later_id,
        TEAM_ID.to_string(),
        project_id,
    )
    .execute(&pool)
    .await
    .unwrap();

    edit_team_share(&repo, &project_id, None).await.unwrap();
    assert!(inherited_team_rows(&pool, &project_id).await.is_empty());
    assert!(direct_team_rows(&pool, &project_id).await.is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("users", "team"))
)]
async fn edit_clear_command_removes_managed_team_entity_access_and_bumps_revision(pool: PgPool) {
    let repo = PgProjectRepo::new(pool.clone());
    let project_id = create_project(&repo, "Cleared").await;
    edit_team_share(&repo, &project_id, Some(AccessLevel::Comment))
        .await
        .unwrap();

    edit_team_share(&repo, &project_id, None).await.unwrap();

    assert_eq!(
        stored_team_share(&pool, &project_id).await,
        StoredTeamShare {
            level: None,
            team_id: None,
            revision: 2,
        }
    );
    assert!(direct_team_rows(&pool, &project_id).await.is_empty());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("users", "team"))
)]
async fn edit_with_team_level_but_no_command_returns_unauthorized(pool: PgPool) {
    let repo = PgProjectRepo::new(pool.clone());
    let project_id = create_project(&repo, "Original").await;

    let result = repo
        .edit_project(EditProjectArgs {
            project_id: project_id.clone(),
            name: Some("Renamed".to_string()),
            update_parent: false,
            parent_id: None,
            share_permission: Some(team_share_request(Some(AccessLevel::Edit))),
            team_share: None,
        })
        .await;

    assert!(matches!(result, Err(ProjectError::Unauthorized)));
    assert_eq!(stored_team_share(&pool, &project_id).await, unshared());
    assert!(direct_team_rows(&pool, &project_id).await.is_empty());
    assert_eq!(
        repo.get_project_by_id(&project_id)
            .await
            .unwrap()
            .unwrap()
            .name,
        "Original"
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("users", "team"))
)]
async fn edit_rejects_command_for_other_project_or_mismatched_level(pool: PgPool) {
    let repo = PgProjectRepo::new(pool.clone());
    let project_id = create_project(&repo, "Target").await;
    let other_project_id = create_project(&repo, "Other").await;
    let facts = repo.get_team_share_facts(&project_id).await.unwrap();
    let other_facts = repo.get_team_share_facts(&other_project_id).await.unwrap();

    let wrong_project = repo
        .edit_project(EditProjectArgs {
            project_id: project_id.clone(),
            name: None,
            update_parent: false,
            parent_id: None,
            share_permission: Some(team_share_request(Some(AccessLevel::Edit))),
            team_share: Some(command(&other_facts, Some(AccessLevel::Edit))),
        })
        .await;
    assert!(matches!(wrong_project, Err(ProjectError::BadRequest(_))));

    let wrong_level = repo
        .edit_project(EditProjectArgs {
            project_id: project_id.clone(),
            name: None,
            update_parent: false,
            parent_id: None,
            share_permission: Some(team_share_request(Some(AccessLevel::View))),
            team_share: Some(command(&facts, Some(AccessLevel::Edit))),
        })
        .await;
    assert!(matches!(wrong_level, Err(ProjectError::BadRequest(_))));

    assert_eq!(stored_team_share(&pool, &project_id).await, unshared());
    assert_eq!(
        stored_team_share(&pool, &other_project_id).await,
        unshared()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("users", "team"))
)]
async fn edit_stale_command_returns_conflict(pool: PgPool) {
    let repo = PgProjectRepo::new(pool.clone());
    let project_id = create_project(&repo, "Stale").await;
    let facts = repo.get_team_share_facts(&project_id).await.unwrap();
    let stale = command(&facts, Some(AccessLevel::Edit));

    edit_team_share(&repo, &project_id, Some(AccessLevel::Edit))
        .await
        .unwrap();

    let replay = repo
        .edit_project(EditProjectArgs {
            project_id: project_id.clone(),
            name: None,
            update_parent: false,
            parent_id: None,
            share_permission: Some(team_share_request(Some(AccessLevel::Edit))),
            team_share: Some(stale),
        })
        .await;

    assert!(matches!(replay, Err(ProjectError::Conflict(_))));
    assert_eq!(stored_team_share(&pool, &project_id).await.revision, 1);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("users", "team"))
)]
async fn edit_team_share_and_link_share_in_one_call_persists_both(pool: PgPool) {
    let repo = PgProjectRepo::new(pool.clone());
    let project_id = create_project(&repo, "Both").await;
    let facts = repo.get_team_share_facts(&project_id).await.unwrap();

    repo.edit_project(EditProjectArgs {
        project_id: project_id.clone(),
        name: Some("Renamed".to_string()),
        update_parent: false,
        parent_id: None,
        share_permission: Some(UpdateSharePermissionRequestV2 {
            link_share: Some(Some(LinkShare::Team)),
            link_share_access_level: Some(Some(AccessLevel::Comment)),
            team_share_access_level: Some(Some(AccessLevel::Edit)),
            channel_share_permissions: None,
        }),
        team_share: Some(command(&facts, Some(AccessLevel::Edit))),
    })
    .await
    .unwrap();

    let permission = repo
        .get_project_share_permission(&project_id)
        .await
        .unwrap();
    assert_eq!(permission.link_share, Some(LinkShare::Team));
    assert_eq!(
        permission.link_share_access_level,
        Some(AccessLevel::Comment)
    );
    assert_eq!(permission.team_share_access_level, Some(AccessLevel::Edit));
    assert_eq!(
        repo.get_project_by_id(&project_id)
            .await
            .unwrap()
            .unwrap()
            .name,
        "Renamed"
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../fixtures", scripts("users", "team"))
)]
async fn get_project_share_permission_reads_team_share_access_level(pool: PgPool) {
    let repo = PgProjectRepo::new(pool.clone());
    let project_id = create_project(&repo, "Read").await;
    assert_eq!(
        repo.get_project_share_permission(&project_id)
            .await
            .unwrap()
            .team_share_access_level,
        None
    );

    edit_team_share(&repo, &project_id, Some(AccessLevel::Comment))
        .await
        .unwrap();

    assert_eq!(
        repo.get_project_share_permission(&project_id)
            .await
            .unwrap()
            .team_share_access_level,
        Some(AccessLevel::Comment)
    );
}
