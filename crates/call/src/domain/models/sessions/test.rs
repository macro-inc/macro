use chrono::TimeZone;
use uuid::Uuid;

use super::*;
use crate::domain::models::CallDiscussion;

fn at(hour: u32, minute: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 22, hour, minute, 0).unwrap()
}

fn archived_record(duration_minutes: i64) -> CallRecord {
    let call_id = Uuid::from_u128(1);
    CallRecord {
        call_id,
        channel_id: None,
        discussion: CallDiscussion::CallChat { call_id },
        room_name: Some(call_id.to_string()),
        created_by: "macro|host@example.com".to_string(),
        started_at: at(10, 0),
        ended_at: Some(at(11, 0)),
        duration_ms: Some(duration_minutes * 60_000),
        egress_id: Some("egress-1".to_string()),
        recording_started_at: Some(at(10, 1)),
        recording_key: Some("first.mp4".to_string()),
        preview_key: Some("first.jpg".to_string()),
        recording_url: None,
        recording_preview_url: None,
        channel_name: None,
        custom_name: None,
        summary: None,
        team_share_access_level: None,
        share_with_team: false,
        is_active: false,
        status: None,
        user_access_level: None,
        viewer_has_declined: false,
        participants: Vec::new(),
        guests: Vec::new(),
        transcript: Vec::new(),
        source: None,
        sessions: Vec::new(),
    }
}

fn later_session(start: DateTime<Utc>, end: DateTime<Utc>) -> CallRecordSession {
    CallRecordSession {
        started_at: start,
        ended_at: end,
        recording_started_at: None,
        recording_key: Some("later.mp4".to_string()),
        preview_key: None,
        recording_url: None,
        recording_preview_url: None,
    }
}

#[test]
fn a_call_that_was_never_resumed_is_one_session() {
    let mut record = archived_record(60);
    record.set_archived_sessions(Vec::new());

    assert_eq!(record.sessions.len(), 1);
    let first = &record.sessions[0];
    assert_eq!(first.started_at, at(10, 0));
    assert_eq!(first.ended_at, at(11, 0));
    assert_eq!(first.recording_key.as_deref(), Some("first.mp4"));
    assert_eq!(first.preview_key.as_deref(), Some("first.jpg"));
    assert_eq!(first.recording_started_at, Some(at(10, 1)));
}

#[test]
fn the_first_session_ends_after_the_talk_time_the_later_ones_leave() {
    // 20 minutes, a gap, then 15 minutes from 10:45 to 11:00.
    let mut record = archived_record(35);
    record.set_archived_sessions(vec![later_session(at(10, 45), at(11, 0))]);

    let windows: Vec<_> = record
        .sessions
        .iter()
        .map(|session| (session.started_at, session.ended_at))
        .collect();
    assert_eq!(
        windows,
        vec![(at(10, 0), at(10, 20)), (at(10, 45), at(11, 0))]
    );
    assert_eq!(
        record.sessions[1].recording_key.as_deref(),
        Some("later.mp4")
    );
}

#[test]
fn an_inconsistent_duration_never_moves_the_first_session_outside_the_call() {
    let mut short = archived_record(5);
    short.set_archived_sessions(vec![later_session(at(10, 30), at(11, 0))]);
    assert_eq!(short.sessions[0].ended_at, at(10, 0));

    let mut long = archived_record(600);
    long.set_archived_sessions(Vec::new());
    assert_eq!(long.sessions[0].ended_at, at(11, 0));
}

#[test]
fn live_and_imported_records_have_no_sessions() {
    let mut live = archived_record(60);
    live.ended_at = None;
    live.set_archived_sessions(Vec::new());
    assert!(live.sessions.is_empty());

    let mut imported = archived_record(60);
    imported.room_name = None;
    imported.set_archived_sessions(Vec::new());
    assert!(imported.sessions.is_empty());
}
