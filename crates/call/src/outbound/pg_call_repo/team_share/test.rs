//! Canonical team sharing for calls: creation, edits, archive, and reads.

use std::ops::Deref;

use entity_access_db_utils::team_share::direct_level;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use model_entity::EntityType;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::team_share::{
    AuthorizedTeamShareCommand, TeamShareFacts, TeamShareLevel, TeamShareRequest,
    authorize_team_share,
};
use models_permissions::share_permission::{LinkShare, UpdateSharePermissionRequestV2};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use super::super::test::{
    CALL_ARCHIVED, CALL1, CH1, CH2, USER_A, USER_B, give_user_a_team, repo,
    team_entity_access_count,
};
use crate::domain::models::{CallError, EditCallRecordRepoArgs};
use crate::domain::ports::CallRepository;
use crate::outbound::pg_call_repo::PgCallRepo;

const TEAM_ID: Uuid = Uuid::from_u128(0x7ea3_0000_0000_0000_0000_0000_0000_0001);

fn level_request(level: Option<AccessLevel>) -> UpdateSharePermissionRequestV2 {
    UpdateSharePermissionRequestV2 {
        link_share: None,
        link_share_access_level: None,
        team_share_access_level: Some(level),
        channel_share_permissions: None,
    }
}

fn args(
    share_permission: Option<UpdateSharePermissionRequestV2>,
    team_share: Option<AuthorizedTeamShareCommand>,
) -> EditCallRecordRepoArgs {
    EditCallRecordRepoArgs {
        share_permission,
        custom_name: None,
        team_share,
    }
}

