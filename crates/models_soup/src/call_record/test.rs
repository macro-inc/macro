use super::*;
use crate::item::SoupItem;
use call::domain::models::{CallRecord, CallRecordParticipant};
use chrono::{DateTime, Duration, Utc};
use item_filters::CallStatus;
use models_pagination::{SimpleSortMethod, SortOn};
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
        recording_started_at: None,
        recording_key: None,
        preview_key: None,
        recording_url: None,
        recording_preview_url: None,
        channel_name: None,
        custom_name: None,
        summary: None,
        share_with_team: true,
        is_active: true,
        status: None,
        participants: user_ids
            .iter()
            .map(|u| CallRecordParticipant {
                user_id: u.to_string(),
                joined_at: now,
                left_at: None,
            })
            .collect(),
        transcript: Vec::new(),
        user_access_level: None,
    }
}

fn record_with_status(status: CallStatus, user_ids: &[&str]) -> CallRecord {
    let mut record = record_with_participants(user_ids);
    record.status = Some(status);
    record
}

fn assert_call_recency(item: &SoupItem, expected: DateTime<Utc>) {
    assert_eq!(item.updated_at(), expected);

    for sort_method in [
        SimpleSortMethod::ViewedAt,
        SimpleSortMethod::UpdatedAt,
        SimpleSortMethod::ViewedUpdated,
    ] {
        let mut sort_on = <SoupItem as SortOn<SimpleSortMethod>>::sort_on(sort_method);
        assert_eq!(sort_on(item).last_val, expected, "sort: {sort_method:?}");
    }
}

#[test]
fn active_call_recency_uses_started_at() {
    let record = record_with_participants(&["macro|a@test.com"]);
    let started_at = record.started_at;
    let item = SoupItem::Call(SoupCallRecord::from_record_for_user(
        record,
        "macro|a@test.com",
    ));

    assert_call_recency(&item, started_at);
}

#[test]
fn finished_call_recency_uses_ended_at() {
    let mut record = record_with_participants(&["macro|a@test.com"]);
    let ended_at = record.started_at + Duration::minutes(30);
    record.ended_at = Some(ended_at);
    record.is_active = false;
    let item = SoupItem::Call(SoupCallRecord::from_record_for_user(
        record,
        "macro|a@test.com",
    ));

    assert_call_recency(&item, ended_at);
}

#[test]
fn call_record_status_uses_record_status_when_present() {
    let record = record_with_status(CallStatus::Missed, &["macro|a@test.com"]);
    let soup = SoupCallRecord::from_record_for_user(record, "macro|a@test.com");

    assert_eq!(soup.status, CallStatus::Missed);
    assert!(!soup.attended);
}

#[test]
fn call_record_status_attended_true_only_for_attended() {
    let attended = SoupCallRecord::from_record_for_user(
        record_with_status(CallStatus::Attended, &[]),
        "macro|a@test.com",
    );
    let missed = SoupCallRecord::from_record_for_user(
        record_with_status(CallStatus::Missed, &["macro|a@test.com"]),
        "macro|a@test.com",
    );
    let unattended = SoupCallRecord::from_record_for_user(
        record_with_status(CallStatus::Unattended, &["macro|a@test.com"]),
        "macro|a@test.com",
    );

    assert!(attended.attended);
    assert!(!missed.attended);
    assert!(!unattended.attended);
}

#[test]
fn call_record_status_falls_back_to_participant_attended_when_status_absent() {
    let record = record_with_participants(&["macro|a@test.com", "macro|b@test.com"]);
    let soup = SoupCallRecord::from_record_for_user(record, "macro|a@test.com");

    assert_eq!(soup.status, CallStatus::Attended);
    assert!(soup.attended);
}

#[test]
fn call_record_status_falls_back_to_unattended_when_status_absent() {
    let record = record_with_participants(&["macro|a@test.com", "macro|b@test.com"]);
    let soup = SoupCallRecord::from_record_for_user(record, "macro|c@test.com");

    assert_eq!(soup.status, CallStatus::Unattended);
    assert!(!soup.attended);
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

#[test]
fn from_record_for_user_passes_summary_through() {
    let mut record = record_with_participants(&["macro|a@test.com"]);
    record.summary = Some("AI summary".to_string());
    let soup = SoupCallRecord::from_record_for_user(record, "macro|a@test.com");
    assert_eq!(soup.summary.as_deref(), Some("AI summary"));
}

#[test]
fn from_record_for_user_summary_none_when_record_has_none() {
    let record = record_with_participants(&["macro|a@test.com"]);
    let soup = SoupCallRecord::from_record_for_user(record, "macro|a@test.com");
    assert!(soup.summary.is_none());
}
