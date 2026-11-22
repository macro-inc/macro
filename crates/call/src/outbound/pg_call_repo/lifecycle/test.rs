//! A scheduled meeting that empties and is rejoined before its end stays one
//! call: allocation resumes it in a new room, archival merges each later
//! session into its record, and late writers find a session by its room or
//! egress.

use std::ops::Deref;

use chrono::{DateTime, TimeDelta, Utc};
use item_filters::CallStatus;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use super::super::test::{
    MACRO_USER_B, MACRO_USER_C, USER_B, USER_C, USER_D, insert_user_mapping, repo,
};
use crate::domain::meetings::{Meeting, MeetingCallAllocation, MeetingToken};
use crate::domain::models::{
    ArchivedCall, Call, CallError, CallRecordPage, TranscriptSegmentRequest,
};
use crate::domain::ports::CallRepository;
use crate::outbound::pg_call_repo::PgCallRepo;

const MACRO_USER_D: Uuid = Uuid::from_u128(0xdddddddd_dddd_dddd_dddd_ddddddddddd4);
const MINUTE_MS: i64 = 60_000;

/// A scheduled meeting owned by user B that started 30 minutes ago and ends
/// in 30, with users C and D able to attend.
async fn scheduled_meeting(pool: &Pool<Postgres>, repo: &PgCallRepo) -> anyhow::Result<Meeting> {
    insert_user_mapping(pool, USER_B.deref(), MACRO_USER_B).await?;
    insert_user_mapping(pool, USER_C.deref(), MACRO_USER_C).await?;
    insert_user_mapping(pool, USER_D.deref(), MACRO_USER_D).await?;
    let now = Utc::now();
    Ok(repo
        .create_meeting(Meeting {
            id: Uuid::now_v7(),
            share_token: MeetingToken::generate(),
            title: "Weekly review".to_string(),
            scheduled_start: Some(now - TimeDelta::minutes(30)),
            scheduled_end: Some(now + TimeDelta::minutes(30)),
            channel_id: None,
            channel_call_id: None,
            call_id: None,
            user_id: USER_B.to_string(),
        })
        .await?)
}

async fn join(repo: &PgCallRepo, meeting: &Meeting) -> anyhow::Result<MeetingCallAllocation> {
    Ok(repo
        .get_or_create_meeting_call(&meeting.id, &Uuid::now_v7(), true)
        .await?)
}

fn segment(
    segment_id: &str,
    speaker: &MacroUserIdStr<'_>,
    at: DateTime<Utc>,
) -> TranscriptSegmentRequest {
    TranscriptSegmentRequest {
        segment_id: segment_id.to_string(),
        speaker_id: speaker.to_string(),
        diarized_speaker_id: None,
        content: segment_id.to_string(),
        started_at: at,
        ended_at: Some(at + TimeDelta::seconds(1)),
        is_final: true,
        stream_started_at: None,
        embedding: None,
    }
}

/// One session from its first join to its archive: the session's room opened
/// at `started_at`, `attendee` joined, said `lines`, and left.
async fn hold_session(
    pool: &Pool<Postgres>,
    repo: &PgCallRepo,
    call: &Call,
    started_at: DateTime<Utc>,
    attendee: &MacroUserIdStr<'_>,
    lines: &[(&str, DateTime<Utc>)],
) -> anyhow::Result<ArchivedCall> {
    sqlx::query!(
        "UPDATE calls SET created_at = $2 WHERE id = $1",
        call.id,
        started_at
    )
    .execute(pool)
    .await?;
    repo.add_meeting_participant(&call.id, attendee.copied())
        .await
        .map_err(|error| anyhow::anyhow!("{error:?}"))?;
    for (segment_id, at) in lines {
        repo.create_transcript_segment(
            &call.id,
            &call.room_name,
            &segment(segment_id, attendee, *at),
            None,
        )
        .await?;
    }
    repo.remove_participant(&call.id, attendee.copied()).await?;
    repo.archive_call_if_empty(&call.id, &call.room_name)
        .await?
        .ok_or_else(|| anyhow::anyhow!("the empty session was not archived"))
}

