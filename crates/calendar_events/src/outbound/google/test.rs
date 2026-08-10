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

    let target = GoogleCalendarTarget {
        owner_id: "macro|readonly@example.com".to_string(),
        email_link_id: Uuid::now_v7(),
        account_id: Uuid::now_v7(),
        calendar_id: Uuid::now_v7(),
        provider_calendar_id: "primary".to_string(),
        is_read_only: true,
        range,
    };
    let upsert = map_upsert(&target, master, Vec::new(), Vec::new()).unwrap();

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
    let target = GoogleCalendarTarget {
        owner_id: "macro|recurring@example.com".to_string(),
        email_link_id: Uuid::now_v7(),
        account_id: Uuid::now_v7(),
        calendar_id: Uuid::now_v7(),
        provider_calendar_id: "primary".to_string(),
        is_read_only: false,
        range,
    };

    let upsert = map_upsert(&target, master, Vec::new(), vec![malformed_instance]).unwrap();
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
    let target = GoogleCalendarTarget {
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
    };

    let mapped = map_snapshot(&target, vec![valid, malformed], Vec::new());

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

#[test]
fn truncation_rewrites_the_rrule_bound_and_keeps_other_lines() {
    let cutoff = EventStart::Timed(
        DateTime::parse_from_rfc3339("2026-08-12T09:00:00+00:00")
            .unwrap()
            .with_timezone(&Utc),
    );
    assert_eq!(
        truncate_recurrence_lines(
            &[
                "RRULE:FREQ=WEEKLY;COUNT=10;BYDAY=MO,FR".to_string(),
                "EXDATE;TZID=UTC:20260810T090000".to_string(),
            ],
            &cutoff,
        ),
        vec![
            "RRULE:FREQ=WEEKLY;BYDAY=MO,FR;UNTIL=20260812T085959Z".to_string(),
            "EXDATE;TZID=UTC:20260810T090000".to_string(),
        ]
    );

    let all_day_cutoff = EventStart::AllDay(NaiveDate::from_ymd_opt(2026, 8, 12).unwrap());
    assert_eq!(
        truncate_recurrence_lines(
            &["RRULE:FREQ=DAILY;UNTIL=20270101".to_string()],
            &all_day_cutoff,
        ),
        vec!["RRULE:FREQ=DAILY;UNTIL=20260811".to_string()]
    );
}

#[test]
fn occurrence_keys_parse_back_to_starts() {
    assert_eq!(
        parse_occurrence_start("2026-08-12T09:00:00+00:00"),
        Some(EventStart::Timed(
            DateTime::parse_from_rfc3339("2026-08-12T09:00:00Z")
                .unwrap()
                .with_timezone(&Utc)
        ))
    );
    assert_eq!(
        parse_occurrence_start("2026-08-12"),
        Some(EventStart::AllDay(
            NaiveDate::from_ymd_opt(2026, 8, 12).unwrap()
        ))
    );
    assert_eq!(parse_occurrence_start("not-a-start"), None);

    let master = EventStart::Timed(
        DateTime::parse_from_rfc3339("2026-08-04T09:00:00Z")
            .unwrap()
            .with_timezone(&Utc),
    );
    assert!(occurrence_is_after(
        &parse_occurrence_start("2026-08-05T09:00:00+00:00").unwrap(),
        &master
    ));
    assert!(!occurrence_is_after(
        &parse_occurrence_start("2026-08-04T09:00:00+00:00").unwrap(),
        &master
    ));
}

