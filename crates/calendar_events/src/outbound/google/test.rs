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

#[test]
fn cancelled_single_events_become_tombstones() {
    let cancelled: GoogleEvent = serde_json::from_value(serde_json::json!({
        "id": "gone-event",
        "status": "cancelled"
    }))
    .unwrap();

    let classified = classify_changes(vec![cancelled]);

    assert!(
        classified
            .tombstoned_provider_event_ids
            .contains("gone-event")
    );
    assert!(classified.refresh_masters.is_empty());
    assert!(classified.single_upserts.is_empty());
}

#[test]
fn exception_changes_refresh_their_series() {
    let cancelled_instance: GoogleEvent = serde_json::from_value(serde_json::json!({
        "id": "master_20260724T140000Z",
        "status": "cancelled",
        "recurringEventId": "master",
        "originalStartTime": {"dateTime": "2026-07-24T14:00:00Z"}
    }))
    .unwrap();
    let modified_instance: GoogleEvent = serde_json::from_value(serde_json::json!({
        "id": "other_20260725T140000Z",
        "iCalUID": "other@example.com",
        "recurringEventId": "other",
        "originalStartTime": {"dateTime": "2026-07-25T14:00:00Z"},
        "start": {"dateTime": "2026-07-25T15:00:00Z"},
        "end": {"dateTime": "2026-07-25T16:00:00Z"}
    }))
    .unwrap();

    let classified = classify_changes(vec![cancelled_instance, modified_instance]);

    assert!(classified.tombstoned_provider_event_ids.is_empty());
    assert_eq!(classified.refresh_masters.len(), 2);
    assert!(matches!(
        classified.refresh_masters.get("master"),
        Some(None)
    ));
    assert!(matches!(
        classified.refresh_masters.get("other"),
        Some(None)
    ));
}

#[test]
fn feed_master_payload_survives_exception_placeholders_in_any_order() {
    let master = serde_json::json!({
        "id": "master",
        "iCalUID": "series@example.com",
        "recurrence": ["RRULE:FREQ=DAILY"],
        "start": {"dateTime": "2026-07-24T14:00:00Z"},
        "end": {"dateTime": "2026-07-24T15:00:00Z"}
    });
    let exception = serde_json::json!({
        "id": "master_20260724T140000Z",
        "status": "cancelled",
        "recurringEventId": "master"
    });

    for changes in [
        vec![master.clone(), exception.clone()],
        vec![exception, master],
    ] {
        let changes: Vec<GoogleEvent> = changes
            .into_iter()
            .map(|value| serde_json::from_value(value).unwrap())
            .collect();
        let classified = classify_changes(changes);
        assert!(matches!(
            classified.refresh_masters.get("master"),
            Some(Some(payload)) if payload.ical_uid == "series@example.com"
        ));
    }
}

#[test]
fn plain_changed_events_map_directly_from_the_feed() {
    let singleton: GoogleEvent = serde_json::from_value(serde_json::json!({
        "id": "plain-event",
        "iCalUID": "plain@example.com",
        "summary": "Moved meeting",
        "start": {"dateTime": "2026-07-24T14:00:00Z"},
        "end": {"dateTime": "2026-07-24T15:00:00Z"}
    }))
    .unwrap();

    let classified = classify_changes(vec![singleton]);

    assert!(classified.tombstoned_provider_event_ids.is_empty());
    assert!(classified.refresh_masters.is_empty());
    assert_eq!(classified.single_upserts.len(), 1);
    assert_eq!(classified.single_upserts[0].id, "plain-event");
}

#[test]
fn tail_planning_skips_series_and_singles_the_feed_already_handled() {
    let refreshed_instance: GoogleEvent = serde_json::from_value(serde_json::json!({
        "id": "refreshed_20280801T140000Z",
        "recurringEventId": "refreshed",
        "start": {"dateTime": "2028-08-01T14:00:00Z"},
        "end": {"dateTime": "2028-08-01T15:00:00Z"}
    }))
    .unwrap();
    let new_instance: GoogleEvent = serde_json::from_value(serde_json::json!({
        "id": "fresh_20280801T090000Z",
        "recurringEventId": "fresh",
        "start": {"dateTime": "2028-08-01T09:00:00Z"},
        "end": {"dateTime": "2028-08-01T10:00:00Z"}
    }))
    .unwrap();
    let tombstoned_instance: GoogleEvent = serde_json::from_value(serde_json::json!({
        "id": "gone_20280801T090000Z",
        "recurringEventId": "gone",
        "start": {"dateTime": "2028-08-01T09:00:00Z"},
        "end": {"dateTime": "2028-08-01T10:00:00Z"}
    }))
    .unwrap();
    let known_single: GoogleEvent = serde_json::from_value(serde_json::json!({
        "id": "known-single",
        "start": {"dateTime": "2028-08-02T09:00:00Z"},
        "end": {"dateTime": "2028-08-02T10:00:00Z"}
    }))
    .unwrap();
    let new_single: GoogleEvent = serde_json::from_value(serde_json::json!({
        "id": "new-single",
        "start": {"dateTime": "2028-08-03T09:00:00Z"},
        "end": {"dateTime": "2028-08-03T10:00:00Z"}
    }))
    .unwrap();

    let mut applied = AppliedChangeFeed::default();
    applied.refreshed_series.insert("refreshed".to_string());
    applied.cancelled.insert("gone".to_string());
    applied.upserted_singles.insert("known-single".to_string());

    let (series, singles) = plan_tail_refreshes(
        vec![
            refreshed_instance,
            new_instance.clone(),
            new_instance,
            tombstoned_instance,
            known_single,
            new_single,
        ],
        &applied,
    );

    assert_eq!(series.into_iter().collect::<Vec<_>>(), vec!["fresh"]);
    assert_eq!(
        singles
            .iter()
            .map(|event| event.id.as_str())
            .collect::<Vec<_>>(),
        vec!["new-single"]
    );
}

#[test]
fn only_the_snapshot_plan_or_a_reset_token_forces_a_full_rebuild() {
    let tail = GoogleSyncPlan::ExtendTail {
        from: DateTime::parse_from_rfc3339("2028-08-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc),
        from_date: NaiveDate::from_ymd_opt(2028, 8, 1).unwrap(),
    };

    assert!(needs_full_rebuild(
        &GoogleSyncPlan::FullSnapshot,
        true,
        false
    ));
    assert!(needs_full_rebuild(
        &GoogleSyncPlan::Incremental,
        false,
        false
    ));
    assert!(needs_full_rebuild(&GoogleSyncPlan::Incremental, true, true));
    assert!(!needs_full_rebuild(
        &GoogleSyncPlan::Incremental,
        true,
        false
    ));
    assert!(
        !needs_full_rebuild(&tail, true, false),
        "ExtendTail must reach the tail path, not the full rebuild"
    );
}
