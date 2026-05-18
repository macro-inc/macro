use std::{ops::Deref, sync::Arc, sync::LazyLock};

use crate::domain::models::{
    AddParticipantError, CallRecordPreview, CustomSpeakerAssignment, EditCallRecordRequest,
    TranscriptSegmentRequest,
};
use crate::domain::ports::CallRepository;
use crate::outbound::pg_call_repo::PgCallRepo;
use chrono::{Duration, SubsecRound, Utc};
use filter_ast::Expr;
use item_filters::ast::{LiteralTree, call::CallLiteral};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::channel_share_permission::{
    UpdateChannelSharePermission, UpdateOperation,
};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

fn attended_filter(b: bool) -> LiteralTree<CallLiteral> {
    Some(Arc::new(Expr::Literal(CallLiteral::Attended(b))))
}

fn call_ids_filter(ids: &[Uuid]) -> LiteralTree<CallLiteral> {
    let mut iter = ids.iter().copied().map(CallLiteral::CallId);
    let first = iter.next()?;
    let expr = iter.fold(Expr::Literal(first), |acc, lit| {
        Expr::Or(Box::new(acc), Box::new(Expr::Literal(lit)))
    });
    Some(Arc::new(expr))
}

const CH1: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000c01);
const CH2: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000c02);
const CALL1: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_0000000ca110);
const CALL2: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_0000000ca220);
const CALL_ARCHIVED: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_0000000ca2ed);
const MACRO_USER_A: Uuid = Uuid::from_u128(0xaaaaaaaa_aaaa_aaaa_aaaa_aaaaaaaaaaa1);
const MACRO_USER_B: Uuid = Uuid::from_u128(0xbbbbbbbb_bbbb_bbbb_bbbb_bbbbbbbbbbb2);
const MACRO_USER_C: Uuid = Uuid::from_u128(0xcccccccc_cccc_cccc_cccc_ccccccccccc3);
static USER_A: LazyLock<MacroUserIdStr<'static>> =
    LazyLock::new(|| MacroUserIdStr::parse_from_str("macro|user-a@test.com").unwrap());
static USER_B: LazyLock<MacroUserIdStr<'static>> =
    LazyLock::new(|| MacroUserIdStr::parse_from_str("macro|user-b@test.com").unwrap());
static USER_C: LazyLock<MacroUserIdStr<'static>> =
    LazyLock::new(|| MacroUserIdStr::parse_from_str("macro|user-c@test.com").unwrap());

fn repo(pool: Pool<Postgres>) -> PgCallRepo {
    PgCallRepo::new(pool)
}

fn axis_unit_vector(axis: usize) -> Vec<f32> {
    let mut v = vec![0.0_f32; 256];
    v[axis] = 1.0;
    v
}

async fn insert_voice(pool: &Pool<Postgres>, voice_id: Uuid, axis: usize) -> anyhow::Result<()> {
    sqlx::query("INSERT INTO voice (id, embedding) VALUES ($1, $2)")
        .bind(voice_id)
        .bind(pgvector::Vector::from(axis_unit_vector(axis)))
        .execute(pool)
        .await?;
    Ok(())
}

async fn insert_user_mapping(
    pool: &Pool<Postgres>,
    user_id: &MacroUserIdStr<'_>,
    macro_user_id: Uuid,
) -> anyhow::Result<()> {
    sqlx::query(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO NOTHING
        "#,
    )
    .bind(macro_user_id)
    .bind(user_id.as_ref())
    .bind(user_id.email_str())
    .bind(format!("cus_{macro_user_id}"))
    .execute(pool)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO "User" (id, email, "stripeCustomerId", macro_user_id)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO UPDATE SET macro_user_id = EXCLUDED.macro_user_id
        "#,
    )
    .bind(user_id.as_ref())
    .bind(user_id.email_str())
    .bind(format!("cus_{macro_user_id}"))
    .bind(macro_user_id)
    .execute(pool)
    .await?;

    Ok(())
}

async fn insert_team_members(
    pool: &Pool<Postgres>,
    team_id: Uuid,
    owner_id: &str,
    member_ids: &[&str],
) -> anyhow::Result<()> {
    sqlx::query(r#"INSERT INTO team (id, name, owner_id) VALUES ($1, $2, $3)"#)
        .bind(team_id)
        .bind(format!("test team {team_id}"))
        .bind(owner_id)
        .execute(pool)
        .await?;

    for member_id in member_ids {
        sqlx::query(
            r#"INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, 'member')"#,
        )
        .bind(member_id)
        .bind(team_id)
        .execute(pool)
        .await?;
    }

    Ok(())
}

// -- create_call --------------------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn create_call_returns_call(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let id = Uuid::now_v7();
    let call = repo
        .create_call(&id, &CH2, "room-ch2", USER_B.deref().copied())
        .await?
        .expect("should create new call");

    assert_eq!(call.id, id);
    assert_eq!(call.channel_id, CH2);
    assert_eq!(call.room_name, "room-ch2");
    assert_eq!(call.created_by, USER_B.as_ref());
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn create_call_returns_none_on_duplicate_channel(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    // CH1 already has an active call from the fixture.
    let result = repo
        .create_call(&Uuid::now_v7(), &CH1, "room-dup", USER_A.deref().copied())
        .await?;

    assert!(result.is_none(), "should return None on conflict");
    Ok(())
}

// -- get_call_by_channel_id ---------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn get_call_by_channel_id_found(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let call = repo.get_call_by_channel_id(&CH1).await?;

    let call = call.expect("call should exist for ch1");
    assert_eq!(call.id, CALL1);
    assert_eq!(call.channel_id, CH1);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn get_call_by_channel_id_not_found(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let call = repo.get_call_by_channel_id(&CH2).await?;

    assert!(call.is_none(), "ch2 has no active call");
    Ok(())
}

// -- get_call_by_room_name ----------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn get_call_by_room_name_found(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let call = repo
        .get_call_by_room_name("00000000-0000-0000-0000-000000000c01")
        .await?;

    let call = call.expect("call should exist for room name");
    assert_eq!(call.id, CALL1);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn get_call_by_room_name_not_found(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let call = repo.get_call_by_room_name("nonexistent-room").await?;

    assert!(call.is_none());
    Ok(())
}

// -- add_participant / remove_participant / is_participant ---------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn add_and_check_participant(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);

    // user-c is not in the call yet.
    assert!(!repo.is_participant(&CALL1, &USER_C.as_ref()).await?);

    let participant = repo
        .add_participant(&CALL1, USER_C.deref().copied())
        .await?;
    assert_eq!(participant.call_id, CALL1);
    assert_eq!(participant.user_id, USER_C.as_ref());

    assert!(repo.is_participant(&CALL1, &USER_C.as_ref()).await?);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn remove_participant_removes_from_db(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);

    assert!(repo.is_participant(&CALL1, &USER_B.as_ref()).await?);
    repo.remove_participant(&CALL1, USER_B.deref().copied())
        .await?;
    assert!(!repo.is_participant(&CALL1, &USER_B.as_ref()).await?);
    Ok(())
}

// -- find_active_call_for_user ------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn find_active_call_for_user_returns_current_participation(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);

    // user-a is an active participant in call1 (ch1) per the fixture.
    let found = repo
        .find_active_call_for_user(USER_A.deref().copied())
        .await?;
    assert_eq!(found, Some((CALL1, CH1)));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn find_active_call_for_user_returns_none_when_never_joined(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);

    // user-c is a channel member but not a participant in any call.
    let found = repo
        .find_active_call_for_user(USER_C.deref().copied())
        .await?;
    assert!(found.is_none());
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn find_active_call_for_user_returns_none_after_leave(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);

    repo.remove_participant(&CALL1, USER_B.deref().copied())
        .await?;

    let found = repo
        .find_active_call_for_user(USER_B.deref().copied())
        .await?;
    assert!(found.is_none());
    Ok(())
}

