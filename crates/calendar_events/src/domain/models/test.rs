use super::*;
use chrono::TimeZone;

fn range(starts_at: DateTime<Utc>, ends_at: DateTime<Utc>) -> OccurrenceRange {
    OccurrenceRange {
        starts_at,
        ends_at,
        start_date: starts_at.date_naive(),
        end_date: ends_at.date_naive(),
    }
}

#[test]
fn materialized_range_accepts_supported_viewports() {
    let now = Utc.with_ymd_and_hms(2026, 7, 24, 12, 0, 0).unwrap();
    let viewport = range(
        now - chrono::Duration::days(30),
        now + chrono::Duration::days(30),
    );

    assert!(viewport.is_materialized_at(now));
}

#[test]
fn materialized_range_rejects_viewports_outside_the_sync_horizon() {
    let now = Utc.with_ymd_and_hms(2026, 7, 24, 12, 0, 0).unwrap();
    let too_old = range(
        now - chrono::Duration::days(366),
        now - chrono::Duration::days(360),
    );
    let too_far_ahead = range(
        now + chrono::Duration::days(725),
        now + chrono::Duration::days(731),
    );

    assert!(!too_old.is_materialized_at(now));
    assert!(!too_far_ahead.is_materialized_at(now));
}

#[test]
fn sync_plan_extends_only_the_uncovered_tail() {
    let now = Utc.with_ymd_and_hms(2026, 7, 25, 12, 0, 0).unwrap();
    let materialized = OccurrenceRange::historical_sync(now);
    let stored = StoredGoogleCalendar {
        id: Uuid::now_v7(),
        sync_token: Some("token".to_string()),
        materialized_range: Some(materialized.clone()),
        synced_at: None,
        watch_expires_at: None,
    };

    assert_eq!(
        stored.sync_plan(&OccurrenceRange::historical_sync(now)),
        GoogleSyncPlan::Incremental
    );
    assert_eq!(
        stored.sync_plan(&OccurrenceRange::historical_sync(
            now + chrono::Duration::hours(12)
        )),
        GoogleSyncPlan::ExtendTail {
            from: materialized.ends_at,
            from_date: materialized.end_date,
        }
    );

    let more_history = OccurrenceRange {
        starts_at: materialized.starts_at - chrono::Duration::days(1),
        ..materialized.clone()
    };
    assert_eq!(
        stored.sync_plan(&more_history),
        GoogleSyncPlan::FullSnapshot
    );

    let uninitialized = StoredGoogleCalendar {
        id: Uuid::now_v7(),
        sync_token: None,
        materialized_range: Some(materialized.clone()),
        synced_at: None,
        watch_expires_at: None,
    };
    assert_eq!(
        uninitialized.sync_plan(&OccurrenceRange::historical_sync(now)),
        GoogleSyncPlan::FullSnapshot
    );

    let unmaterialized = StoredGoogleCalendar {
        id: Uuid::now_v7(),
        sync_token: Some("token".to_string()),
        materialized_range: None,
        synced_at: None,
        watch_expires_at: None,
    };
    assert_eq!(
        unmaterialized.sync_plan(&OccurrenceRange::historical_sync(now)),
        GoogleSyncPlan::FullSnapshot
    );
}

#[test]
fn maintenance_horizon_is_stable_within_a_month_and_covers_reads() {
    let early = Utc.with_ymd_and_hms(2026, 7, 2, 8, 0, 0).unwrap();
    let late = Utc.with_ymd_and_hms(2026, 7, 30, 22, 0, 0).unwrap();
    let next_month = Utc.with_ymd_and_hms(2026, 8, 3, 8, 0, 0).unwrap();

    let horizon = OccurrenceRange::maintenance_horizon(early);
    assert_eq!(
        horizon.ends_at,
        OccurrenceRange::maintenance_horizon(late).ends_at
    );
    assert!(horizon.ends_at < OccurrenceRange::maintenance_horizon(next_month).ends_at);

    for now in [early, late, next_month] {
        let horizon = OccurrenceRange::maintenance_horizon(now);
        let readable = OccurrenceRange::historical_sync(now);
        assert!(horizon.starts_at <= readable.starts_at);
        assert!(horizon.start_date <= readable.start_date);
        assert!(horizon.ends_at >= readable.ends_at);
        assert!(horizon.end_date >= readable.end_date);
        assert!(horizon.is_valid_for_backfill());
    }
}

