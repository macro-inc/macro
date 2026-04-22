use super::*;
use call::domain::models::{CallRecord, CallRecordParticipant};
use chrono::Utc;
use uuid::Uuid;

fn record_with_participants(user_ids: &[&str]) -> CallRecord {
    let now = Utc::now();
    CallRecord {
        call_id: Uuid::now_v7(),
        channel_id: Uuid::now_v7(),
        room_name: "room".to_string(),
        created_by: "macro|creator@test.com".to_string(),
        started_at: now,
        ended_at: None,
        duration_ms: None,
        egress_id: None,
        recording_key: None,
        recording_url: None,
        channel_name: None,
        is_active: true,
        participants: user_ids
            .iter()
            .map(|u| CallRecordParticipant {
                user_id: u.to_string(),
                joined_at: now,
                left_at: None,
            })
            .collect(),
        transcript: Vec::new(),
    }
}

#[test]
fn from_record_for_user_sets_attended_true_when_user_is_participant() {
    let record = record_with_participants(&["macro|a@test.com", "macro|b@test.com"]);
    let soup = SoupCallRecord::from_record_for_user(record, "macro|a@test.com");
    assert!(soup.attended);
    assert_eq!(soup.participants.len(), 2);
}

#[test]
fn from_record_for_user_sets_attended_false_when_user_not_participant() {
    let record = record_with_participants(&["macro|a@test.com", "macro|b@test.com"]);
    let soup = SoupCallRecord::from_record_for_user(record, "macro|c@test.com");
    assert!(!soup.attended);
    assert_eq!(soup.participants.len(), 2);
}

#[test]
fn from_record_for_user_attended_false_when_no_participants() {
    let record = record_with_participants(&[]);
    let soup = SoupCallRecord::from_record_for_user(record, "macro|a@test.com");
    assert!(!soup.attended);
    assert!(soup.participants.is_empty());
}