// -- one-active-call-per-user invariant ---------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn add_participant_rejects_user_already_active_in_other_call(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);

    // Seed a second active call in ch2 (the fixture leaves ch2 empty).
    repo.create_call(&CALL2, &CH2, "room-ch2", USER_C.deref().copied())
        .await?
        .expect("should create call2 in ch2");

    // user-a is already active in call1 (ch1) per the fixture. Trying to
    // add them to call2 (ch2) must hit the partial unique index and surface
    // as AddParticipantError::UserAlreadyActive.
    let err = repo
        .add_participant(&CALL2, USER_A.deref().copied())
        .await
        .expect_err("should reject user already active elsewhere");

    assert!(
        matches!(err, AddParticipantError::UserAlreadyActive),
        "expected UserAlreadyActive, got {err:?}"
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn add_participant_same_call_rejoin_is_idempotent(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);

    // user-a is already active in call1. Re-adding to the same call must
    // succeed (upsert no-op) — the partial unique index only rejects when
    // the active row would be in a *different* call.
    let participant = repo
        .add_participant(&CALL1, USER_A.deref().copied())
        .await?;
    assert_eq!(participant.call_id, CALL1);
    assert_eq!(participant.user_id, USER_A.as_ref());
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn add_participant_allows_join_other_call_after_leave(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);

    repo.create_call(&CALL2, &CH2, "room-ch2", USER_C.deref().copied())
        .await?
        .expect("should create call2 in ch2");

    // user-a leaves call1, freeing them up to join call2.
    repo.remove_participant(&CALL1, USER_A.deref().copied())
        .await?;

    let participant = repo
        .add_participant(&CALL2, USER_A.deref().copied())
        .await?;
    assert_eq!(participant.call_id, CALL2);
    assert_eq!(participant.user_id, USER_A.as_ref());
    Ok(())
}

// -- get_participants ---------------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn get_participants_returns_all(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let participants = repo.get_participants(&CALL1).await?;

    assert_eq!(participants.len(), 2);
    let user_ids: Vec<&str> = participants.iter().map(|p| p.user_id.as_str()).collect();
    assert!(user_ids.contains(&USER_A.as_ref()));
    assert!(user_ids.contains(&USER_B.as_ref()));
    Ok(())
}

// -- get_participant_count ----------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn get_participant_count_correct(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);

    assert_eq!(repo.get_participant_count(&CALL1).await?, 2);

    repo.remove_participant(&CALL1, USER_B.deref().copied())
        .await?;
    assert_eq!(repo.get_participant_count(&CALL1).await?, 1);
    Ok(())
}

// -- delete_call --------------------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn delete_call_cascades_to_participants(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool.clone());

    repo.delete_call(&CALL1).await?;

    assert!(repo.get_call_by_channel_id(&CH1).await?.is_none());
    // Participants should be cascade-deleted.
    assert_eq!(repo.get_participant_count(&CALL1).await?, 0);
    // entity_access grants for the call must be cleaned up atomically.
    let remaining_grants: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM entity_access WHERE entity_id = $1 AND entity_type = 'call'"#,
        CALL1,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(remaining_grants, 0);
    Ok(())
}

// -- archive_call -------------------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn archive_call_creates_record_and_deletes_ephemeral(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());

    let record_id = repo.archive_call(&CALL1).await?;

    // Ephemeral call should be gone.
    assert!(repo.get_call_by_channel_id(&CH1).await?.is_none());
    assert_eq!(repo.get_participant_count(&CALL1).await?, 0);

    // call_records should have the archived call.
    let record = sqlx::query!(
        r#"
        SELECT id, channel_id, room_name, created_by, started_at, ended_at, duration_ms
        FROM call_records
        WHERE id = $1
        "#,
        record_id,
    )
    .fetch_one(&pool)
    .await?;

    assert_eq!(record.channel_id, CH1);
    assert_eq!(record.created_by, USER_A.as_ref());
    assert!(record.duration_ms >= 0);
    assert!(record.ended_at >= record.started_at);

    // call_record_participants should have both participants.
    let participants = sqlx::query_scalar!(
        r#"
        SELECT user_id
        FROM call_record_participants
        WHERE call_record_id = $1
        ORDER BY joined_at ASC
        "#,
        record_id,
    )
    .fetch_all(&pool)
    .await?;

    assert_eq!(participants.len(), 2);
    assert!(participants.contains(&USER_A.to_string()));
    assert!(participants.contains(&USER_B.to_string()));
    Ok(())
}

// -- archive preserves soft-deleted participants ------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn archive_call_preserves_soft_deleted_participants(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());

    // Soft-delete both participants (simulates leave_or_end_call flow).
    repo.remove_participant(&CALL1, USER_A.deref().copied())
        .await?;
    repo.remove_participant(&CALL1, USER_B.deref().copied())
        .await?;

    // Active count should be 0 but rows still exist.
    assert_eq!(repo.get_participant_count(&CALL1).await?, 0);

    // Archive the call.
    let record_id = repo.archive_call(&CALL1).await?;

    // call_record_participants should have both participants with left_at set.
    let rows = sqlx::query!(
        r#"
        SELECT user_id, left_at
        FROM call_record_participants
        WHERE call_record_id = $1
        ORDER BY joined_at ASC
        "#,
        record_id,
    )
    .fetch_all(&pool)
    .await?;

    assert_eq!(rows.len(), 2);
    let user_ids: Vec<&str> = rows.iter().map(|r| r.user_id.as_str()).collect();
    assert!(user_ids.contains(&USER_A.as_ref()));
    assert!(user_ids.contains(&USER_B.as_ref()));
    // Both should have left_at set since they were soft-deleted.
    assert!(rows.iter().all(|r| r.left_at.is_some()));

    Ok(())
}

/// Test helper: give `user_id` a brand new team owned by that user. Inserts
/// the parent `macro_user` and `User` rows that the `team_user` FK requires.
async fn give_user_a_team(
    pool: &Pool<Postgres>,
    user_id: &str,
    team_id: &Uuid,
) -> anyhow::Result<()> {
    let macro_user_id = Uuid::now_v7();

    sqlx::query(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $3, '')"#,
    )
    .bind(macro_user_id)
    .bind(user_id)
    .bind(format!("{user_id}@test.com"))
    .execute(pool)
    .await?;

    sqlx::query(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#)
        .bind(user_id)
        .bind(format!("{user_id}@test.com"))
        .bind(macro_user_id)
        .execute(pool)
        .await?;

    sqlx::query(r#"INSERT INTO team (id, name, owner_id) VALUES ($1, $2, $3)"#)
        .bind(team_id)
        .bind("test team")
        .bind(user_id)
        .execute(pool)
        .await?;

    sqlx::query(r#"INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, 'owner')"#)
        .bind(user_id)
        .bind(team_id)
        .execute(pool)
        .await?;

    Ok(())
}

// -- archive_call grants team view access when share_with_team is true -------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn archive_call_grants_team_view_access_when_share_with_team_true(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    use sqlx::Row as _;

    let repo = repo(pool.clone());
    let team_id: Uuid = Uuid::from_u128(0xaaaaaaaa_aaaa_aaaa_aaaa_aaaaaaaaaaaa);

    give_user_a_team(&pool, USER_A.as_ref(), &team_id).await?;

    // share_with_team defaults to TRUE on the fixture call.
    repo.archive_call(&CALL1).await?;

    let row = sqlx::query(
        r#"
        SELECT entity_id, entity_type, source_id, access_level
        FROM entity_access
        WHERE entity_id = $1 AND source_type = 'team'
        "#,
    )
    .bind(CALL1)
    .fetch_one(&pool)
    .await?;

    assert_eq!(row.get::<Uuid, _>("entity_id"), CALL1);
    assert_eq!(row.get::<String, _>("entity_type"), "call");
    assert_eq!(row.get::<String, _>("source_id"), team_id.to_string());
    assert_eq!(row.get::<AccessLevel, _>("access_level"), AccessLevel::View);

    Ok(())
}

// -- archive_call skips team grant when share_with_team is false -------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn archive_call_skips_team_grant_when_share_with_team_false(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    use sqlx::Row as _;

    let repo = repo(pool.clone());
    let team_id: Uuid = Uuid::from_u128(0xbbbbbbbb_bbbb_bbbb_bbbb_bbbbbbbbbbbb);

    // USER_A is on a team, but the call opted out of team sharing — so no
    // team-scoped entity_access row should be created at archive time.
    give_user_a_team(&pool, USER_A.as_ref(), &team_id).await?;

    sqlx::query(r#"UPDATE calls SET share_with_team = false WHERE id = $1"#)
        .bind(CALL1)
        .execute(&pool)
        .await?;

    repo.archive_call(&CALL1).await?;

    let count: i64 = sqlx::query(
        r#"SELECT COUNT(*) AS count FROM entity_access WHERE entity_id = $1 AND source_type = 'team'"#,
    )
    .bind(CALL1)
    .map(|r: sqlx::postgres::PgRow| r.get::<i64, _>("count"))
    .fetch_one(&pool)
    .await?;

    assert_eq!(count, 0);

    Ok(())
}

// -- archive_call preserves id and share_permission_id ------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn archive_call_preserves_id_and_share_permission(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());

    // Read the share_permission_id from the active call before archiving.
    let active_share_permission_id = sqlx::query_scalar!(
        r#"SELECT share_permission_id FROM calls WHERE id = $1"#,
        CALL1,
    )
    .fetch_one(&pool)
    .await?;

    let record_id = repo.archive_call(&CALL1).await?;

    // The call_record id should be the same as the original call id.
    assert_eq!(record_id, CALL1);

    // The share_permission_id should carry over to the call_record.
    let record_share_permission_id = sqlx::query_scalar!(
        r#"SELECT share_permission_id FROM call_records WHERE id = $1"#,
        record_id,
    )
    .fetch_one(&pool)
    .await?;

    assert_eq!(record_share_permission_id, active_share_permission_id);

    Ok(())
}

