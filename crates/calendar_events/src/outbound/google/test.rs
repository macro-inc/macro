use super::*;

#[test]
fn calendar_access_role_is_reflected_on_mapped_events() {
    let master: GoogleEvent = serde_json::from_value(serde_json::json!({
        "id": "provider-event",
        "iCalUID": "readonly@example.com",
        "summary": "Read-only calendar",
        "start": {"dateTime": "2026-07-24T14:00:00Z", "timeZone": "UTC"},
        "end": {"dateTime": "2026-07-24T15:00:00Z", "timeZone": "UTC"},
        "created": "2026-07-20T14:00:00Z",
        "updated": "2026-07-21T14:00:00Z"
    }))
    .unwrap();
    let range = OccurrenceRange {
        starts_at: DateTime::parse_from_rfc3339("2026-07-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc),
        ends_at: DateTime::parse_from_rfc3339("2026-08-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc),
        start_date: NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
        end_date: NaiveDate::from_ymd_opt(2026, 8, 1).unwrap(),
    };

    let context = GoogleEventSyncContext {
        owner_id: "macro|readonly@example.com".to_string(),
        email_link_id: Uuid::now_v7(),
        account_id: Uuid::now_v7(),
        calendar_id: Uuid::now_v7(),
        provider_calendar_id: "primary".to_string(),
        is_read_only: true,
        range,
        sync_token: None,
        plan: GoogleSyncPlan::FullSnapshot,
    };
    let upsert = map_upsert(&context, master, Vec::new(), Vec::new()).unwrap();

    assert!(upsert.event.is_read_only);
}

#[test]
fn malformed_recurring_instance_does_not_overstate_snapshot_coverage() {
    let master: GoogleEvent = serde_json::from_value(serde_json::json!({
        "id": "provider-master",
        "iCalUID": "recurring@example.com",
        "summary": "Recurring calendar event",
        "start": {"dateTime": "2026-07-24T14:00:00Z", "timeZone": "UTC"},
        "end": {"dateTime": "2026-07-24T15:00:00Z", "timeZone": "UTC"},
        "recurrence": ["RRULE:FREQ=DAILY"],
        "created": "2026-07-20T14:00:00Z",
        "updated": "2026-07-21T14:00:00Z"
    }))
    .unwrap();
    let malformed_instance: GoogleEvent = serde_json::from_value(serde_json::json!({
        "id": "provider-instance",
        "iCalUID": "recurring@example.com",
        "recurringEventId": "provider-master",
        "originalStartTime": {"dateTime": "2026-07-24T14:00:00Z"},
        "start": {"dateTime": "2026-07-24T14:00:00Z"}
    }))
    .unwrap();
    let range = OccurrenceRange {
        starts_at: DateTime::parse_from_rfc3339("2026-07-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc),
        ends_at: DateTime::parse_from_rfc3339("2026-08-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc),
        start_date: NaiveDate::from_ymd_opt(2026, 7, 1).unwrap(),
        end_date: NaiveDate::from_ymd_opt(2026, 8, 1).unwrap(),
    };
    let context = GoogleEventSyncContext {
        owner_id: "macro|recurring@example.com".to_string(),
        email_link_id: Uuid::now_v7(),
        account_id: Uuid::now_v7(),
        calendar_id: Uuid::now_v7(),
        provider_calendar_id: "primary".to_string(),
        is_read_only: false,
        range,
        sync_token: None,
        plan: GoogleSyncPlan::FullSnapshot,
    };

    let upsert = map_upsert(&context, master, Vec::new(), vec![malformed_instance]).unwrap();
    assert!(upsert.occurrences.is_empty());
}

#[test]
fn malformed_master_is_quarantined_without_deleting_its_provider_identity() {
    let valid: GoogleEvent = serde_json::from_value(serde_json::json!({
        "id": "valid-provider-event",
        "iCalUID": "valid@example.com",
        "start": {"dateTime": "2026-07-24T14:00:00Z"},
        "end": {"dateTime": "2026-07-24T15:00:00Z"}
    }))
    .unwrap();
    let malformed: GoogleEvent = serde_json::from_value(serde_json::json!({
        "id": "malformed-provider-event",
        "iCalUID": "malformed@example.com",
        "start": {"dateTime": "2026-07-24T14:00:00Z"}
    }))
    .unwrap();
    let starts_at = DateTime::parse_from_rfc3339("2026-07-01T00:00:00Z")
        .unwrap()
        .with_timezone(&Utc);
    let ends_at = DateTime::parse_from_rfc3339("2026-08-01T00:00:00Z")
        .unwrap()
        .with_timezone(&Utc);
    let context = GoogleEventSyncContext {
        owner_id: "macro|quarantine@example.com".to_string(),
        email_link_id: Uuid::now_v7(),
        account_id: Uuid::now_v7(),
        calendar_id: Uuid::now_v7(),
        provider_calendar_id: "primary".to_string(),
        is_read_only: false,
        range: OccurrenceRange {
            starts_at,
            ends_at,
            start_date: starts_at.date_naive(),
            end_date: ends_at.date_naive(),
        },
        sync_token: Some("token".to_string()),
        plan: GoogleSyncPlan::FullSnapshot,
    };

    let mapped = map_snapshot(&context, vec![valid, malformed], Vec::new());

    assert_eq!(mapped.upserts.len(), 1);
    assert_eq!(
        mapped.observed_provider_event_ids,
        vec![
            "malformed-provider-event".to_string(),
            "valid-provider-event".to_string()
        ]
    );
}

#[test]
fn quota_forbidden_response_is_retryable() {
    let error = provider_response_error(
        StatusCode::FORBIDDEN,
        r#"{"error":{"message":"Quota exceeded","errors":[{"reason":"userRateLimitExceeded"}]}}"#,
    );

    assert_eq!(error.kind(), GoogleProviderErrorKind::Transient);
}

#[test]
fn insufficient_permissions_require_reauthorization() {
    let error = provider_response_error(
        StatusCode::FORBIDDEN,
        r#"{"error":{"message":"Insufficient Permission","errors":[{"reason":"insufficientPermissions"}]}}"#,
    );

    assert_eq!(error.kind(), GoogleProviderErrorKind::ReauthRequired);
}

#[test]
fn expired_sync_token_requests_a_full_resync() {
    let error = provider_response_error(
        StatusCode::GONE,
        r#"{"error":{"message":"Sync token is no longer valid","errors":[{"reason":"fullSyncRequired"}]}}"#,
    );

    assert_eq!(error.kind(), GoogleProviderErrorKind::SyncTokenExpired);
}

#[test]
fn rejected_access_token_is_retryable_with_a_fresh_token() {
    let error = provider_response_error(
        StatusCode::UNAUTHORIZED,
        r#"{"error":{"message":"Invalid Credentials","errors":[{"reason":"authError"}]}}"#,
    );

    assert_eq!(error.kind(), GoogleProviderErrorKind::Transient);
}

#[test]
fn unrelated_forbidden_response_is_permanent() {
    let error = provider_response_error(
        StatusCode::FORBIDDEN,
        r#"{"error":{"message":"Forbidden","errors":[{"reason":"forbidden"}]}}"#,
    );

    assert_eq!(error.kind(), GoogleProviderErrorKind::Permanent);
}