/// Sets the first session's window to 30 to 20 minutes ago: 10 minutes of talk
/// time, ended inside the meeting's slot.
async fn end_first_session_twenty_minutes_ago(
    pool: &Pool<Postgres>,
    call_id: Uuid,
) -> anyhow::Result<DateTime<Utc>> {
    let started_at = sqlx::query_scalar!(
        "UPDATE call_records SET ended_at = started_at + interval '10 minutes', duration_ms = $2 WHERE id = $1 RETURNING started_at",
        call_id,
        10 * MINUTE_MS,
    )
    .fetch_one(pool)
    .await?;
    Ok(started_at)
}

async fn records_for_meeting(pool: &Pool<Postgres>, meeting_id: Uuid) -> anyhow::Result<i64> {
    Ok(sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM call_records WHERE meeting_id = $1"#,
        meeting_id
    )
    .fetch_one(pool)
    .await?)
}

/// The first session, archived and moved to 30 to 20 minutes ago, then a
/// resumed second session that is live.
async fn resumed_meeting(
    pool: &Pool<Postgres>,
    repo: &PgCallRepo,
) -> anyhow::Result<(Meeting, Call, Call)> {
    let now = Utc::now();
    let meeting = scheduled_meeting(pool, repo).await?;
    let MeetingCallAllocation::Started(first) = join(repo, &meeting).await? else {
        anyhow::bail!("the first join must start the call");
    };
    hold_session(
        pool,
        repo,
        &first,
        now - TimeDelta::minutes(30),
        USER_C.deref(),
        &[
            ("first-a", now - TimeDelta::minutes(29)),
            ("first-b", now - TimeDelta::minutes(25)),
        ],
    )
    .await?;
    end_first_session_twenty_minutes_ago(pool, first.id).await?;
    let MeetingCallAllocation::Resumed(second) = join(repo, &meeting).await? else {
        anyhow::bail!("a rejoin inside the slot must resume the call");
    };
    Ok((meeting, first, second))
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn a_rejoined_scheduled_meeting_is_one_record_with_two_sessions(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let now = Utc::now();
    let (meeting, first, second) = resumed_meeting(&pool, &repo).await?;
    assert_eq!(second.id, first.id);
    assert_ne!(second.room_name, first.room_name);

    let merged = hold_session(
        &pool,
        &repo,
        &second,
        now - TimeDelta::minutes(5),
        USER_D.deref(),
        &[
            ("second-a", now - TimeDelta::minutes(4)),
            ("second-b", now - TimeDelta::minutes(2)),
        ],
    )
    .await?;

    assert_eq!(records_for_meeting(&pool, meeting.id).await?, 1);
    let record = sqlx::query!(
        "SELECT started_at, ended_at, duration_ms FROM call_records WHERE id = $1",
        first.id
    )
    .fetch_one(&pool)
    .await?;
    let sessions = sqlx::query!(
        "SELECT room_name, started_at, ended_at FROM call_record_sessions WHERE call_record_id = $1",
        first.id
    )
    .fetch_all(&pool)
    .await?;
    assert_eq!(sessions.len(), 1);
    let session = &sessions[0];
    assert_eq!(session.room_name, second.room_name);
    // The record still starts at the first session; talk time is the sum of
    // both sessions, not the span with the gap between them.
    assert_eq!(merged.started_at, record.started_at);
    assert_eq!(record.ended_at, session.ended_at);
    assert_eq!(
        record.duration_ms,
        10 * MINUTE_MS + (session.ended_at - session.started_at).num_milliseconds()
    );
    assert_eq!(merged.duration_ms, record.duration_ms);
    let mut participants = merged.participants.clone();
    participants.sort();
    assert_eq!(participants, vec![USER_C.to_string(), USER_D.to_string()]);

    // Both sessions' lines, numbered in the order they were said.
    let transcript = sqlx::query!(
        "SELECT segment_id, sequence_num, started_at FROM call_record_transcripts WHERE call_record_id = $1 ORDER BY sequence_num",
        first.id
    )
    .fetch_all(&pool)
    .await?;
    let segments: Vec<_> = transcript
        .iter()
        .map(|line| line.segment_id.as_deref())
        .collect();
    assert_eq!(
        segments,
        vec![
            Some("first-a"),
            Some("first-b"),
            Some("second-a"),
            Some("second-b")
        ]
    );
    assert!(
        transcript
            .windows(2)
            .all(|pair| pair[0].sequence_num < pair[1].sequence_num
                && pair[0].started_at < pair[1].started_at)
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn someone_in_both_sessions_is_one_participant(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let (_, first, second) = resumed_meeting(&pool, &repo).await?;
    let before = sqlx::query!(
        "SELECT joined_at, left_at FROM call_record_participants WHERE call_record_id = $1 AND user_id = $2",
        first.id,
        USER_C.as_ref()
    )
    .fetch_one(&pool)
    .await?;

    hold_session(
        &pool,
        &repo,
        &second,
        Utc::now() - TimeDelta::minutes(5),
        USER_C.deref(),
        &[],
    )
    .await?;

    let after = sqlx::query!(
        "SELECT joined_at, left_at FROM call_record_participants WHERE call_record_id = $1 AND user_id = $2",
        first.id,
        USER_C.as_ref()
    )
    .fetch_all(&pool)
    .await?;
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].joined_at, before.joined_at);
    assert!(after[0].left_at > before.left_at);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn a_join_after_the_scheduled_end_starts_a_new_call(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let meeting = scheduled_meeting(&pool, &repo).await?;
    let first = join(&repo, &meeting).await?.call().clone();
    hold_session(&pool, &repo, &first, Utc::now(), USER_C.deref(), &[]).await?;
    sqlx::query!(
        "UPDATE call_meetings SET scheduled_start = now() - interval '2 hours', scheduled_end = now() - interval '1 hour' WHERE id = $1",
        meeting.id
    )
    .execute(&pool)
    .await?;

    let MeetingCallAllocation::Started(next) = join(&repo, &meeting).await? else {
        panic!("a join after the end must start a new call");
    };
    assert_ne!(next.id, first.id);
    hold_session(&pool, &repo, &next, Utc::now(), USER_C.deref(), &[]).await?;
    assert_eq!(records_for_meeting(&pool, meeting.id).await?, 2);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn a_call_that_ended_before_the_slot_opened_is_not_resumed(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let meeting = scheduled_meeting(&pool, &repo).await?;
    let first = join(&repo, &meeting).await?.call().clone();
    hold_session(&pool, &repo, &first, Utc::now(), USER_C.deref(), &[]).await?;
    // A link test 20 minutes before the slot's early-join window.
    sqlx::query!(
        "UPDATE call_records SET started_at = now() - interval '70 minutes', ended_at = now() - interval '65 minutes', duration_ms = $2 WHERE id = $1",
        first.id,
        5 * MINUTE_MS,
    )
    .execute(&pool)
    .await?;

    let MeetingCallAllocation::Started(next) = join(&repo, &meeting).await? else {
        panic!("a call from before the slot must not be resumed");
    };
    assert_ne!(next.id, first.id);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn instant_meetings_and_a_closed_gate_never_resume(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());

    let scheduled = scheduled_meeting(&pool, &repo).await?;
    let first = join(&repo, &scheduled).await?.call().clone();
    hold_session(&pool, &repo, &first, Utc::now(), USER_C.deref(), &[]).await?;
    let gated = repo
        .get_or_create_meeting_call(&scheduled.id, &Uuid::now_v7(), false)
        .await?;
    assert!(matches!(&gated, MeetingCallAllocation::Started(call) if call.id != first.id));

    let mut instant = scheduled.clone();
    instant.id = Uuid::now_v7();
    instant.share_token = MeetingToken::generate();
    instant.scheduled_start = None;
    instant.scheduled_end = None;
    let instant = repo.create_meeting(instant).await?;
    let first = join(&repo, &instant).await?.call().clone();
    hold_session(&pool, &repo, &first, Utc::now(), USER_D.deref(), &[]).await?;
    let again = join(&repo, &instant).await?;
    assert!(matches!(&again, MeetingCallAllocation::Started(call) if call.id != first.id));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn two_rejoins_at_once_resume_one_session(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let meeting = scheduled_meeting(&pool, &repo).await?;
    let first = join(&repo, &meeting).await?.call().clone();
    hold_session(&pool, &repo, &first, Utc::now(), USER_C.deref(), &[]).await?;

    let (one, two) = tokio::join!(join(&repo, &meeting), join(&repo, &meeting));
    let (one, two) = (one?, two?);
    let mut outcomes = [one.kind(), two.kind()];
    outcomes.sort_unstable();
    assert_eq!(outcomes, ["joined", "resumed"]);
    assert_eq!(one.call().id, first.id);
    assert_eq!(two.call().id, first.id);
    let live = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM calls WHERE id = $1"#,
        first.id
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(live, 1);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn archiving_an_earlier_session_leaves_the_resumed_one_alone(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let (_, first, second) = resumed_meeting(&pool, &repo).await?;

    // A caller still holding the first session's call.
    let stale = repo
        .archive_call_if_empty(&first.id, &first.room_name)
        .await;
    assert!(matches!(stale, Err(CallError::NotFound(_))));
    let stale = repo.archive_call(&first.id, &first.room_name).await;
    assert!(matches!(stale, Err(CallError::NotFound(_))));

    let live = repo.get_call_by_id(&first.id).await?;
    assert_eq!(live.map(|call| call.room_name), Some(second.room_name));
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn late_recording_writers_find_their_own_session(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let (_, first, second) = resumed_meeting(&pool, &repo).await?;
    let call_id = first.id;

    // The first session's recorder attaches after the resume: it lands on the
    // first session, never on the live one.
    assert!(
        !repo
            .attach_meeting_recording(&call_id, &first.room_name, "first-egress")
            .await?
    );
    assert_eq!(
        repo.get_call_by_id(&call_id)
            .await?
            .and_then(|call| call.egress_id),
        None
    );
    assert_eq!(
        repo.set_recording_key_by_egress_id("first-egress", "first.mp4")
            .await?,
        Some((call_id, None))
    );
    let first_started = Utc::now() - TimeDelta::minutes(29);
    assert!(
        repo.set_recording_started_at_by_egress_id("first-egress", first_started)
            .await?
    );

    // The live session's recorder, then its session ends.
    assert!(
        repo.attach_meeting_recording(&call_id, &second.room_name, "second-egress")
            .await?
    );
    repo.archive_call(&call_id, &second.room_name).await?;
    assert_eq!(
        repo.set_recording_key_by_egress_id("second-egress", "second.mp4")
            .await?,
        Some((call_id, None))
    );
    let second_started = Utc::now() - TimeDelta::minutes(1);
    assert!(
        repo.set_recording_started_at_by_egress_id("second-egress", second_started)
            .await?
    );

    // The agent's first audio frame is a better anchor than the webhook's; a
    // line for an ended session sets it but is not appended.
    let first_audio = second_started - TimeDelta::seconds(2);
    let mut late_line = segment("late", USER_D.deref(), Utc::now());
    late_line.stream_started_at = Some(first_audio);
    repo.create_transcript_segment(&call_id, &second.room_name, &late_line, None)
        .await?;

    let record = sqlx::query!(
        "SELECT egress_id, recording_key, recording_started_at FROM call_records WHERE id = $1",
        call_id
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(record.egress_id.as_deref(), Some("first-egress"));
    assert_eq!(record.recording_key.as_deref(), Some("first.mp4"));
    assert_eq!(
        record.recording_started_at.map(|at| at.timestamp_micros()),
        Some(first_started.timestamp_micros())
    );
    let session = sqlx::query!(
        "SELECT egress_id, recording_key, recording_started_at FROM call_record_sessions WHERE room_name = $1",
        second.room_name
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(session.egress_id.as_deref(), Some("second-egress"));
    assert_eq!(session.recording_key.as_deref(), Some("second.mp4"));
    assert_eq!(
        session.recording_started_at.map(|at| at.timestamp_micros()),
        Some(first_audio.timestamp_micros())
    );
    let late_lines = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM call_record_transcripts WHERE call_record_id = $1 AND segment_id = 'late'"#,
        call_id
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(late_lines, 0);
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn rooms_of_ended_sessions_belong_to_their_call(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let (_, first, second) = resumed_meeting(&pool, &repo).await?;

    assert_eq!(
        repo.get_ended_session_call(&first.room_name).await?,
        Some(first.id)
    );
    // The live session's room is not left over.
    assert_eq!(repo.get_ended_session_call(&second.room_name).await?, None);
    assert_eq!(repo.get_ended_session_call("unknown-room").await?, None);

    repo.archive_call(&second.id, &second.room_name).await?;
    assert_eq!(
        repo.get_ended_session_call(&second.room_name).await?,
        Some(first.id)
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn a_resumed_call_reads_as_live_then_as_one_call_of_two_sessions(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let (_, first, second) = resumed_meeting(&pool, &repo).await?;
    let page = CallRecordPage {
        by_start: true,
        after: None,
    };

    // While live again the live session wins every read, and the first
    // session's attendee still counts as having attended.
    let live = repo
        .get_call_record_by_call_id(&first.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("record"))?;
    assert!(live.is_active);
    assert_eq!(live.room_name.as_deref(), Some(second.room_name.as_str()));
    assert!(live.sessions.is_empty());
    let listed = repo
        .get_call_records_by_user(USER_C.deref().copied(), 10, &None, page)
        .await?;
    let listed: Vec<_> = listed
        .iter()
        .filter(|record| record.call_id == first.id)
        .collect();
    assert_eq!(listed.len(), 1);
    assert!(listed[0].is_active);
    assert_eq!(listed[0].status, Some(CallStatus::Attended));

    repo.archive_call(&second.id, &second.room_name).await?;
    let record = repo
        .get_call_record_by_call_id(&first.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("record"))?;
    assert!(!record.is_active);
    let windows: Vec<_> = record
        .sessions
        .iter()
        .map(|session| (session.started_at, session.ended_at))
        .collect();
    let session = sqlx::query!(
        "SELECT started_at, ended_at FROM call_record_sessions WHERE room_name = $1",
        second.room_name
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(
        windows,
        vec![
            (
                record.started_at,
                record.started_at + TimeDelta::minutes(10)
            ),
            (session.started_at, session.ended_at),
        ]
    );
    let listed = repo
        .get_call_records_by_user(USER_C.deref().copied(), 10, &None, page)
        .await?;
    assert_eq!(
        listed
            .iter()
            .filter(|record| record.call_id == first.id && !record.is_active)
            .count(),
        1
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("call_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn deleting_a_resumed_call_waits_for_it_to_end_then_removes_every_session(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = repo(pool.clone());
    let (_, first, second) = resumed_meeting(&pool, &repo).await?;
    assert!(
        repo.attach_meeting_recording(&first.id, &second.room_name, "second-egress")
            .await?
    );
    sqlx::query!(
        "UPDATE call_records SET recording_key = 'first.mp4', preview_url = 'first.jpg' WHERE id = $1",
        first.id
    )
    .execute(&pool)
    .await?;

    assert!(matches!(
        repo.delete_call_record(&first.id).await,
        Err(CallError::Conflict(_))
    ));

    repo.archive_call(&second.id, &second.room_name).await?;
    repo.set_recording_key_by_egress_id("second-egress", "second.mp4")
        .await?;
    let deleted = repo
        .delete_call_record(&first.id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("the record was deleted"))?;
    let keys: Vec<_> = deleted
        .iter()
        .map(|keys| (keys.recording_key.as_deref(), keys.preview_key.as_deref()))
        .collect();
    assert_eq!(
        keys,
        vec![
            (Some("first.mp4"), Some("first.jpg")),
            (Some("second.mp4"), None)
        ]
    );
    let sessions = sqlx::query_scalar!(
        r#"SELECT COUNT(*) AS "count!" FROM call_record_sessions WHERE call_record_id = $1"#,
        first.id
    )
    .fetch_one(&pool)
    .await?;
    assert_eq!(sessions, 0);
    Ok(())
}