// -- set_active_call_recording_key --------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn set_active_call_recording_key_updates_matching_call(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());

    // Set egress_id on the fixture call first.
    repo.set_egress_id(&CALL1, "egress-123").await?;

    // Should update and return true.
    let updated = repo
        .set_active_call_recording_key(
            "egress-123",
            "0195cea6-fc16-72f2-93b6-144df711f270/2026-04-10T210832.mp4",
        )
        .await?;
    assert!(updated);

    // Verify the key is on the active call.
    let call = repo.get_call_by_channel_id(&CH1).await?.unwrap();
    assert_eq!(call.egress_id.as_deref(), Some("egress-123"));

    // Now archive and verify recording_key carries forward.
    let record_id = repo.archive_call(&CALL1).await?;
    let key = sqlx::query_scalar!(
        r#"SELECT recording_key FROM call_records WHERE id = $1"#,
        record_id,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(
        key.as_deref(),
        Some("0195cea6-fc16-72f2-93b6-144df711f270/2026-04-10T210832.mp4")
    );

    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn set_active_call_recording_key_returns_false_when_no_match(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);

    let updated = repo
        .set_active_call_recording_key(
            "nonexistent-egress",
            "0195cea6-fc16-72f2-93b6-144df711f270/2026-04-10T210832.mp4",
        )
        .await?;
    assert!(!updated);

    Ok(())
}

// -- create_transcript_segment ------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn create_transcript_segment_stores_and_increments_sequence(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let now = Utc::now();

    let seg1 = TranscriptSegmentRequest {
        segment_id: "seg-001".to_string(),
        speaker_id: USER_A.to_string(),
        diarized_speaker_id: Some("spk-a0".to_string()),
        content: "hello world".to_string(),
        started_at: now,
        ended_at: Some(now),
        is_final: true,
        stream_started_at: None,
        embedding: None,
    };
    let seg2 = TranscriptSegmentRequest {
        segment_id: "seg-002".to_string(),
        speaker_id: USER_B.to_string(),
        diarized_speaker_id: None,
        content: "hi there".to_string(),
        started_at: now,
        ended_at: Some(now),
        is_final: true,
        stream_started_at: None,
        embedding: None,
    };

    repo.create_transcript_segment(&CALL1, &seg1, None).await?;
    repo.create_transcript_segment(&CALL1, &seg2, None).await?;

    // Duplicate segment_id should be ignored.
    repo.create_transcript_segment(&CALL1, &seg1, None).await?;

    let rows = sqlx::query!(
        r#"
        SELECT speaker_id, diarized_speaker_id, content, sequence_num
        FROM call_transcripts
        WHERE call_id = $1
        ORDER BY sequence_num ASC
        "#,
        CALL1,
    )
    .fetch_all(&pool)
    .await?;

    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0].content, "hello world");
    assert_eq!(rows[0].sequence_num, 1);
    assert_eq!(rows[0].diarized_speaker_id.as_deref(), Some("spk-a0"));
    assert_eq!(rows[1].content, "hi there");
    assert_eq!(rows[1].sequence_num, 2);
    assert_eq!(rows[1].diarized_speaker_id, None);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn get_transcript_voice_id_for_speaker_uses_diarized_speaker_id(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let now = Utc::now();
    let voice_a = macro_uuid::generate_uuid_v7();
    let voice_b = macro_uuid::generate_uuid_v7();
    insert_voice(&pool, voice_a, 0).await?;
    insert_voice(&pool, voice_b, 1).await?;

    let seg_a = TranscriptSegmentRequest {
        segment_id: "seg-voice-a".to_string(),
        speaker_id: USER_A.to_string(),
        diarized_speaker_id: Some("spk-a0".to_string()),
        content: "first voice".to_string(),
        started_at: now,
        ended_at: Some(now),
        is_final: true,
        stream_started_at: None,
        embedding: None,
    };
    let seg_b = TranscriptSegmentRequest {
        segment_id: "seg-voice-b".to_string(),
        speaker_id: USER_A.to_string(),
        diarized_speaker_id: Some("spk-a1".to_string()),
        content: "second voice".to_string(),
        started_at: now,
        ended_at: Some(now),
        is_final: true,
        stream_started_at: None,
        embedding: None,
    };

    repo.create_transcript_segment(&CALL1, &seg_a, Some(voice_a))
        .await?;
    repo.create_transcript_segment(&CALL1, &seg_b, Some(voice_b))
        .await?;

    assert_eq!(
        repo.get_transcript_voice_id_for_speaker(&CALL1, USER_A.as_ref(), Some("spk-a0"))
            .await?,
        Some(voice_a)
    );
    assert_eq!(
        repo.get_transcript_voice_id_for_speaker(&CALL1, USER_A.as_ref(), Some("spk-a1"))
            .await?,
        Some(voice_b)
    );
    assert_eq!(
        repo.get_transcript_voice_id_for_speaker(&CALL1, USER_A.as_ref(), Some("missing"))
            .await?,
        None
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn get_transcript_voice_id_for_speaker_falls_back_to_participant_id(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let now = Utc::now();
    let voice_id = macro_uuid::generate_uuid_v7();
    insert_voice(&pool, voice_id, 0).await?;

    let segment = TranscriptSegmentRequest {
        segment_id: "seg-voice-participant".to_string(),
        speaker_id: USER_A.to_string(),
        diarized_speaker_id: None,
        content: "voice without diarization".to_string(),
        started_at: now,
        ended_at: Some(now),
        is_final: true,
        stream_started_at: None,
        embedding: None,
    };

    repo.create_transcript_segment(&CALL1, &segment, Some(voice_id))
        .await?;

    assert_eq!(
        repo.get_transcript_voice_id_for_speaker(&CALL1, USER_A.as_ref(), None)
            .await?,
        Some(voice_id)
    );
    assert_eq!(
        repo.get_transcript_voice_id_for_speaker(&CALL1, USER_B.as_ref(), None)
            .await?,
        None
    );
    Ok(())
}

// -- archive_call copies transcripts ------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn archive_call_copies_transcripts(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let now = Utc::now();

    // Add a transcript segment to the active call.
    let seg = TranscriptSegmentRequest {
        segment_id: "seg-archive-001".to_string(),
        speaker_id: USER_A.to_string(),
        diarized_speaker_id: Some("spk-archive-a0".to_string()),
        content: "test transcript".to_string(),
        started_at: now,
        ended_at: Some(now),
        is_final: true,
        stream_started_at: None,
        embedding: None,
    };
    repo.create_transcript_segment(&CALL1, &seg, None).await?;

    // Archive the call.
    let record_id = repo.archive_call(&CALL1).await?;

    // Transcripts should be in call_record_transcripts.
    let transcripts = sqlx::query!(
        r#"
        SELECT speaker_id, diarized_speaker_id, content, sequence_num
        FROM call_record_transcripts
        WHERE call_record_id = $1
        "#,
        record_id,
    )
    .fetch_all(&pool)
    .await?;

    assert_eq!(transcripts.len(), 1);
    assert_eq!(transcripts[0].content, "test transcript");
    assert_eq!(transcripts[0].speaker_id, USER_A.as_ref());
    assert_eq!(
        transcripts[0].diarized_speaker_id.as_deref(),
        Some("spk-archive-a0")
    );
    assert_eq!(transcripts[0].sequence_num, 1);

    // Ephemeral transcripts should be gone (cascaded).
    let ephemeral = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM call_transcripts WHERE call_id = $1"#,
        CALL1,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(ephemeral, 0);

    Ok(())
}

// -- archive_call rolls up consecutive same-speaker transcripts --------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn archive_call_rolls_up_consecutive_same_speaker_transcripts(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    // Truncate to microseconds to match Postgres TIMESTAMPTZ precision,
    // otherwise the round-trip drops sub-microsecond nanoseconds and the
    // timestamp comparison below is flaky.
    let t0 = Utc::now().trunc_subsecs(6);

    // Row 1: USER_A / spk-a0, ends at t0+3s.
    // Row 2: USER_A / spk-a0, starts at t0+5s (gap=2s) -> merges with row 1.
    // Row 3: USER_A / spk-a0, starts at t0+20s (gap=12s) -> new group.
    // Row 4: USER_B / spk-b0 -> new group (different speaker).
    // Row 5: USER_B / spk-b1 -> new group (different diarized_speaker_id).
    let segs = [
        (
            "seg-1",
            USER_A.to_string(),
            Some("spk-a0"),
            "hello",
            t0,
            t0 + Duration::seconds(3),
        ),
        (
            "seg-2",
            USER_A.to_string(),
            Some("spk-a0"),
            "world",
            t0 + Duration::seconds(5),
            t0 + Duration::seconds(8),
        ),
        (
            "seg-3",
            USER_A.to_string(),
            Some("spk-a0"),
            "distant",
            t0 + Duration::seconds(20),
            t0 + Duration::seconds(22),
        ),
        (
            "seg-4",
            USER_B.to_string(),
            Some("spk-b0"),
            "hey",
            t0 + Duration::seconds(22),
            t0 + Duration::seconds(24),
        ),
        (
            "seg-5",
            USER_B.to_string(),
            Some("spk-b1"),
            "other",
            t0 + Duration::seconds(24),
            t0 + Duration::seconds(26),
        ),
    ];
    for (segment_id, speaker_id, diar, content, started_at, ended_at) in segs {
        repo.create_transcript_segment(
            &CALL1,
            &TranscriptSegmentRequest {
                segment_id: segment_id.to_string(),
                speaker_id,
                diarized_speaker_id: diar.map(str::to_string),
                content: content.to_string(),
                started_at,
                ended_at: Some(ended_at),
                is_final: true,
                stream_started_at: None,
                embedding: None,
            },
            None,
        )
        .await?;
    }

    let record_id = repo.archive_call(&CALL1).await?;

    let rows = sqlx::query!(
        r#"
        SELECT speaker_id, diarized_speaker_id, content, started_at, ended_at
        FROM call_record_transcripts
        WHERE call_record_id = $1
        ORDER BY sequence_num ASC
        "#,
        record_id,
    )
    .fetch_all(&pool)
    .await?;

    // 5 segments collapse into 4 rolled-up rows.
    assert_eq!(rows.len(), 4);

    // Group 1: seg-1 + seg-2 merged.
    assert_eq!(rows[0].speaker_id, USER_A.as_ref());
    assert_eq!(rows[0].diarized_speaker_id.as_deref(), Some("spk-a0"));
    assert_eq!(rows[0].content, "hello world");
    assert_eq!(rows[0].started_at, t0);
    assert_eq!(rows[0].ended_at, Some(t0 + Duration::seconds(8)));

    // Group 2: seg-3 alone (gap from seg-2 was 12s).
    assert_eq!(rows[1].speaker_id, USER_A.as_ref());
    assert_eq!(rows[1].diarized_speaker_id.as_deref(), Some("spk-a0"));
    assert_eq!(rows[1].content, "distant");

    // Group 3: seg-4 alone (different speaker_id).
    assert_eq!(rows[2].speaker_id, USER_B.as_ref());
    assert_eq!(rows[2].diarized_speaker_id.as_deref(), Some("spk-b0"));
    assert_eq!(rows[2].content, "hey");

    // Group 4: seg-5 alone (different diarized_speaker_id).
    assert_eq!(rows[3].speaker_id, USER_B.as_ref());
    assert_eq!(rows[3].diarized_speaker_id.as_deref(), Some("spk-b1"));
    assert_eq!(rows[3].content, "other");

    Ok(())
}

