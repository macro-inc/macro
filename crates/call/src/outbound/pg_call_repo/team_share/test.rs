//! Team sharing for calls: the live toggle, its translation into canonical
//! state at archive, creator edits on archived records, and reads.

use std::ops::Deref;

use entity_access_db_utils::team_share::direct_level;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::cowlike::CowLike;
use model_entity::EntityType;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::team_share::{
    AuthorizedTeamShareCommand, TeamShareFacts, TeamShareGrant, TeamShareLevel, TeamShareRequest,
    authorize_team_share,
};
use models_permissions::share_permission::{LinkShare, UpdateSharePermissionRequestV2};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use super::super::test::{
    CALL_ARCHIVED, CALL1, CH1, CH2, USER_A, give_user_a_team, repo, team_entity_access_count,
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
        live_share_with_team: None,
    }
}

fn live_args(share: bool, custom_name: Option<&str>) -> EditCallRecordRepoArgs {
    EditCallRecordRepoArgs {
        share_permission: None,
        custom_name: custom_name.map(str::to_string),
        team_share: None,
        live_share_with_team: Some(share),
    }
}

/// Authorize `level` exactly as the domain service would for the persisted creator.
fn command(facts: &TeamShareFacts, level: Option<AccessLevel>) -> AuthorizedTeamShareCommand {
    authorize_team_share(
        facts.owner.as_user(),
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
        facts.owner.as_user(),
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

async fn live_toggle(pool: &Pool<Postgres>, call_id: Uuid) -> bool {
    sqlx::query_scalar!(
        r#"SELECT share_with_team FROM calls WHERE id = $1"#,
        call_id
    )
    .fetch_one(pool)
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

/// What the previous archive code and `shareWithTeam` edits wrote: a direct
/// team grant with no canonical state behind it.
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
        assert!(facts.owner.is_user(&USER_A));
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

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn get_team_share_facts_adopts_legacy_view_grant_but_not_other_levels(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    give_user_a_team(&pool, USER_A.as_ref(), &TEAM_ID).await?;
    insert_legacy_team_row(&pool, CALL_ARCHIVED, AccessLevel::View).await?;
    insert_legacy_team_row(&pool, CALL1, AccessLevel::Edit).await?;

    // A View grant for the creator's team becomes explicit consent.
    let adopted = repo.get_team_share_facts(&CALL_ARCHIVED).await?;
    assert_eq!(
        adopted.current,
        Some(TeamShareGrant {
            team_id: TEAM_ID,
            level: TeamShareLevel::View,
        })
    );
    assert_eq!(adopted.revision, 1);
    assert_eq!(
        stored_team_share(&pool, CALL_ARCHIVED).await,
        shared_view(1)
    );
    assert_eq!(team_entity_access_count(&pool, CALL_ARCHIVED).await?, 1);

    // Calls only share at View: any other level stays untracked.
    let untouched = repo.get_team_share_facts(&CALL1).await?;
    assert_eq!(untouched.current, None);
    assert_eq!(untouched.revision, 0);
    assert_eq!(team_row_level(&pool, CALL1).await, Some(AccessLevel::Edit));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn get_team_share_facts_adopts_legacy_view_grant_after_canonical_clear(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    give_user_a_team(&pool, USER_A.as_ref(), &TEAM_ID).await?;

    // Canonical clear leaves NULL/rev 2. An old writer then inserts the View
    // grant without touching SharePermission. Adopt that row so the creator
    // can revoke it instead of hitting UntrackedGrant forever.
    sqlx::query!(
        r#"
        UPDATE "SharePermission"
        SET team_share_access_level = NULL,
            team_share_team_id = NULL,
            team_share_revision = 2
        WHERE id = (SELECT share_permission_id FROM call_records WHERE id = $1)
        "#,
        CALL_ARCHIVED,
    )
    .execute(&pool)
    .await?;
    insert_legacy_team_row(&pool, CALL_ARCHIVED, AccessLevel::View).await?;

    let adopted = repo.get_team_share_facts(&CALL_ARCHIVED).await?;
    assert_eq!(
        adopted.current,
        Some(TeamShareGrant {
            team_id: TEAM_ID,
            level: TeamShareLevel::View,
        })
    );
    assert_eq!(adopted.revision, 3);
    assert_eq!(
        stored_team_share(&pool, CALL_ARCHIVED).await,
        shared_view(3)
    );
    assert_eq!(team_entity_access_count(&pool, CALL_ARCHIVED).await?, 1);

    set_team_share(&repo, CALL_ARCHIVED, None).await?;
    assert_eq!(
        stored_team_share(&pool, CALL_ARCHIVED).await,
        StoredTeamShare {
            level: None,
            team_id: None,
            revision: 4,
        }
    );
    assert_eq!(team_entity_access_count(&pool, CALL_ARCHIVED).await?, 0);
    Ok(())
}

// -- create_call --------------------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn create_call_starts_with_toggle_on_and_no_canonical_state(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    give_user_a_team(&pool, USER_A.as_ref(), &TEAM_ID).await?;
    let id = Uuid::now_v7();

    repo.create_call(&id, &CH2, "room-ch2", USER_A.copied())
        .await?
        .expect("call created");

    // The pending toggle defaults to on; nothing is granted until archive.
    assert!(live_toggle(&pool, id).await);
    assert_eq!(stored_team_share(&pool, id).await, unshared());
    assert_eq!(team_entity_access_count(&pool, id).await?, 0);
    let record = repo.get_call_record_by_call_id(&id).await?.unwrap();
    assert!(record.share_with_team);
    assert_eq!(record.team_share_access_level, None);
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
    let permissions_before = permission_count(&pool).await;
    let id = Uuid::now_v7();

    // CH1 already has an active call (the fixture's CALL1).
    let created = repo
        .create_call(&id, &CH1, "room-dup", USER_A.copied())
        .await?;

    assert!(created.is_none());
    assert_eq!(permission_count(&pool).await, permissions_before);
    let grants = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM entity_access WHERE entity_id = $1"#,
        id
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(grants, 0);
    Ok(())
}

// -- the live toggle ----------------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn toggle_share_with_team_flips_live_call_and_conflicts_once_archived(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());

    assert_eq!(repo.toggle_share_with_team(&CALL1).await?, (false, CH1));
    assert!(!live_toggle(&pool, CALL1).await);
    assert!(
        !repo
            .get_call_record_by_call_id(&CALL1)
            .await?
            .unwrap()
            .share_with_team
    );

    assert_eq!(repo.toggle_share_with_team(&CALL1).await?, (true, CH1));
    assert!(live_toggle(&pool, CALL1).await);
    // Flipping the toggle never touches canonical state or grants.
    assert_eq!(stored_team_share(&pool, CALL1).await, unshared());
    assert_eq!(team_entity_access_count(&pool, CALL1).await?, 0);

    assert!(matches!(
        repo.toggle_share_with_team(&CALL_ARCHIVED).await,
        Err(CallError::Conflict(_))
    ));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_live_share_with_team_sets_toggle_and_conflicts_once_archived(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());

    repo.patch_call_record(&CALL1, &live_args(false, None))
        .await?;
    assert!(!live_toggle(&pool, CALL1).await);
    assert_eq!(stored_team_share(&pool, CALL1).await, unshared());

    repo.patch_call_record(&CALL1, &live_args(true, None))
        .await?;
    assert!(live_toggle(&pool, CALL1).await);

    // The call was archived between the service's read and the write: the
    // whole patch rolls back and the caller retries through the canonical path.
    let result = repo
        .patch_call_record(&CALL_ARCHIVED, &live_args(true, Some("must not persist")))
        .await;
    assert!(matches!(result, Err(CallError::Conflict(_))));
    assert_eq!(stored_custom_name(&pool, CALL_ARCHIVED).await, None);
    assert_eq!(stored_team_share(&pool, CALL_ARCHIVED).await, unshared());
    Ok(())
}

// -- archive_call -------------------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn archive_translates_toggle_on_into_canonical_view(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    give_user_a_team(&pool, USER_A.as_ref(), &TEAM_ID).await?;
    assert!(live_toggle(&pool, CALL1).await);

    repo.archive_call(&CALL1).await?;

    assert_eq!(stored_team_share(&pool, CALL1).await, shared_view(1));
    assert_eq!(team_row_level(&pool, CALL1).await, Some(AccessLevel::View));
    assert_eq!(team_entity_access_count(&pool, CALL1).await?, 1);
    let record = repo.get_call_record_by_call_id(&CALL1).await?.unwrap();
    assert!(!record.is_active);
    assert_eq!(record.team_share_access_level, Some(AccessLevel::View));
    assert!(record.share_with_team);

    // The creator can now edit the canonical state the archive produced.
    set_team_share(&repo, CALL1, None).await?;
    assert_eq!(stored_team_share(&pool, CALL1).await.revision, 2);
    assert_eq!(team_entity_access_count(&pool, CALL1).await?, 0);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn archive_translates_toggle_off_into_unshared(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    give_user_a_team(&pool, USER_A.as_ref(), &TEAM_ID).await?;
    repo.toggle_share_with_team(&CALL1).await?;
    assert!(!live_toggle(&pool, CALL1).await);

    repo.archive_call(&CALL1).await?;

    assert_eq!(stored_team_share(&pool, CALL1).await, unshared());
    assert_eq!(team_entity_access_count(&pool, CALL1).await?, 0);
    let record = repo.get_call_record_by_call_id(&CALL1).await?.unwrap();
    assert_eq!(record.team_share_access_level, None);
    assert!(!record.share_with_team);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn archive_with_toggle_on_but_no_team_shares_nothing(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    assert!(live_toggle(&pool, CALL1).await);

    repo.archive_call(&CALL1).await?;

    assert_eq!(stored_team_share(&pool, CALL1).await, unshared());
    assert_eq!(team_entity_access_count(&pool, CALL1).await?, 0);
    // Once archived, the boolean mirrors canonical state, not the old toggle.
    let record = repo.get_call_record_by_call_id(&CALL1).await?.unwrap();
    assert!(!record.share_with_team);
    assert_eq!(record.team_share_access_level, None);

    // Joining a team afterwards does not reshare the archived record.
    give_user_a_team(&pool, USER_A.as_ref(), &TEAM_ID).await?;
    assert_eq!(repo.get_team_share_facts(&CALL1).await?.current, None);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn archive_adopts_legacy_view_grant_and_leaves_other_levels(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    give_user_a_team(&pool, USER_A.as_ref(), &TEAM_ID).await?;

    // An older archive (or `shareWithTeam` edit) already wrote the View row.
    let adopted = Uuid::now_v7();
    repo.create_call(&adopted, &CH2, "adopted", USER_A.copied())
        .await?
        .expect("call created");
    insert_legacy_team_row(&pool, adopted, AccessLevel::View).await?;
    repo.archive_call(&adopted).await?;
    assert_eq!(stored_team_share(&pool, adopted).await, shared_view(1));
    assert_eq!(team_entity_access_count(&pool, adopted).await?, 1);

    // A grant above View is left for review; the archive itself still succeeds.
    insert_legacy_team_row(&pool, CALL1, AccessLevel::Edit).await?;
    repo.archive_call(&CALL1).await?;
    assert_eq!(stored_team_share(&pool, CALL1).await, unshared());
    assert_eq!(team_row_level(&pool, CALL1).await, Some(AccessLevel::Edit));
    Ok(())
}

// -- creator edits on archived calls ------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_applies_view_command_on_archived_call(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    give_user_a_team(&pool, USER_A.as_ref(), &TEAM_ID).await?;

    set_team_share(&repo, CALL_ARCHIVED, Some(AccessLevel::View)).await?;
    assert_eq!(
        stored_team_share(&pool, CALL_ARCHIVED).await,
        shared_view(1)
    );
    assert_eq!(
        team_row_level(&pool, CALL_ARCHIVED).await,
        Some(AccessLevel::View)
    );
    let record = repo
        .get_call_record_by_call_id(&CALL_ARCHIVED)
        .await?
        .unwrap();
    assert_eq!(record.team_share_access_level, Some(AccessLevel::View));
    assert!(record.share_with_team);

    // Re-selecting the same level is a supplied operation: it advances the
    // revision without adding a second grant.
    set_team_share(&repo, CALL_ARCHIVED, Some(AccessLevel::View)).await?;
    assert_eq!(
        stored_team_share(&pool, CALL_ARCHIVED).await,
        shared_view(2)
    );
    assert_eq!(team_entity_access_count(&pool, CALL_ARCHIVED).await?, 1);
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
    let facts = repo.get_team_share_facts(&CALL_ARCHIVED).await?;
    repo.patch_call_record(
        &CALL_ARCHIVED,
        &args(None, Some(legacy_command(&facts, true))),
    )
    .await?;
    assert_eq!(
        stored_team_share(&pool, CALL_ARCHIVED).await,
        shared_view(1)
    );
    assert_eq!(
        team_row_level(&pool, CALL_ARCHIVED).await,
        Some(AccessLevel::View)
    );

    let facts = repo.get_team_share_facts(&CALL_ARCHIVED).await?;
    repo.patch_call_record(
        &CALL_ARCHIVED,
        &args(None, Some(legacy_command(&facts, false))),
    )
    .await?;
    assert_eq!(stored_team_share(&pool, CALL_ARCHIVED).await.revision, 2);
    assert_eq!(team_entity_access_count(&pool, CALL_ARCHIVED).await?, 0);
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
                live_share_with_team: None,
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
async fn patch_untracked_legacy_grant_returns_conflict_without_partial_writes(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    give_user_a_team(&pool, USER_A.as_ref(), &TEAM_ID).await?;
    // A grant above View is never adopted, so it stays an untracked conflict.
    insert_legacy_team_row(&pool, CALL_ARCHIVED, AccessLevel::Edit).await?;
    let facts = repo.get_team_share_facts(&CALL_ARCHIVED).await?;
    assert_eq!(facts.current, None);

    let result = repo
        .patch_call_record(
            &CALL_ARCHIVED,
            &EditCallRecordRepoArgs {
                share_permission: Some(level_request(Some(AccessLevel::View))),
                custom_name: Some("must not persist".to_string()),
                team_share: Some(command(&facts, Some(AccessLevel::View))),
                live_share_with_team: None,
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
            live_share_with_team: None,
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

// -- reads --------------------------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn list_read_reports_live_toggle_and_canonical_state(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    give_user_a_team(&pool, USER_A.as_ref(), &TEAM_ID).await?;
    repo.toggle_share_with_team(&CALL1).await?;
    set_team_share(&repo, CALL_ARCHIVED, Some(AccessLevel::View)).await?;

    let records = repo
        .get_call_records_by_user(USER_A.deref().copied(), 10, &None)
        .await?;

    // Live: the pending toggle (now off), no canonical level yet.
    let active = records
        .iter()
        .find(|record| record.call_id == CALL1)
        .expect("active call listed");
    assert!(!active.share_with_team);
    assert_eq!(active.team_share_access_level, None);

    // Archived: canonical state.
    let archived = records
        .iter()
        .find(|record| record.call_id == CALL_ARCHIVED)
        .expect("archived call listed");
    assert!(archived.share_with_team);
    assert_eq!(archived.team_share_access_level, Some(AccessLevel::View));

    Ok(())
}