#[test]
fn event_time_serializes_nested_fields_as_camel_case() {
    let starts_at = Utc.with_ymd_and_hms(2026, 7, 24, 12, 0, 0).unwrap();
    let ends_at = Utc.with_ymd_and_hms(2026, 7, 24, 13, 0, 0).unwrap();

    let value = serde_json::to_value(EventTime::Timed {
        starts_at,
        ends_at,
        time_zone: Some("America/New_York".to_owned()),
    })
    .unwrap();

    assert_eq!(value["kind"], "timed");
    assert_eq!(value["startsAt"], "2026-07-24T12:00:00Z");
    assert_eq!(value["endsAt"], "2026-07-24T13:00:00Z");
    assert_eq!(value["timeZone"], "America/New_York");
    assert!(value.get("starts_at").is_none());
}

#[test]
fn default_reminders_stay_out_of_serialized_projections() {
    let starts_at = Utc.with_ymd_and_hms(2026, 8, 10, 14, 0, 0).unwrap();
    let mut event = CalendarEvent {
        id: uuid::Uuid::now_v7(),
        owner_id: "macro|projection@example.com".to_string(),
        ical_uid: "projection@example.com".to_string(),
        calendar_id: None,
        title: "Projection".to_string(),
        description: None,
        location: None,
        status: EventStatus::Confirmed,
        visibility: EventVisibility::Default,
        transparency: EventTransparency::Opaque,
        event_type: EventType::Default,
        time: EventTime::Timed {
            starts_at,
            ends_at: starts_at + chrono::Duration::hours(1),
            time_zone: None,
        },
        recurrence_lines: Vec::new(),
        organizer_email: None,
        organizer_name: None,
        creator_email: None,
        creator_name: None,
        conference_url: None,
        conference_provider: None,
        sequence: 0,
        is_read_only: false,
        attendees: Vec::new(),
        reminders: EventReminders::default(),
        created_at: starts_at,
        updated_at: starts_at,
    };

    // Projections stored before reminders were modeled have no `reminders`
    // key. Serializing the default as nothing keeps them comparing equal to
    // fresh normalizations, so full snapshots stay no-ops. The same holds
    // for creator fields and the event type added later.
    let serialized = serde_json::to_value(&event).unwrap();
    assert!(serialized.get("reminders").is_none());
    assert!(serialized.get("creatorEmail").is_none());
    assert!(serialized.get("creatorName").is_none());
    assert!(serialized.get("eventType").is_none());
    let legacy: CalendarEvent = serde_json::from_value(serialized).unwrap();
    assert_eq!(legacy.reminders, EventReminders::default());
    assert_eq!(legacy.event_type, EventType::Default);

    event.event_type = EventType::WorkingLocation;
    let serialized = serde_json::to_value(&event).unwrap();
    assert_eq!(serialized["eventType"], "working_location");
    let status_event: CalendarEvent = serde_json::from_value(serialized).unwrap();
    assert_eq!(status_event.event_type, EventType::WorkingLocation);
    event.event_type = EventType::Default;

    event.reminders = EventReminders {
        use_default: false,
        overrides: vec![EventReminderOverride {
            method: REMINDER_METHOD_POPUP.to_string(),
            minutes: 10,
        }],
    };
    let serialized = serde_json::to_value(&event).unwrap();
    assert_eq!(serialized["reminders"]["useDefault"], false);
    let explicit: CalendarEvent = serde_json::from_value(serialized).unwrap();
    assert_eq!(explicit.reminders, event.reminders);
}

#[test]
fn popup_minutes_resolve_defaults_and_deduplicate() {
    let defaults = vec![
        EventReminderOverride {
            method: REMINDER_METHOD_POPUP.to_string(),
            minutes: 30,
        },
        EventReminderOverride {
            method: REMINDER_METHOD_EMAIL.to_string(),
            minutes: 60,
        },
    ];

    assert_eq!(EventReminders::default().popup_minutes(&defaults), vec![30]);

    let explicit = EventReminders {
        use_default: false,
        overrides: vec![
            EventReminderOverride {
                method: REMINDER_METHOD_POPUP.to_string(),
                minutes: 10,
            },
            EventReminderOverride {
                method: REMINDER_METHOD_POPUP.to_string(),
                minutes: 10,
            },
            EventReminderOverride {
                method: REMINDER_METHOD_EMAIL.to_string(),
                minutes: 5,
            },
        ],
    };
    assert_eq!(explicit.popup_minutes(&defaults), vec![10]);
    assert_eq!(
        EventReminders {
            use_default: false,
            overrides: Vec::new(),
        }
        .popup_minutes(&defaults),
        Vec::<u32>::new(),
        "explicitly no reminders resolves to nothing even with defaults"
    );
}