// -- get_stable_speaker_voices_for_call_record -------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn get_stable_speaker_voices_for_call_record_returns_all_voices_for_consistent_diarized_speakers(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let now = Utc::now();
    let voice_a = macro_uuid::generate_uuid_v7();
    let voice_b = macro_uuid::generate_uuid_v7();
    insert_voice(&pool, voice_a, 0).await?;
    insert_voice(&pool, voice_b, 1).await?;
    insert_user_mapping(&pool, USER_A.deref(), MACRO_USER_A).await?;
    insert_user_mapping(&pool, USER_B.deref(), MACRO_USER_B).await?;
    insert_user_mapping(&pool, USER_C.deref(), MACRO_USER_C).await?;

    let segments = [
        // USER_A is stable: every row has the same non-null diarized speaker,
        // so all non-null voice ids from those rows should be returned.
        ("stable-a-1", USER_A.as_ref(), Some("spk-a0"), Some(voice_a)),
        ("stable-a-2", USER_A.as_ref(), Some("spk-a0"), Some(voice_b)),
        ("stable-a-3", USER_A.as_ref(), Some("spk-a0"), None),
        // USER_B is ambiguous: more than one distinct diarized speaker id.
        (
            "ambiguous-b-1",
            USER_B.as_ref(),
            Some("spk-b0"),
            Some(voice_a),
        ),
        (
            "ambiguous-b-2",
            USER_B.as_ref(),
            Some("spk-b1"),
            Some(voice_b),
        ),
        // USER_C is incomplete: at least one transcript row has no diarized speaker id.
        (
            "missing-c-1",
            USER_C.as_ref(),
            Some("spk-c0"),
            Some(voice_a),
        ),
        ("missing-c-2", USER_C.as_ref(), None, Some(voice_b)),
        // Unknown speaker ids are ignored even if their diarized speaker id is stable.
        (
            "unknown-speaker",
            "macro|unknown-speaker@test.com",
            Some("spk-unknown"),
            Some(voice_a),
        ),
    ];

    for (idx, (segment_id, speaker_id, diarized_speaker_id, voice_id)) in
        segments.into_iter().enumerate()
    {
        let started_at = now + Duration::seconds(idx as i64);
        repo.create_transcript_segment(
            &CALL1,
            &TranscriptSegmentRequest {
                segment_id: segment_id.to_string(),
                speaker_id: speaker_id.to_string(),
                diarized_speaker_id: diarized_speaker_id.map(str::to_string),
                content: segment_id.to_string(),
                started_at,
                ended_at: Some(started_at + Duration::milliseconds(100)),
                is_final: true,
                stream_started_at: None,
                embedding: None,
            },
            voice_id,
        )
        .await?;
    }

    let record_id = repo.archive_call(&CALL1).await?;

    let mut stable = repo
        .get_stable_speaker_voices_for_call_record(&record_id)
        .await?;
    stable.sort();

    let mut expected = vec![(MACRO_USER_A, voice_a), (MACRO_USER_A, voice_b)];
    expected.sort();
    assert_eq!(stable, expected);
    Ok(())
}

// -- patch_call_transcript_speakers_from_voice_match -------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_call_transcript_speakers_from_voice_match_requires_same_team_as_participant(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let user_d = MacroUserIdStr::parse_from_str("macro|user-d@test.com").unwrap();
    let macro_user_d = Uuid::now_v7();

    insert_user_mapping(&pool, USER_A.deref(), MACRO_USER_A).await?;
    insert_user_mapping(&pool, USER_C.deref(), MACRO_USER_C).await?;
    insert_user_mapping(&pool, &user_d, macro_user_d).await?;

    // USER_A is a participant in CALL_ARCHIVED. USER_C is not a participant,
    // but is in USER_A's team, so C is eligible for auto-assignment.
    insert_team_members(
        &pool,
        Uuid::from_u128(0xaaaaaaaa_aaaa_aaaa_aaaa_aaaaaaaaaa01),
        USER_A.as_ref(),
        &[USER_A.as_ref(), USER_C.as_ref()],
    )
    .await?;

    // USER_D has an enrolled voice match but belongs to a team with no call
    // participants, so D must not be auto-assigned.
    insert_team_members(
        &pool,
        Uuid::from_u128(0xdddddddd_dddd_dddd_dddd_dddddddddd01),
        user_d.as_ref(),
        &[user_d.as_ref()],
    )
    .await?;

    let now = Utc::now();
    sqlx::query(
        r#"
        INSERT INTO call_record_transcripts
            (call_record_id, segment_id, speaker_id, diarized_speaker_id, custom_speaker, content, started_at, ended_at, sequence_num)
        VALUES
            ($1, 'seg-team-match', $2, 'spk-team-match', NULL, 'team match', $3, $3, 10),
            ($1, 'seg-cross-team-match', $2, 'spk-cross-team-match', NULL, 'cross team match', $3, $3, 11)
        "#,
    )
    .bind(CALL_ARCHIVED)
    .bind(USER_A.as_ref())
    .bind(now)
    .execute(&pool)
    .await?;

    repo.patch_call_transcript_speakers_from_voice_match(
        &CALL_ARCHIVED,
        &[
            ("spk-team-match".to_string(), MACRO_USER_C),
            ("spk-cross-team-match".to_string(), macro_user_d),
        ],
    )
    .await?;

    let rows = sqlx::query(
        r#"
        SELECT diarized_speaker_id, custom_speaker
        FROM call_record_transcripts
        WHERE call_record_id = $1
          AND diarized_speaker_id IN ('spk-team-match', 'spk-cross-team-match')
        ORDER BY sequence_num
        "#,
    )
    .bind(CALL_ARCHIVED)
    .fetch_all(&pool)
    .await?;

    use sqlx::Row as _;
    assert_eq!(rows.len(), 2);
    assert_eq!(
        rows[0].get::<String, _>("diarized_speaker_id"),
        "spk-team-match"
    );
    assert_eq!(
        rows[0]
            .get::<Option<String>, _>("custom_speaker")
            .as_deref(),
        Some(USER_C.as_ref())
    );
    assert_eq!(
        rows[1].get::<String, _>("diarized_speaker_id"),
        "spk-cross-team-match"
    );
    assert_eq!(rows[1].get::<Option<String>, _>("custom_speaker"), None);

    Ok(())
}