/// Google's out-of-office auto-decline leaves the master untouched and writes
/// the decline onto the exception instance, so the exception's attendee list
/// must survive mapping — it is the only record that the occurrence changed.
#[test]
fn exception_attendees_are_carried_onto_the_override() {
    let master: GoogleEvent = serde_json::from_value(serde_json::json!({
        "id": "provider-master",
        "iCalUID": "declined@example.com",
        "summary": "Prod Deploy",
        "start": {"dateTime": "2026-08-13T22:00:00Z", "timeZone": "UTC"},
        "end": {"dateTime": "2026-08-13T22:30:00Z", "timeZone": "UTC"},
        "recurrence": ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"],
        "attendees": [
            {"email": "self@example.com", "self": true, "responseStatus": "accepted"},
            {"email": "organizer@example.com", "organizer": true, "responseStatus": "accepted"}
        ],
        "created": "2026-05-18T22:00:00Z",
        "updated": "2026-05-18T22:00:00Z"
    }))
    .unwrap();
    let exception: GoogleEvent = serde_json::from_value(serde_json::json!({
        "id": "provider-master_20260814T220000Z",
        "iCalUID": "declined@example.com",
        "summary": "Prod Deploy",
        "recurringEventId": "provider-master",
        "originalStartTime": {"dateTime": "2026-08-14T22:00:00Z", "timeZone": "UTC"},
        "start": {"dateTime": "2026-08-14T22:00:00Z", "timeZone": "UTC"},
        "end": {"dateTime": "2026-08-14T22:30:00Z", "timeZone": "UTC"},
        "status": "confirmed",
        "attendees": [
            {
                "email": "self@example.com",
                "self": true,
                "responseStatus": "declined",
                "comment": "Declined because I am out of office"
            },
            {"email": "organizer@example.com", "organizer": true, "responseStatus": "accepted"}
        ],
        "created": "2026-05-18T22:00:00Z",
        "updated": "2026-08-10T14:48:00Z"
    }))
    .unwrap();
    let range = OccurrenceRange {
        starts_at: DateTime::parse_from_rfc3339("2026-08-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc),
        ends_at: DateTime::parse_from_rfc3339("2026-09-01T00:00:00Z")
            .unwrap()
            .with_timezone(&Utc),
        start_date: NaiveDate::from_ymd_opt(2026, 8, 1).unwrap(),
        end_date: NaiveDate::from_ymd_opt(2026, 9, 1).unwrap(),
    };
    let target = GoogleCalendarTarget {
        owner_id: "macro|self@example.com".to_string(),
        email_link_id: Uuid::now_v7(),
        account_id: Uuid::now_v7(),
        calendar_id: Uuid::now_v7(),
        provider_calendar_id: "primary".to_string(),
        is_read_only: false,
        range,
    };

    let upsert = map_upsert(&target, master, vec![exception], Vec::new()).unwrap();

    // The series answer is unchanged: only the one occurrence declined.
    let series_self = upsert
        .event
        .attendees
        .iter()
        .find(|attendee| attendee.is_self)
        .expect("the master carries a self attendee");
    assert_eq!(
        series_self.response_status,
        AttendeeResponseStatus::Accepted
    );

    let override_attendees = upsert.overrides[0]
        .attendees
        .as_ref()
        .expect("the exception carried an attendee list");
    let override_self = override_attendees
        .iter()
        .find(|attendee| attendee.is_self)
        .expect("the exception carries a self attendee");
    assert_eq!(
        override_self.response_status,
        AttendeeResponseStatus::Declined
    );
    assert_eq!(
        override_self.comment.as_deref(),
        Some("Declined because I am out of office")
    );
    // Every attendee survives, not just the one whose response changed.
    assert_eq!(override_attendees.len(), 2);
}

/// The RSVP patch must not replace the full attendee array: a concurrent
/// attendee change between our read and the patch would be silently undone.
/// `attendeesOmitted` marks the array partial so Google merges by email.
#[test]
fn rsvp_patch_updates_only_the_connected_attendee() {
    let self_attendee: GoogleAttendee = serde_json::from_value(serde_json::json!({
        "email": "self@example.com",
        "self": true,
        "responseStatus": "needsAction",
        "comment": "unrelated state that must survive"
    }))
    .unwrap();

    let body = rsvp_patch_body(&self_attendee, AttendeeResponseStatus::Declined);

    assert_eq!(body["attendeesOmitted"], serde_json::json!(true));
    let attendees = body["attendees"].as_array().unwrap();
    assert_eq!(attendees.len(), 1);
    assert_eq!(attendees[0]["email"], "self@example.com");
    assert_eq!(attendees[0]["responseStatus"], "declined");
    assert_eq!(attendees[0]["comment"], "unrelated state that must survive");
}

#[test]
fn reminders_round_trip_between_google_and_the_domain() {
    let master: GoogleEvent = serde_json::from_value(serde_json::json!({
        "id": "provider-event",
        "iCalUID": "alarms@example.com",
        "summary": "Alarmed",
        "start": {"dateTime": "2026-07-24T14:00:00Z", "timeZone": "UTC"},
        "end": {"dateTime": "2026-07-24T15:00:00Z", "timeZone": "UTC"},
        "reminders": {"useDefault": false, "overrides": [
            {"method": "popup", "minutes": 10},
            {"method": "email", "minutes": 60}
        ]},
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
    let target = GoogleCalendarTarget {
        owner_id: "macro|alarms@example.com".to_string(),
        email_link_id: Uuid::now_v7(),
        account_id: Uuid::now_v7(),
        calendar_id: Uuid::now_v7(),
        provider_calendar_id: "primary".to_string(),
        is_read_only: false,
        range,
    };

    let upsert = map_upsert(&target, master.clone(), Vec::new(), Vec::new()).unwrap();
    assert_eq!(
        upsert.event.reminders,
        EventReminders {
            use_default: false,
            overrides: vec![
                EventReminderOverride {
                    method: "popup".to_string(),
                    minutes: 10,
                },
                EventReminderOverride {
                    method: "email".to_string(),
                    minutes: 60,
                },
            ],
        },
    );

    // The raw payload keeps the field, so nothing is lost at ingestion.
    let CalendarEventSource::Google(source) = &upsert.source;
    assert_eq!(
        source.raw_payload["reminders"]["overrides"][0]["minutes"],
        serde_json::json!(10),
    );

    // An event without the field follows its calendar's defaults.
    let mut bare = master;
    bare.reminders = None;
    let upsert = map_upsert(&target, bare, Vec::new(), Vec::new()).unwrap();
    assert_eq!(upsert.event.reminders, EventReminders::default());
}

#[test]
fn mutation_bodies_serialize_reminders_in_google_shape() {
    let reminders = EventReminders {
        use_default: false,
        overrides: vec![EventReminderOverride {
            method: "popup".to_string(),
            minutes: 15,
        }],
    };
    let expected = serde_json::json!({
        "useDefault": false,
        "overrides": [{"method": "popup", "minutes": 15}],
    });

    let draft = CalendarEventDraft {
        title: "New".to_string(),
        description: None,
        location: None,
        time: EventTime::Timed {
            starts_at: DateTime::parse_from_rfc3339("2026-07-24T14:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
            ends_at: DateTime::parse_from_rfc3339("2026-07-24T15:00:00Z")
                .unwrap()
                .with_timezone(&Utc),
            time_zone: None,
        },
        attendees: Vec::new(),
        recurrence_lines: Vec::new(),
        visibility: None,
        transparency: None,
        reminders: Some(reminders.clone()),
    };
    assert_eq!(draft_body(&draft)["reminders"], expected);

    let patch = CalendarEventPatch {
        reminders: Some(reminders),
        ..CalendarEventPatch::default()
    };
    assert_eq!(patch_body(&patch)["reminders"], expected);
    assert_eq!(
        patch_body(&CalendarEventPatch::default())
            .as_object()
            .unwrap()
            .get("reminders"),
        None,
        "an untouched patch must not clobber provider reminders"
    );
}
