use crate::domain::models::TranscriptSegmentRequest;
use crate::domain::ports::CallRepository;
use crate::outbound::pg_call_repo::PgCallRepo;
use chrono::Utc;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};
use uuid::Uuid;

const CH1: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000c01);
const CH2: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_000000000c02);
const CALL1: Uuid = Uuid::from_u128(0x00000000_0000_0000_0000_0000000ca110);
const USER_A: &str = "macro|user-a@test.com";
const USER_B: &str = "macro|user-b@test.com";
const USER_C: &str = "macro|user-c@test.com";

fn repo(pool: Pool<Postgres>) -> PgCallRepo {
    PgCallRepo::new(pool)
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
        .create_call(&id, &CH2, "room-ch2", USER_B)
        .await?
        .expect("should create new call");

    assert_eq!(call.id, id);
    assert_eq!(call.channel_id, CH2);
    assert_eq!(call.room_name, "room-ch2");
    assert_eq!(call.created_by, USER_B);
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
        .create_call(&Uuid::now_v7(), &CH1, "room-dup", USER_A)
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
    assert!(!repo.is_participant(&CALL1, USER_C).await?);

    let participant = repo.add_participant(&CALL1, USER_C).await?;
    assert_eq!(participant.call_id, CALL1);
    assert_eq!(participant.user_id, USER_C);

    assert!(repo.is_participant(&CALL1, USER_C).await?);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn remove_participant_removes_from_db(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);

    assert!(repo.is_participant(&CALL1, USER_B).await?);
    repo.remove_participant(&CALL1, USER_B).await?;
    assert!(!repo.is_participant(&CALL1, USER_B).await?);
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
    assert!(user_ids.contains(&USER_A));
    assert!(user_ids.contains(&USER_B));
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

    repo.remove_participant(&CALL1, USER_B).await?;
    assert_eq!(repo.get_participant_count(&CALL1).await?, 1);
    Ok(())
}

// -- delete_call --------------------------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn delete_call_cascades_to_participants(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool);

    repo.delete_call(&CALL1).await?;

    assert!(repo.get_call_by_channel_id(&CH1).await?.is_none());
    // Participants should be cascade-deleted.
    assert_eq!(repo.get_participant_count(&CALL1).await?, 0);
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
    assert_eq!(record.created_by, USER_A);
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
    repo.remove_participant(&CALL1, USER_A).await?;
    repo.remove_participant(&CALL1, USER_B).await?;

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
    assert!(user_ids.contains(&USER_A));
    assert!(user_ids.contains(&USER_B));
    // Both should have left_at set since they were soft-deleted.
    assert!(rows.iter().all(|r| r.left_at.is_some()));

    Ok(())
}

// -- set_active_call_recording_url --------------------------------------------

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn set_active_call_recording_url_updates_matching_call(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());

    // Set egress_id on the fixture call first.
    repo.set_egress_id(&CALL1, "egress-123").await?;

    // Should update and return true.
    let updated = repo
        .set_active_call_recording_url("egress-123", "s3://bucket/recording.mp4")
        .await?;
    assert!(updated);

    // Verify the URL is on the active call.
    let call = repo.get_call_by_channel_id(&CH1).await?.unwrap();
    assert_eq!(call.egress_id.as_deref(), Some("egress-123"));

    // Now archive and verify recording_url carries forward.
    let record_id = repo.archive_call(&CALL1).await?;
    let url = sqlx::query_scalar!(
        r#"SELECT recording_url FROM call_records WHERE id = $1"#,
        record_id,
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(url.as_deref(), Some("s3://bucket/recording.mp4"));

    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn set_active_call_recording_url_returns_false_when_no_match(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool);

    let updated = repo
        .set_active_call_recording_url("nonexistent-egress", "s3://bucket/recording.mp4")
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
        content: "hello world".to_string(),
        started_at: now,
        ended_at: Some(now),
        is_final: true,
    };
    let seg2 = TranscriptSegmentRequest {
        segment_id: "seg-002".to_string(),
        speaker_id: USER_B.to_string(),
        content: "hi there".to_string(),
        started_at: now,
        ended_at: Some(now),
        is_final: true,
    };

    repo.create_transcript_segment(&CALL1, &seg1).await?;
    repo.create_transcript_segment(&CALL1, &seg2).await?;

    // Duplicate segment_id should be ignored.
    repo.create_transcript_segment(&CALL1, &seg1).await?;

    let rows = sqlx::query!(
        r#"
        SELECT speaker_id, content, sequence_num
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
    assert_eq!(rows[1].content, "hi there");
    assert_eq!(rows[1].sequence_num, 2);
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
        content: "test transcript".to_string(),
        started_at: now,
        ended_at: Some(now),
        is_final: true,
    };
    repo.create_transcript_segment(&CALL1, &seg).await?;

    // Archive the call.
    let record_id = repo.archive_call(&CALL1).await?;

    // Transcripts should be in call_record_transcripts.
    let transcripts = sqlx::query!(
        r#"
        SELECT speaker_id, content, sequence_num
        FROM call_record_transcripts
        WHERE call_record_id = $1
        "#,
        record_id,
    )
    .fetch_all(&pool)
    .await?;

    assert_eq!(transcripts.len(), 1);
    assert_eq!(transcripts[0].content, "test transcript");
    assert_eq!(transcripts[0].speaker_id, USER_A);
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