/// Authorize `level` exactly as the domain service would for the persisted creator.
fn command(facts: &TeamShareFacts, level: Option<AccessLevel>) -> AuthorizedTeamShareCommand {
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

/// Authorize the deprecated `shareWithTeam` alias as the domain service would.
fn legacy_command(facts: &TeamShareFacts, enabled: bool) -> AuthorizedTeamShareCommand {
    authorize_team_share(
        Some(&facts.owner),
        facts,
        TeamShareRequest {
            access_level: None,
            legacy_enabled: Some(enabled),
        },
        TeamShareLevel::View,
    )
    .unwrap()
    .unwrap()
}

async fn set_team_share(
    repo: &PgCallRepo,
    call_id: Uuid,
    level: Option<AccessLevel>,
) -> Result<(), CallError> {
    let facts = repo.get_team_share_facts(&call_id).await?;
    repo.patch_call_record(
        &call_id,
        &args(Some(level_request(level)), Some(command(&facts, level))),
    )
    .await
}

#[derive(Debug, PartialEq, Eq)]
struct StoredTeamShare {
    level: Option<String>,
    team_id: Option<Uuid>,
    revision: i64,
}

async fn stored_team_share(pool: &Pool<Postgres>, call_id: Uuid) -> StoredTeamShare {
    let row = sqlx::query!(
        r#"
        SELECT
            sp.team_share_access_level::text AS "level?",
            sp.team_share_team_id AS "team_id?",
            sp.team_share_revision AS revision
        FROM "SharePermission" sp
        WHERE sp.id = (
            SELECT share_permission_id FROM calls WHERE id = $1
            UNION ALL
            SELECT share_permission_id FROM call_records WHERE id = $1
            LIMIT 1
        )
        "#,
        call_id,
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

fn unshared() -> StoredTeamShare {
    StoredTeamShare {
        level: None,
        team_id: None,
        revision: 0,
    }
}

fn shared_view(revision: i64) -> StoredTeamShare {
    StoredTeamShare {
        level: Some("view".to_string()),
        team_id: Some(TEAM_ID),
        revision,
    }
}

async fn team_row_level(pool: &Pool<Postgres>, call_id: Uuid) -> Option<AccessLevel> {
    let mut connection = pool.acquire().await.unwrap();
    direct_level(&mut connection, &call_id, EntityType::Call, TEAM_ID)
        .await
        .unwrap()
}

async fn permission_count(pool: &Pool<Postgres>) -> i64 {
    sqlx::query_scalar!(r#"SELECT COUNT(*) AS "count!" FROM "SharePermission""#)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn stored_custom_name(pool: &Pool<Postgres>, call_id: Uuid) -> Option<String> {
    sqlx::query_scalar!(
        r#"SELECT custom_name FROM call_records WHERE id = $1"#,
        call_id
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn insert_legacy_team_row(
    pool: &Pool<Postgres>,
    call_id: Uuid,
    level: AccessLevel,
) -> anyhow::Result<()> {
    let mut tx = pool.begin().await?;
    entity_access_db_utils::insert_entity_access_row(
        &mut tx,
        &call_id,
        EntityType::Call,
        &TEAM_ID.to_string(),
        entity_access_db_utils::EntityAccessSourceType::Team,
        level,
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

// -- facts --------------------------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn get_team_share_facts_reads_creator_team_and_null_state(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    give_user_a_team(&pool, USER_A.as_ref(), &TEAM_ID).await?;

    for call_id in [CALL1, CALL_ARCHIVED] {
        let facts = repo.get_team_share_facts(&call_id).await?;
        assert_eq!(
            facts.entity,
            EntityType::Call.with_entity_string(call_id.to_string())
        );
        assert_eq!(facts.owner.as_ref(), USER_A.as_ref());
        assert_eq!(facts.owner_team_id, Some(TEAM_ID));
        assert_eq!(facts.current, None);
        assert_eq!(facts.revision, 0);
    }

    assert!(matches!(
        repo.get_team_share_facts(&Uuid::now_v7()).await,
        Err(CallError::NotFound(_))
    ));
    Ok(())
}

// -- create_call --------------------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn create_call_initializes_view_for_creator_team(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    give_user_a_team(&pool, USER_A.as_ref(), &TEAM_ID).await?;
    let id = Uuid::now_v7();

    repo.create_call(&id, &CH2, "room-ch2", USER_A.copied())
        .await?
        .expect("call created");

    assert_eq!(stored_team_share(&pool, id).await, shared_view(1));
    assert_eq!(team_row_level(&pool, id).await, Some(AccessLevel::View));
    let record = repo.get_call_record_by_call_id(&id).await?.unwrap();
    assert_eq!(record.team_share_access_level, Some(AccessLevel::View));
    assert!(record.share_with_team);
    // The legacy column is written FALSE so an older archive_call never
    // re-inserts the grant created here.
    let legacy_flag = sqlx::query_scalar!(r#"SELECT share_with_team FROM calls WHERE id = $1"#, id)
        .fetch_one(&pool)
        .await?;
    assert!(!legacy_flag);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn create_call_without_team_starts_unshared(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let id = Uuid::now_v7();

    repo.create_call(&id, &CH2, "room-ch2", USER_B.deref().copied())
        .await?
        .expect("call created");

    assert_eq!(stored_team_share(&pool, id).await, unshared());
    assert_eq!(team_entity_access_count(&pool, id).await?, 0);
    let record = repo.get_call_record_by_call_id(&id).await?.unwrap();
    assert_eq!(record.team_share_access_level, None);
    assert!(!record.share_with_team);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn create_call_lost_race_leaves_no_permission_or_grant_rows(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    give_user_a_team(&pool, USER_A.as_ref(), &TEAM_ID).await?;
    let permissions_before = permission_count(&pool).await;
    let existing = stored_team_share(&pool, CALL1).await;
    let id = Uuid::now_v7();

    // CH1 already has an active call (the fixture's CALL1).
    let created = repo
        .create_call(&id, &CH1, "room-dup", USER_A.copied())
        .await?;

    assert!(created.is_none());
    assert_eq!(permission_count(&pool).await, permissions_before);
    assert_eq!(stored_team_share(&pool, CALL1).await, existing);
    let grants = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM entity_access WHERE entity_id = $1"#,
        id
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(grants, 0);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn create_call_conflicts_with_untracked_team_grant_and_rolls_back(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    give_user_a_team(&pool, USER_A.as_ref(), &TEAM_ID).await?;
    let id = Uuid::now_v7();
    insert_legacy_team_row(&pool, id, AccessLevel::Edit).await?;
    let permissions_before = permission_count(&pool).await;

    let result = repo
        .create_call(&id, &CH2, "conflict", USER_A.copied())
        .await;

    assert!(matches!(result, Err(CallError::Conflict(_))));
    assert!(repo.get_call_record_by_call_id(&id).await?.is_none());
    assert_eq!(permission_count(&pool).await, permissions_before);
    // The unexplained grant is left for review, not adopted or overwritten.
    assert_eq!(team_row_level(&pool, id).await, Some(AccessLevel::Edit));
    Ok(())
}

// -- patch_call_record --------------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_applies_view_command_on_active_and_archived_calls(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    give_user_a_team(&pool, USER_A.as_ref(), &TEAM_ID).await?;

    for call_id in [CALL1, CALL_ARCHIVED] {
        set_team_share(&repo, call_id, Some(AccessLevel::View)).await?;
        assert_eq!(stored_team_share(&pool, call_id).await, shared_view(1));
        assert_eq!(
            team_row_level(&pool, call_id).await,
            Some(AccessLevel::View)
        );
        let record = repo.get_call_record_by_call_id(&call_id).await?.unwrap();
        assert_eq!(record.team_share_access_level, Some(AccessLevel::View));
        assert!(record.share_with_team);

        // Re-selecting the same level is a supplied operation: it advances the
        // revision without adding a second grant.
        set_team_share(&repo, call_id, Some(AccessLevel::View)).await?;
        assert_eq!(stored_team_share(&pool, call_id).await, shared_view(2));
        assert_eq!(team_entity_access_count(&pool, call_id).await?, 1);
    }
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_clear_removes_team_row_and_bumps_revision(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    give_user_a_team(&pool, USER_A.as_ref(), &TEAM_ID).await?;
    set_team_share(&repo, CALL_ARCHIVED, Some(AccessLevel::View)).await?;

    set_team_share(&repo, CALL_ARCHIVED, None).await?;

    assert_eq!(
        stored_team_share(&pool, CALL_ARCHIVED).await,
        StoredTeamShare {
            level: None,
            team_id: None,
            revision: 2,
        }
    );
    assert_eq!(team_entity_access_count(&pool, CALL_ARCHIVED).await?, 0);
    let record = repo
        .get_call_record_by_call_id(&CALL_ARCHIVED)
        .await?
        .unwrap();
    assert_eq!(record.team_share_access_level, None);
    assert!(!record.share_with_team);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_legacy_alias_command_enables_view_and_clears(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    give_user_a_team(&pool, USER_A.as_ref(), &TEAM_ID).await?;

    // `shareWithTeam: true` carries no level in the share-permission patch.
    let facts = repo.get_team_share_facts(&CALL1).await?;
    repo.patch_call_record(&CALL1, &args(None, Some(legacy_command(&facts, true))))
        .await?;
    assert_eq!(stored_team_share(&pool, CALL1).await, shared_view(1));
    assert_eq!(team_row_level(&pool, CALL1).await, Some(AccessLevel::View));

    let facts = repo.get_team_share_facts(&CALL1).await?;
    repo.patch_call_record(&CALL1, &args(None, Some(legacy_command(&facts, false))))
        .await?;
    assert_eq!(stored_team_share(&pool, CALL1).await.revision, 2);
    assert_eq!(team_entity_access_count(&pool, CALL1).await?, 0);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_with_team_level_but_no_command_is_forbidden_and_rolls_back(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    give_user_a_team(&pool, USER_A.as_ref(), &TEAM_ID).await?;

    let result = repo
        .patch_call_record(
            &CALL_ARCHIVED,
            &EditCallRecordRepoArgs {
                share_permission: Some(level_request(Some(AccessLevel::View))),
                custom_name: Some("must not persist".to_string()),
                team_share: None,
            },
        )
        .await;

    assert!(matches!(result, Err(CallError::Forbidden(_))));
    assert_eq!(stored_team_share(&pool, CALL_ARCHIVED).await, unshared());
    assert_eq!(team_entity_access_count(&pool, CALL_ARCHIVED).await?, 0);
    // The whole patch is rolled back, not just the team share.
    assert_eq!(stored_custom_name(&pool, CALL_ARCHIVED).await, None);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_rejects_command_for_other_call_or_mismatched_level(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    give_user_a_team(&pool, USER_A.as_ref(), &TEAM_ID).await?;
    let facts = repo.get_team_share_facts(&CALL_ARCHIVED).await?;
    let other_facts = repo.get_team_share_facts(&CALL1).await?;

    let wrong_call = repo
        .patch_call_record(
            &CALL_ARCHIVED,
            &args(
                Some(level_request(Some(AccessLevel::View))),
                Some(command(&other_facts, Some(AccessLevel::View))),
            ),
        )
        .await;
    assert!(matches!(wrong_call, Err(CallError::InvalidRequest(_))));

    // The patch asks to clear while the command grants View.
    let wrong_level = repo
        .patch_call_record(
            &CALL_ARCHIVED,
            &args(
                Some(level_request(None)),
                Some(command(&facts, Some(AccessLevel::View))),
            ),
        )
        .await;
    assert!(matches!(wrong_level, Err(CallError::InvalidRequest(_))));

    assert_eq!(stored_team_share(&pool, CALL_ARCHIVED).await, unshared());
    assert_eq!(stored_team_share(&pool, CALL1).await, unshared());
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_stale_command_returns_conflict(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    give_user_a_team(&pool, USER_A.as_ref(), &TEAM_ID).await?;
    let facts = repo.get_team_share_facts(&CALL_ARCHIVED).await?;
    let stale = command(&facts, Some(AccessLevel::View));

    set_team_share(&repo, CALL_ARCHIVED, Some(AccessLevel::View)).await?;

    let replay = repo
        .patch_call_record(
            &CALL_ARCHIVED,
            &args(Some(level_request(Some(AccessLevel::View))), Some(stale)),
        )
        .await;

    assert!(matches!(replay, Err(CallError::Conflict(_))));
    assert_eq!(
        stored_team_share(&pool, CALL_ARCHIVED).await,
        shared_view(1)
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_untracked_legacy_team_row_returns_conflict_without_partial_writes(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    give_user_a_team(&pool, USER_A.as_ref(), &TEAM_ID).await?;
    // A pre-canonical grant (what the seed tool and the old archive wrote)
    // that the backfill migration did not reconcile.
    insert_legacy_team_row(&pool, CALL_ARCHIVED, AccessLevel::View).await?;
    let facts = repo.get_team_share_facts(&CALL_ARCHIVED).await?;
    assert_eq!(facts.current, None);

    let result = repo
        .patch_call_record(
            &CALL_ARCHIVED,
            &EditCallRecordRepoArgs {
                share_permission: Some(level_request(Some(AccessLevel::View))),
                custom_name: Some("must not persist".to_string()),
                team_share: Some(command(&facts, Some(AccessLevel::View))),
            },
        )
        .await;

    assert!(matches!(result, Err(CallError::Conflict(_))));
    assert_eq!(stored_team_share(&pool, CALL_ARCHIVED).await, unshared());
    assert_eq!(stored_custom_name(&pool, CALL_ARCHIVED).await, None);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_team_share_link_share_and_name_in_one_call_persist_together(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    give_user_a_team(&pool, USER_A.as_ref(), &TEAM_ID).await?;
    let facts = repo.get_team_share_facts(&CALL_ARCHIVED).await?;

    repo.patch_call_record(
        &CALL_ARCHIVED,
        &EditCallRecordRepoArgs {
            share_permission: Some(UpdateSharePermissionRequestV2 {
                link_share: Some(Some(LinkShare::Public)),
                link_share_access_level: None,
                team_share_access_level: Some(Some(AccessLevel::View)),
                channel_share_permissions: None,
            }),
            custom_name: Some("Q4 sync".to_string()),
            team_share: Some(command(&facts, Some(AccessLevel::View))),
        },
    )
    .await?;

    assert_eq!(
        stored_team_share(&pool, CALL_ARCHIVED).await,
        shared_view(1)
    );
    let link_share = sqlx::query_scalar!(
        r#"
        SELECT sp."linkShare" AS "link_share?"
        FROM "SharePermission" sp
        JOIN call_records cr ON cr.share_permission_id = sp.id
        WHERE cr.id = $1
        "#,
        CALL_ARCHIVED,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(link_share.as_deref(), Some("PUBLIC"));
    assert_eq!(
        stored_custom_name(&pool, CALL_ARCHIVED).await.as_deref(),
        Some("Q4 sync")
    );
    Ok(())
}

// -- archive_call -------------------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn archive_preserves_canonical_team_share(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    give_user_a_team(&pool, USER_A.as_ref(), &TEAM_ID).await?;
    let id = Uuid::now_v7();
    repo.create_call(&id, &CH2, "room-ch2", USER_A.copied())
        .await?
        .expect("call created");
    let before = repo.get_team_share_facts(&id).await?;

    repo.archive_call(&id).await?;

    assert_eq!(repo.get_team_share_facts(&id).await?, before);
    assert_eq!(stored_team_share(&pool, id).await, shared_view(1));
    assert_eq!(team_entity_access_count(&pool, id).await?, 1);
    let record = repo.get_call_record_by_call_id(&id).await?.unwrap();
    assert!(!record.is_active);
    assert_eq!(record.team_share_access_level, Some(AccessLevel::View));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn archive_never_reconstructs_sharing_from_membership(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    give_user_a_team(&pool, USER_A.as_ref(), &TEAM_ID).await?;

    // Cleared during the call stays cleared afterwards.
    let cleared = Uuid::now_v7();
    repo.create_call(&cleared, &CH2, "cleared", USER_A.copied())
        .await?
        .expect("call created");
    set_team_share(&repo, cleared, None).await?;
    repo.archive_call(&cleared).await?;
    assert_eq!(stored_team_share(&pool, cleared).await.level, None);
    assert_eq!(stored_team_share(&pool, cleared).await.revision, 2);
    assert_eq!(team_entity_access_count(&pool, cleared).await?, 0);

    // The fixture's active call predates canonical state and its creator now
    // has a team; archiving must not invent a grant.
    repo.archive_call(&CALL1).await?;
    assert_eq!(stored_team_share(&pool, CALL1).await, unshared());
    assert_eq!(team_entity_access_count(&pool, CALL1).await?, 0);
    assert!(
        !repo
            .get_call_record_by_call_id(&CALL1)
            .await?
            .unwrap()
            .share_with_team
    );
    Ok(())
}

// -- reads --------------------------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn list_read_returns_team_share_access_level(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    give_user_a_team(&pool, USER_A.as_ref(), &TEAM_ID).await?;
    set_team_share(&repo, CALL1, Some(AccessLevel::View)).await?;

    let records = repo
        .get_call_records_by_user(USER_A.deref().copied(), 10, &None)
        .await?;

    let active = records
        .iter()
        .find(|record| record.call_id == CALL1)
        .expect("active call listed");
    assert_eq!(active.team_share_access_level, Some(AccessLevel::View));
    assert!(active.share_with_team);

    let archived = records
        .iter()
        .find(|record| record.call_id == CALL_ARCHIVED)
        .expect("archived call listed");
    assert_eq!(archived.team_share_access_level, None);
    assert!(!archived.share_with_team);
    Ok(())
}