// -- get_call_record_by_call_id ----------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn get_call_record_returns_active_call(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let now = Utc::now();

    // Ingest two transcript segments into the active call.
    repo.create_transcript_segment(
        &CALL1,
        &TranscriptSegmentRequest {
            segment_id: "seg-live-1".to_string(),
            speaker_id: USER_A.to_string(),
            diarized_speaker_id: Some("spk-live-a0".to_string()),
            content: "hello there".to_string(),
            started_at: now,
            ended_at: Some(now),
            is_final: true,
            stream_started_at: None,
            embedding: None,
        },
        None,
    )
    .await?;
    repo.create_transcript_segment(
        &CALL1,
        &TranscriptSegmentRequest {
            segment_id: "seg-live-2".to_string(),
            speaker_id: USER_B.to_string(),
            diarized_speaker_id: None,
            content: "general kenobi".to_string(),
            started_at: now,
            ended_at: Some(now),
            is_final: true,
            stream_started_at: None,
            embedding: None,
        },
        None,
    )
    .await?;

    let record = repo
        .get_call_record_by_call_id(&CALL1)
        .await?
        .expect("active call should be found");

    assert_eq!(record.call_id, CALL1);
    assert_eq!(record.channel_id, CH1);
    assert!(record.is_active);
    assert!(record.ended_at.is_none());
    assert!(record.duration_ms.is_none());

    // Participants from fixture.
    let user_ids: Vec<&str> = record
        .participants
        .iter()
        .map(|p| p.user_id.as_str())
        .collect();
    assert_eq!(user_ids, vec![USER_A.as_ref(), USER_B.as_ref()]);

    // Transcripts ordered by sequence_num.
    assert_eq!(record.transcript.len(), 2);
    assert_eq!(record.transcript[0].sequence_num, 1);
    assert_eq!(record.transcript[0].content, "hello there");
    assert_eq!(
        record.transcript[0].segment_id.as_deref(),
        Some("seg-live-1")
    );
    assert_eq!(
        record.transcript[0].diarized_speaker_id.as_deref(),
        Some("spk-live-a0")
    );
    assert_eq!(record.transcript[1].sequence_num, 2);
    assert_eq!(record.transcript[1].content, "general kenobi");
    assert_eq!(record.transcript[1].diarized_speaker_id, None);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn get_call_record_returns_archived_call(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let record = repo
        .get_call_record_by_call_id(&CALL_ARCHIVED)
        .await?
        .expect("archived call should be found");

    assert_eq!(record.call_id, CALL_ARCHIVED);
    assert_eq!(record.channel_id, CH1);
    assert!(!record.is_active);
    assert!(record.ended_at.is_some());
    assert_eq!(record.duration_ms, Some(300_000));
    assert_eq!(record.egress_id.as_deref(), Some("egress-arch-1"));

    // Participants from archived fixture (both have left_at).
    assert_eq!(record.participants.len(), 2);
    assert!(record.participants.iter().all(|p| p.left_at.is_some()));

    // Transcripts ordered by sequence_num.
    assert_eq!(record.transcript.len(), 3);
    assert_eq!(record.transcript[0].content, "archived hello");
    assert_eq!(
        record.transcript[0].diarized_speaker_id.as_deref(),
        Some("spk-arch-a0")
    );
    assert_eq!(record.transcript[1].content, "archived reply");
    assert_eq!(record.transcript[1].diarized_speaker_id, None);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn get_call_record_overrides_speaker_id_with_custom_speaker(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    let record = repo
        .get_call_record_by_call_id(&CALL_ARCHIVED)
        .await?
        .expect("archived call should be found");

    // Row without an override returns the derived speaker_id.
    assert_eq!(record.transcript[0].content, "archived hello");
    assert_eq!(record.transcript[0].speaker_id, "macro|user-a@test.com");

    // Row with `custom_speaker` set returns the override, not the derived
    // speaker_id (which is `macro|user-a@test.com` in the fixture).
    assert_eq!(record.transcript[2].content, "archived overridden");
    assert_eq!(record.transcript[2].speaker_id, "macro|user-b@test.com");
    assert_eq!(
        record.transcript[2].diarized_speaker_id.as_deref(),
        Some("spk-arch-b0")
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn get_call_record_returns_none_for_unknown(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    let record = repo.get_call_record_by_call_id(&Uuid::now_v7()).await?;
    assert!(record.is_none());
    Ok(())
}

// -- batch_get_call_record_previews -------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn batch_get_call_record_previews_mixes_active_archived_and_missing(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    let missing = Uuid::now_v7();

    let previews = repo
        .batch_get_call_record_previews(&[CALL1, CALL_ARCHIVED, missing], USER_A.deref().copied())
        .await?;

    assert_eq!(previews.len(), 3);

    // Active call comes back as Exists with ended_at = None.
    match &previews[0] {
        CallRecordPreview::Exists(data) => {
            assert_eq!(data.call_id, CALL1);
            assert_eq!(data.channel_id, CH1);
            assert_eq!(data.channel_name.as_deref(), Some("call-test-channel"));
            assert!(data.ended_at.is_none());
        }
        other => panic!("expected Exists for active call, got {other:?}"),
    }

    // Archived call comes back as Exists with ended_at populated.
    match &previews[1] {
        CallRecordPreview::Exists(data) => {
            assert_eq!(data.call_id, CALL_ARCHIVED);
            assert_eq!(data.channel_id, CH1);
            assert!(data.ended_at.is_some());
        }
        other => panic!("expected Exists for archived call, got {other:?}"),
    }

    // Missing id comes back as DoesNotExist.
    match &previews[2] {
        CallRecordPreview::DoesNotExist(w) => assert_eq!(w.call_id, missing),
        other => panic!("expected DoesNotExist for missing id, got {other:?}"),
    }

    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn batch_get_call_record_previews_deduplicates_input(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);

    // Four inputs but only two distinct ids; response should have exactly two.
    let previews = repo
        .batch_get_call_record_previews(
            &[CALL1, CALL1, CALL_ARCHIVED, CALL1],
            USER_A.deref().copied(),
        )
        .await?;

    assert_eq!(previews.len(), 2, "duplicates should be collapsed");

    let ids: Vec<Uuid> = previews
        .iter()
        .map(|p| match p {
            CallRecordPreview::Exists(d) => d.call_id,
            CallRecordPreview::DoesNotExist(w) => w.call_id,
        })
        .collect();
    assert_eq!(
        ids,
        vec![CALL1, CALL_ARCHIVED],
        "first-occurrence order must be preserved"
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn batch_get_call_record_previews_empty_input_returns_empty(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    let previews = repo
        .batch_get_call_record_previews(&[], USER_A.deref().copied())
        .await?;
    assert!(previews.is_empty());
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn get_call_records_by_user_includes_channel_member_not_in_call(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);

    // user-c is a member of CH1 (fixture) but is NOT in call_participants
    // for CALL1 or call_record_participants for CALL_ARCHIVED. Visibility
    // should now come from channel membership, so both calls should appear.
    let records = repo
        .get_call_records_by_user(USER_C.deref().copied(), 10, &None)
        .await?;

    assert_eq!(
        records.len(),
        2,
        "expected active + archived call for channel member"
    );
    assert!(records.iter().any(|r| r.call_id == CALL1 && r.is_active));
    assert!(
        records
            .iter()
            .any(|r| r.call_id == CALL_ARCHIVED && !r.is_active)
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn get_call_records_by_user_attended_true_returns_only_joined(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    let filter = attended_filter(true);

    // user-a is a participant in both CALL1 and CALL_ARCHIVED.
    let user_a_records = repo
        .get_call_records_by_user(USER_A.deref().copied(), 10, &filter)
        .await?;
    assert_eq!(user_a_records.len(), 2);
    assert!(user_a_records.iter().any(|r| r.call_id == CALL1));
    assert!(user_a_records.iter().any(|r| r.call_id == CALL_ARCHIVED));

    // user-c is a channel member but did not join any call.
    let user_c_records = repo
        .get_call_records_by_user(USER_C.deref().copied(), 10, &filter)
        .await?;
    assert!(
        user_c_records.is_empty(),
        "user-c attended none of the calls"
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn get_call_records_by_user_attended_false_returns_only_not_joined(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);
    let filter = attended_filter(false);

    // user-a joined every call, so attended=false should return nothing.
    let user_a_records = repo
        .get_call_records_by_user(USER_A.deref().copied(), 10, &filter)
        .await?;
    assert!(
        user_a_records.is_empty(),
        "user-a attended every fixture call"
    );

    // user-c joined none of the calls, so both should appear.
    let user_c_records = repo
        .get_call_records_by_user(USER_C.deref().copied(), 10, &filter)
        .await?;
    assert_eq!(user_c_records.len(), 2);
    assert!(user_c_records.iter().any(|r| r.call_id == CALL1));
    assert!(user_c_records.iter().any(|r| r.call_id == CALL_ARCHIVED));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn get_call_records_by_user_attended_none_returns_all(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);

    // Sanity-check the default path: without the attended filter, the query
    // still returns every call the channel member can see.
    let records = repo
        .get_call_records_by_user(USER_A.deref().copied(), 10, &None)
        .await?;
    assert_eq!(records.len(), 2);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn get_call_records_by_user_call_ids_filter_narrows_results(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);

    let filter = call_ids_filter(&[CALL_ARCHIVED]);
    let records = repo
        .get_call_records_by_user(USER_A.deref().copied(), 10, &filter)
        .await?;
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].call_id, CALL_ARCHIVED);

    let filter = call_ids_filter(&[CALL1, CALL_ARCHIVED]);
    let records = repo
        .get_call_records_by_user(USER_A.deref().copied(), 10, &filter)
        .await?;
    assert_eq!(records.len(), 2);

    let filter = call_ids_filter(&[Uuid::nil()]);
    let records = repo
        .get_call_records_by_user(USER_A.deref().copied(), 10, &filter)
        .await?;
    assert!(
        records.is_empty(),
        "no call should match an unrelated call id"
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn get_call_records_by_user_returns_archived_summary(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let summary = "AI-generated summary of the archived call.";
    sqlx::query!(
        r#"UPDATE call_records SET summary = $2 WHERE id = $1"#,
        CALL_ARCHIVED,
        summary,
    )
    .execute(&pool)
    .await?;

    let records = repo
        .get_call_records_by_user(USER_A.deref().copied(), 10, &None)
        .await?;

    let active = records
        .iter()
        .find(|r| r.call_id == CALL1)
        .expect("active call missing");
    assert!(active.is_active);
    assert!(active.summary.is_none());

    let archived = records
        .iter()
        .find(|r| r.call_id == CALL_ARCHIVED)
        .expect("archived call missing");
    assert!(!archived.is_active);
    assert_eq!(archived.summary.as_deref(), Some(summary));

    Ok(())
}

// -- delete_call_record -------------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn delete_call_record_cascades(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool.clone());

    // Sanity check: the archived call and its children exist before delete.
    let pre_participants: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM call_record_participants WHERE call_record_id = $1"#,
        CALL_ARCHIVED,
    )
    .fetch_one(&pool)
    .await?;
    let pre_transcripts: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM call_record_transcripts WHERE call_record_id = $1"#,
        CALL_ARCHIVED,
    )
    .fetch_one(&pool)
    .await?;
    assert!(pre_participants > 0);
    assert!(pre_transcripts > 0);

    repo.delete_call_record(&CALL_ARCHIVED).await?;

    // Record row is gone.
    let record = repo.get_call_record_by_call_id(&CALL_ARCHIVED).await?;
    assert!(record.is_none());

    // Cascade removed participants and transcripts.
    let remaining_participants: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM call_record_participants WHERE call_record_id = $1"#,
        CALL_ARCHIVED,
    )
    .fetch_one(&pool)
    .await?;
    let remaining_transcripts: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM call_record_transcripts WHERE call_record_id = $1"#,
        CALL_ARCHIVED,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(remaining_participants, 0);
    assert_eq!(remaining_transcripts, 0);
    // entity_access grants for the archived call must be cleaned up atomically.
    let remaining_grants: i64 = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM entity_access WHERE entity_id = $1 AND entity_type = 'call'"#,
        CALL_ARCHIVED,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(remaining_grants, 0);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn delete_call_record_noop_for_unknown_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);
    // Non-existent id — should succeed without touching anything.
    repo.delete_call_record(&Uuid::now_v7()).await?;

    // Existing archived record must still be present.
    assert!(
        repo.get_call_record_by_call_id(&CALL_ARCHIVED)
            .await?
            .is_some()
    );
    Ok(())
}

// -- patch_call_record --------------------------------------------------------

const SP_ARCHIVED: &str = "00000000-0000-0000-0000-00000000sp02";

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_call_record_sets_is_public_true_defaults_view(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());

    repo.patch_call_record(
        &CALL_ARCHIVED,
        &EditCallRecordRequest {
            share_permission: Some(UpdateSharePermissionRequestV2 {
                is_public: Some(true),
                public_access_level: None,
                channel_share_permissions: None,
            }),
            share_with_team: None,
            custom_name: None,
        },
    )
    .await?;

    let row = sqlx::query!(
        r#"
        SELECT "isPublic" as "is_public!", "publicAccessLevel" as "public_access_level?"
        FROM "SharePermission"
        WHERE id = $1
        "#,
        SP_ARCHIVED,
    )
    .fetch_one(&pool)
    .await?;

    assert!(row.is_public);
    assert_eq!(row.public_access_level.as_deref(), Some("view"));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_call_record_sets_is_public_false_clears_public_access_level(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());

    // Seed a non-null public access level so the clear is observable.
    sqlx::query!(
        r#"UPDATE "SharePermission" SET "isPublic" = true, "publicAccessLevel" = 'edit' WHERE id = $1"#,
        SP_ARCHIVED,
    )
    .execute(&pool)
    .await?;

    repo.patch_call_record(
        &CALL_ARCHIVED,
        &EditCallRecordRequest {
            share_permission: Some(UpdateSharePermissionRequestV2 {
                is_public: Some(false),
                public_access_level: Some(AccessLevel::Edit),
                channel_share_permissions: None,
            }),
            share_with_team: None,
            custom_name: None,
        },
    )
    .await?;

    let row = sqlx::query!(
        r#"
        SELECT "isPublic" as "is_public!", "publicAccessLevel" as "public_access_level?"
        FROM "SharePermission"
        WHERE id = $1
        "#,
        SP_ARCHIVED,
    )
    .fetch_one(&pool)
    .await?;

    assert!(!row.is_public);
    assert!(row.public_access_level.is_none());
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_call_record_sets_public_access_level(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool.clone());

    repo.patch_call_record(
        &CALL_ARCHIVED,
        &EditCallRecordRequest {
            share_permission: Some(UpdateSharePermissionRequestV2 {
                is_public: None,
                public_access_level: Some(AccessLevel::Edit),
                channel_share_permissions: None,
            }),
            share_with_team: None,
            custom_name: None,
        },
    )
    .await?;

    let row = sqlx::query!(
        r#"
        SELECT "publicAccessLevel" as "public_access_level?"
        FROM "SharePermission"
        WHERE id = $1
        "#,
        SP_ARCHIVED,
    )
    .fetch_one(&pool)
    .await?;

    assert_eq!(row.public_access_level.as_deref(), Some("edit"));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_call_record_adds_channel_share_permission(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let channel_id = CH2.to_string();

    repo.patch_call_record(
        &CALL_ARCHIVED,
        &EditCallRecordRequest {
            share_permission: Some(UpdateSharePermissionRequestV2 {
                is_public: None,
                public_access_level: None,
                channel_share_permissions: Some(vec![UpdateChannelSharePermission {
                    operation: UpdateOperation::Add,
                    channel_id: channel_id.clone(),
                    access_level: Some(AccessLevel::View),
                }]),
            }),
            share_with_team: None,
            custom_name: None,
        },
    )
    .await?;

    let csp_count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!"
        FROM "ChannelSharePermission"
        WHERE share_permission_id = $1 AND channel_id = $2
        "#,
        SP_ARCHIVED,
        &channel_id,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(csp_count, 1);

    let access_rows = sqlx::query!(
        r#"
        SELECT source_id, access_level::text as "access_level", source_type::text as "source_type"
        FROM entity_access
        WHERE entity_id = $1
          AND entity_type = 'call'
          AND source_id = $2
          AND source_type = 'channel'
        "#,
        CALL_ARCHIVED,
        &channel_id,
    )
    .fetch_all(&pool)
    .await?;

    assert_eq!(access_rows.len(), 1);
    assert_eq!(access_rows[0].access_level.as_deref(), Some("view"));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_call_record_removes_channel_share_permission(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let channel_id = CH1.to_string();

    // Sanity: the fixture seeded a ChannelSharePermission for CH1.
    let pre_count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!"
        FROM "ChannelSharePermission"
        WHERE share_permission_id = $1 AND channel_id = $2
        "#,
        SP_ARCHIVED,
        &channel_id,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(pre_count, 1);

    repo.patch_call_record(
        &CALL_ARCHIVED,
        &EditCallRecordRequest {
            share_permission: Some(UpdateSharePermissionRequestV2 {
                is_public: None,
                public_access_level: None,
                channel_share_permissions: Some(vec![UpdateChannelSharePermission {
                    operation: UpdateOperation::Remove,
                    channel_id: channel_id.clone(),
                    access_level: None,
                }]),
            }),
            share_with_team: None,
            custom_name: None,
        },
    )
    .await?;

    let post_count = sqlx::query_scalar!(
        r#"
        SELECT COUNT(*) as "count!"
        FROM "ChannelSharePermission"
        WHERE share_permission_id = $1 AND channel_id = $2
        "#,
        SP_ARCHIVED,
        &channel_id,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(post_count, 0);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_call_record_none_is_noop(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool.clone());

    let before = sqlx::query!(
        r#"
        SELECT "isPublic" as "is_public!", "publicAccessLevel" as "public_access_level?"
        FROM "SharePermission"
        WHERE id = $1
        "#,
        SP_ARCHIVED,
    )
    .fetch_one(&pool)
    .await?;

    repo.patch_call_record(
        &CALL_ARCHIVED,
        &EditCallRecordRequest {
            share_permission: None,
            share_with_team: None,
            custom_name: None,
        },
    )
    .await?;

    let after = sqlx::query!(
        r#"
        SELECT "isPublic" as "is_public!", "publicAccessLevel" as "public_access_level?"
        FROM "SharePermission"
        WHERE id = $1
        "#,
        SP_ARCHIVED,
    )
    .fetch_one(&pool)
    .await?;

    assert_eq!(before.is_public, after.is_public);
    assert_eq!(before.public_access_level, after.public_access_level);
    Ok(())
}

// -- patch_call_record: custom_name -------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_call_record_sets_custom_name_on_archived_record(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());

    repo.patch_call_record(
        &CALL_ARCHIVED,
        &EditCallRecordRequest {
            share_permission: None,
            share_with_team: None,
            custom_name: Some("Q4 sync".to_string()),
        },
    )
    .await?;

    let stored = sqlx::query_scalar!(
        r#"SELECT custom_name FROM call_records WHERE id = $1"#,
        CALL_ARCHIVED,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(stored.as_deref(), Some("Q4 sync"));

    let record = repo.get_call_record_by_call_id(&CALL_ARCHIVED).await?;
    assert_eq!(
        record.and_then(|r| r.custom_name).as_deref(),
        Some("Q4 sync"),
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_call_record_custom_name_overwrites_existing(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());

    sqlx::query!(
        r#"UPDATE call_records SET custom_name = $2 WHERE id = $1"#,
        CALL_ARCHIVED,
        "Old name",
    )
    .execute(&pool)
    .await?;

    repo.patch_call_record(
        &CALL_ARCHIVED,
        &EditCallRecordRequest {
            share_permission: None,
            share_with_team: None,
            custom_name: Some("New name".to_string()),
        },
    )
    .await?;

    let stored = sqlx::query_scalar!(
        r#"SELECT custom_name FROM call_records WHERE id = $1"#,
        CALL_ARCHIVED,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(stored.as_deref(), Some("New name"));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_call_record_custom_name_empty_string_clears_existing(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());

    sqlx::query!(
        r#"UPDATE call_records SET custom_name = $2 WHERE id = $1"#,
        CALL_ARCHIVED,
        "Existing",
    )
    .execute(&pool)
    .await?;

    repo.patch_call_record(
        &CALL_ARCHIVED,
        &EditCallRecordRequest {
            share_permission: None,
            share_with_team: None,
            custom_name: Some(String::new()),
        },
    )
    .await?;

    let stored = sqlx::query_scalar!(
        r#"SELECT custom_name FROM call_records WHERE id = $1"#,
        CALL_ARCHIVED,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(stored, None);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_call_record_custom_name_none_is_noop(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool.clone());

    sqlx::query!(
        r#"UPDATE call_records SET custom_name = $2 WHERE id = $1"#,
        CALL_ARCHIVED,
        "Existing",
    )
    .execute(&pool)
    .await?;

    repo.patch_call_record(
        &CALL_ARCHIVED,
        &EditCallRecordRequest {
            share_permission: None,
            share_with_team: None,
            custom_name: None,
        },
    )
    .await?;

    let stored = sqlx::query_scalar!(
        r#"SELECT custom_name FROM call_records WHERE id = $1"#,
        CALL_ARCHIVED,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(stored.as_deref(), Some("Existing"));
    Ok(())
}

// -- patch_call_record: share_with_team ---------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_call_record_share_with_team_true_grants_team_access_on_active_call(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let team_id: Uuid = Uuid::from_u128(0xaaaaaaaa_aaaa_aaaa_aaaa_aaaaaaaaa001);

    // The active call's created_by is USER_A — that's the team we should grant.
    give_user_a_team(&pool, USER_A.as_ref(), &team_id).await?;

    repo.patch_call_record(
        &CALL1,
        &EditCallRecordRequest {
            share_permission: None,
            share_with_team: Some(true),
            custom_name: None,
        },
    )
    .await?;

    let row = sqlx::query!(
        r#"
        SELECT source_id, access_level::text as "access_level"
        FROM entity_access
        WHERE entity_id = $1 AND entity_type = 'call' AND source_type = 'team'
        "#,
        CALL1,
    )
    .fetch_one(&pool)
    .await?;

    assert_eq!(row.source_id, team_id.to_string());
    assert_eq!(row.access_level.as_deref(), Some("view"));

    let flag = sqlx::query_scalar!(r#"SELECT share_with_team FROM calls WHERE id = $1"#, CALL1,)
        .fetch_one(&pool)
        .await?;
    assert!(flag);

    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_call_record_share_with_team_false_removes_team_access(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let team_id: Uuid = Uuid::from_u128(0xaaaaaaaa_aaaa_aaaa_aaaa_aaaaaaaaa002);

    give_user_a_team(&pool, USER_A.as_ref(), &team_id).await?;

    // Pre-seed a team entity_access row so we can observe the deletion.
    sqlx::query(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
           VALUES ($1, 'call', $2, 'team', 'view')"#,
    )
    .bind(CALL1)
    .bind(team_id.to_string())
    .execute(&pool)
    .await?;

    repo.patch_call_record(
        &CALL1,
        &EditCallRecordRequest {
            share_permission: None,
            share_with_team: Some(false),
            custom_name: None,
        },
    )
    .await?;

    let count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM entity_access
           WHERE entity_id = $1 AND source_type = 'team'"#,
        CALL1,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(count, 0);

    let flag = sqlx::query_scalar!(r#"SELECT share_with_team FROM calls WHERE id = $1"#, CALL1,)
        .fetch_one(&pool)
        .await?;
    assert!(!flag);

    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_call_record_share_with_team_works_on_archived_record(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let team_id: Uuid = Uuid::from_u128(0xaaaaaaaa_aaaa_aaaa_aaaa_aaaaaaaaa003);

    // CALL_ARCHIVED was created by USER_A; its team should get View.
    give_user_a_team(&pool, USER_A.as_ref(), &team_id).await?;

    repo.patch_call_record(
        &CALL_ARCHIVED,
        &EditCallRecordRequest {
            share_permission: None,
            share_with_team: Some(true),
            custom_name: None,
        },
    )
    .await?;

    let row = sqlx::query!(
        r#"
        SELECT source_id, access_level::text as "access_level"
        FROM entity_access
        WHERE entity_id = $1 AND entity_type = 'call' AND source_type = 'team'
        "#,
        CALL_ARCHIVED,
    )
    .fetch_one(&pool)
    .await?;

    assert_eq!(row.source_id, team_id.to_string());
    assert_eq!(row.access_level.as_deref(), Some("view"));

    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_call_record_share_with_team_ignores_non_creator_teams(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let creator_team: Uuid = Uuid::from_u128(0xaaaaaaaa_aaaa_aaaa_aaaa_aaaaaaaaa004);
    let other_team: Uuid = Uuid::from_u128(0xbbbbbbbb_bbbb_bbbb_bbbb_bbbbbbbbb004);
    let other_macro_user_id = Uuid::now_v7();

    // USER_A (the call creator) is on `creator_team`.
    give_user_a_team(&pool, USER_A.as_ref(), &creator_team).await?;

    // Seed a second team whose owner is a different user (USER_B). The repo
    // must not grant access to this team — the lookup keys off the call's
    // created_by (USER_A), not off any other user's team membership.
    sqlx::query(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $3, $4)"#,
    )
    .bind(other_macro_user_id)
    .bind(USER_B.as_ref())
    .bind("user-b@test.com")
    .bind("cus_other")
    .execute(&pool)
    .await?;
    sqlx::query(r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#)
        .bind(USER_B.as_ref())
        .bind("user-b@test.com")
        .bind(other_macro_user_id)
        .execute(&pool)
        .await?;
    sqlx::query(r#"INSERT INTO team (id, name, owner_id) VALUES ($1, $2, $3)"#)
        .bind(other_team)
        .bind("unrelated team")
        .bind(USER_B.as_ref())
        .execute(&pool)
        .await?;
    sqlx::query(r#"INSERT INTO team_user (user_id, team_id, team_role) VALUES ($1, $2, 'owner')"#)
        .bind(USER_B.as_ref())
        .bind(other_team)
        .execute(&pool)
        .await?;

    repo.patch_call_record(
        &CALL1,
        &EditCallRecordRequest {
            share_permission: None,
            share_with_team: Some(true),
            custom_name: None,
        },
    )
    .await?;

    let source_ids: Vec<String> = sqlx::query_scalar!(
        r#"SELECT source_id FROM entity_access
           WHERE entity_id = $1 AND source_type = 'team'"#,
        CALL1,
    )
    .fetch_all(&pool)
    .await?;

    assert_eq!(source_ids, vec![creator_team.to_string()]);

    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_call_record_share_with_team_true_noop_when_creator_has_no_team(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());

    // USER_A is the creator and has no team — the call should succeed but
    // not create any team entity_access rows.
    repo.patch_call_record(
        &CALL1,
        &EditCallRecordRequest {
            share_permission: None,
            share_with_team: Some(true),
            custom_name: None,
        },
    )
    .await?;

    let count = sqlx::query_scalar!(
        r#"SELECT COUNT(*) as "count!" FROM entity_access
           WHERE entity_id = $1 AND source_type = 'team'"#,
        CALL1,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(count, 0);

    let flag = sqlx::query_scalar!(r#"SELECT share_with_team FROM calls WHERE id = $1"#, CALL1,)
        .fetch_one(&pool)
        .await?;
    assert!(flag);

    Ok(())
}

// -- set_custom_name_if_null --------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn set_custom_name_if_null_writes_when_column_is_null(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());

    repo.set_custom_name_if_null(&CALL_ARCHIVED, "AI Generated Name")
        .await?;

    let stored = sqlx::query_scalar!(
        r#"SELECT custom_name FROM call_records WHERE id = $1"#,
        CALL_ARCHIVED,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(stored.as_deref(), Some("AI Generated Name"));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn set_custom_name_if_null_does_not_overwrite_existing_name(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());

    sqlx::query!(
        r#"UPDATE call_records SET custom_name = $2 WHERE id = $1"#,
        CALL_ARCHIVED,
        "User Picked",
    )
    .execute(&pool)
    .await?;

    repo.set_custom_name_if_null(&CALL_ARCHIVED, "AI Generated")
        .await?;

    let stored = sqlx::query_scalar!(
        r#"SELECT custom_name FROM call_records WHERE id = $1"#,
        CALL_ARCHIVED,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(stored.as_deref(), Some("User Picked"));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn set_custom_name_if_null_noop_for_unknown_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool.clone());

    // Idempotent on missing rows — must not error.
    repo.set_custom_name_if_null(&Uuid::now_v7(), "Whatever")
        .await?;
    Ok(())
}

// -- insert_call_summary ------------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn insert_call_summary_sets_summary_text(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let summary = "A short synopsis of the call.";

    repo.insert_call_summary(&CALL_ARCHIVED, summary).await?;

    let stored = sqlx::query_scalar!(
        r#"SELECT summary FROM call_records WHERE id = $1"#,
        CALL_ARCHIVED,
    )
    .fetch_one(&pool)
    .await?;

    assert_eq!(stored.as_deref(), Some(summary));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn insert_call_summary_noop_for_unknown_id(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool.clone());

    // Unknown id should be an idempotent no-op (not an error).
    repo.insert_call_summary(&Uuid::now_v7(), "irrelevant")
        .await?;

    // The archived fixture row must remain untouched.
    let stored = sqlx::query_scalar!(
        r#"SELECT summary FROM call_records WHERE id = $1"#,
        CALL_ARCHIVED,
    )
    .fetch_one(&pool)
    .await?;
    assert!(stored.is_none());
    Ok(())
}

// -- patch_call_transcript_custom_speakers ------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_call_transcript_custom_speakers_sets_and_clears(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);

    // Set: pin diarized `spk-arch-a0` to user-c. The fixture's seg-arch-3 row
    // (diarized `spk-arch-b0`) already has user-b as its custom_speaker — clear it.
    repo.patch_call_transcript_custom_speakers(
        &CALL_ARCHIVED,
        &[
            CustomSpeakerAssignment {
                diarized_speaker_id: "spk-arch-a0".to_string(),
                custom_speaker: Some(USER_C.clone()),
            },
            CustomSpeakerAssignment {
                diarized_speaker_id: "spk-arch-b0".to_string(),
                custom_speaker: None,
            },
        ],
    )
    .await?;

    let record = repo
        .get_call_record_by_call_id(&CALL_ARCHIVED)
        .await?
        .expect("archived call should exist");

    // seg-arch-1 (diarized spk-arch-a0): override now applied → user-c.
    assert_eq!(record.transcript[0].content, "archived hello");
    assert_eq!(record.transcript[0].speaker_id, "macro|user-c@test.com");

    // seg-arch-2 (diarized NULL): never touched.
    assert_eq!(record.transcript[1].content, "archived reply");
    assert_eq!(record.transcript[1].speaker_id, "macro|user-b@test.com");

    // seg-arch-3 (diarized spk-arch-b0): override cleared → derived speaker_id wins.
    assert_eq!(record.transcript[2].content, "archived overridden");
    assert_eq!(record.transcript[2].speaker_id, "macro|user-a@test.com");

    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_call_transcript_custom_speakers_empty_is_noop(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);

    repo.patch_call_transcript_custom_speakers(&CALL_ARCHIVED, &[])
        .await?;

    // Fixture state is unchanged.
    let record = repo
        .get_call_record_by_call_id(&CALL_ARCHIVED)
        .await?
        .expect("archived call should exist");
    assert_eq!(record.transcript[2].speaker_id, "macro|user-b@test.com");
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn patch_call_transcript_custom_speakers_unknown_diarized_id_is_noop(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);

    // Diarized id that doesn't exist in this call: silently affects nothing.
    repo.patch_call_transcript_custom_speakers(
        &CALL_ARCHIVED,
        &[CustomSpeakerAssignment {
            diarized_speaker_id: "spk-does-not-exist".to_string(),
            custom_speaker: Some(USER_C.clone()),
        }],
    )
    .await?;

    let record = repo
        .get_call_record_by_call_id(&CALL_ARCHIVED)
        .await?
        .expect("archived call should exist");
    // All rows still reflect their original speaker_id / custom_speaker.
    assert_eq!(record.transcript[0].speaker_id, "macro|user-a@test.com");
    assert_eq!(record.transcript[1].speaker_id, "macro|user-b@test.com");
    assert_eq!(record.transcript[2].speaker_id, "macro|user-b@test.com");
    Ok(())
}
