use super::*;
use chrono::{TimeZone, Utc};
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{body_partial_json, header, method, path, query_param},
};

pub(super) fn target() -> ProviderCalendarTarget {
    let link_id = Uuid::now_v7();
    ProviderCalendarTarget {
        binding: Some(CalendarGrantBinding {
            link_id,
            sync_generation: 2,
            grant_generation: 3,
        }),
        provider: CalendarProvider::Outlook,
        owner_id: "macro|owner@example.com".into(),
        email_link_id: link_id,
        account_id: Uuid::now_v7(),
        calendar_id: Uuid::now_v7(),
        provider_calendar_id: "calendar".into(),
        observed_access_role: Some("owner".into()),
        is_read_only: false,
        range: OccurrenceRange {
            starts_at: Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap(),
            ends_at: Utc.with_ymd_and_hms(2027, 1, 1, 0, 0, 0).unwrap(),
            start_date: "2026-01-01".parse().unwrap(),
            end_date: "2027-01-01".parse().unwrap(),
        },
    }
}
pub(super) fn event(id: &str) -> Value {
    json!({"id":id,"@odata.etag":"W/\"1\"","iCalUId":format!("{id}@outlook"),"subject":"Meeting","type":"singleInstance","createdDateTime":"2026-01-01T10:00:00Z","lastModifiedDateTime":"2026-10-01T10:00:00Z","originalStartTimeZone":"Pacific Standard Time","start":{"dateTime":"2026-11-02T17:00:00.0000000","timeZone":"UTC"},"end":{"dateTime":"2026-11-02T18:00:00.0000000","timeZone":"UTC"},"isAllDay":false,"attendees":[]})
}
pub(super) async fn setup() -> (MockServer, OutlookApiClientRepository) {
    let server = MockServer::start().await;
    let api = OutlookApiClientRepository::for_test(&format!("{}/v1.0/", server.uri()));
    (server, api)
}
async fn serve_event(server: &MockServer, id: &str) {
    Mock::given(method("GET"))
        .and(path(format!("/v1.0/me/calendars/calendar/events/{id}")))
        .respond_with(ResponseTemplate::new(200).set_body_json(event(id)))
        .mount(server)
        .await;
}

#[tokio::test]
async fn calendar_cursor_never_sends_bearer_outside_graph_root() {
    let (server, api) = setup().await;
    for cursor in [
        "https://attacker.invalid/v1.0/me/calendarView/delta".into(),
        format!("{}/outside", server.uri()),
    ] {
        assert!(
            api.calendar_page("secret", &target(), true, Some(&cursor))
                .await
                .is_err()
        );
    }
    assert!(server.received_requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn primary_page_preserves_tombstones_and_terminal_cursor_for_durable_reconciliation() {
    let (server, api) = setup().await;
    let old = format!(
        "{}/v1.0/me/calendarView/delta?$deltatoken=old",
        server.uri()
    );
    let end = format!(
        "{}/v1.0/me/calendarView/delta?$deltatoken=complete%2Bopaque",
        server.uri()
    );
    Mock::given(method("GET")).and(path("/v1.0/me/calendarView/delta")).and(query_param("$deltatoken","old"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"value":[{"id":"old-instance","@removed":{"reason":"deleted"}},{"id":"new-instance","seriesMasterId":"series"}],"@odata.deltaLink":end}))).expect(1).mount(&server).await;
    let page = api
        .calendar_page("token", &target(), true, Some(&old))
        .await
        .unwrap();
    assert_eq!(page.removed, vec!["old-instance"]);
    assert_eq!(page.members, vec![("new-instance".into(), "series".into())]);
    assert_eq!(page.delta, Some(end));
}

#[tokio::test]
async fn secondary_calendars_use_complete_v1_views_and_follow_every_page() {
    let (server, api) = setup().await;
    let next = format!(
        "{}/v1.0/me/calendars/calendar/calendarView?$skiptoken=A%2BB%3D",
        server.uri()
    );
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars/calendar/calendarView"))
        .and(query_param("$top", "1000"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"value":[{"id":"one"}],"@odata.nextLink":next})),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars/calendar/calendarView"))
        .and(query_param("$skiptoken", "A+B="))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"value":[{"id":"two"}]})))
        .expect(1)
        .mount(&server)
        .await;
    let first = api
        .calendar_page("token", &target(), false, None)
        .await
        .unwrap();
    assert_eq!(first.members, vec![("one".into(), "one".into())]);
    assert_eq!(first.next.as_deref(), Some(next.as_str()));
    let last = api
        .calendar_page("token", &target(), false, first.next.as_deref())
        .await
        .unwrap();
    assert_eq!(last.members, vec![("two".into(), "two".into())]);
    assert!(last.next.is_none());
    assert!(last.delta.is_none());
}

#[test]
fn windows_zones_and_moved_exceptions_preserve_the_original_occurrence() {
    let mut master = event("master");
    master["type"] = json!("seriesMaster");
    master["recurrence"] = json!({"pattern":{"type":"weekly","interval":1,"daysOfWeek":["monday"],"firstDayOfWeek":"monday"},"range":{"type":"noEnd","startDate":"2026-11-02","recurrenceTimeZone":"Pacific Standard Time"}});
    let mut exception = event("instance");
    exception["type"] = json!("exception");
    exception["originalStart"] = json!("2026-11-02T17:00:00Z");
    exception["subject"] = json!("Moved meeting");
    exception["start"]["dateTime"] = json!("2026-11-03T18:00:00");
    exception["end"]["dateTime"] = json!("2026-11-03T19:00:00");
    let upsert = normalize::projection(&target(), master, vec![exception]).unwrap();
    assert_eq!(
        upsert.occurrences[0].recurrence_id.as_deref(),
        Some("2026-11-02T17:00:00+00:00")
    );
    assert_eq!(upsert.overrides[0].title.as_deref(), Some("Moved meeting"));
    assert!(
        matches!(upsert.event.time,EventTime::Timed{time_zone:Some(ref z),..} if z=="America/Los_Angeles")
    );
    let time = EventTime::Timed {
        starts_at: "2026-03-09T16:00:00Z".parse().unwrap(),
        ends_at: "2026-03-09T17:00:00Z".parse().unwrap(),
        time_zone: Some("America/Los_Angeles".into()),
    };
    assert_eq!(
        normalize::time_body(&time).unwrap().0["dateTime"],
        "2026-03-09T09:00:00"
    );
}

#[test]
fn all_day_utc_responses_keep_local_dates_across_dst() {
    let mut v = event("all-day");
    v["isAllDay"] = json!(true);
    v["start"]["dateTime"] = json!("2026-03-08T08:00:00");
    v["end"]["dateTime"] = json!("2026-03-09T07:00:00");
    assert_eq!(
        normalize::event_time(&v).unwrap(),
        EventTime::AllDay {
            start_date: "2026-03-08".parse().unwrap(),
            end_date: "2026-03-09".parse().unwrap()
        }
    );
}

#[test]
fn recurrence_rejects_lossy_rules_instead_of_dropping_parts() {
    let time = normalize::event_time(&event("e")).unwrap();
    for rule in [
        vec!["RRULE:FREQ=DAILY;BYHOUR=9,17".into()],
        vec!["RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15".into()],
        vec!["RRULE:FREQ=WEEKLY".into(), "EXDATE:20261201T170000Z".into()],
    ] {
        assert!(recurrence::to_graph(&rule, &time).is_err());
    }
    let pattern =
        recurrence::to_graph(&["RRULE:FREQ=MONTHLY;BYDAY=-1MO;COUNT=12".into()], &time).unwrap();
    assert_eq!(pattern["pattern"]["type"], "relativeMonthly");
    assert_eq!(pattern["pattern"]["index"], "last");
    assert_eq!(pattern["range"]["numberOfOccurrences"], 12);
}

#[tokio::test]
async fn edits_use_etags_and_keep_unrequested_provider_fields_untouched() {
    let (server, api) = setup().await;
    serve_event(&server, "event").await;
    Mock::given(method("PATCH"))
        .and(path("/v1.0/me/events/event"))
        .and(header("if-match", "W/\"1\""))
        .and(header("prefer", "IdType=\"ImmutableId\""))
        .and(body_partial_json(json!({"subject":"Changed"})))
        .respond_with(ResponseTemplate::new(200).set_body_json(event("event")))
        .expect(1)
        .mount(&server)
        .await;
    api.update_event(
        "token",
        &target(),
        "event",
        &CalendarEventPatch {
            title: Some("Changed".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let requests = server.received_requests().await.unwrap();
    let patch = requests
        .iter()
        .find(|r| r.method.as_str() == "PATCH")
        .unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&patch.body).unwrap(),
        json!({"subject":"Changed"})
    );
}

#[test]
fn provider_restrictions_are_explicit_and_extra_popup_reminders_round_trip() {
    let mut current = event("e");
    current["isOnlineMeeting"] = json!(true);
    assert!(
        patch_body(
            &CalendarEventPatch {
                conference: Some(ConferenceChange::Removed),
                ..Default::default()
            },
            Some(&current)
        )
        .is_err()
    );
    let reminders = EventReminders {
        use_default: false,
        overrides: vec![
            EventReminderOverride {
                method: "popup".into(),
                minutes: 10,
            },
            EventReminderOverride {
                method: "popup".into(),
                minutes: 30,
            },
        ],
    };
    let body = patch_body(
        &CalendarEventPatch {
            reminders: Some(reminders.clone()),
            ..Default::default()
        },
        Some(&current),
    )
    .unwrap();
    current["singleValueExtendedProperties"] = body["singleValueExtendedProperties"].clone();
    current["isReminderOn"] = body["isReminderOn"].clone();
    current["reminderMinutesBeforeStart"] = body["reminderMinutesBeforeStart"].clone();
    assert_eq!(
        normalize::projection(&target(), current, vec![])
            .unwrap()
            .event
            .reminders,
        reminders
    );
    assert_eq!(body["reminderMinutesBeforeStart"], 10);
    let email_reminder = patch_body(
        &CalendarEventPatch {
            reminders: Some(EventReminders {
                use_default: false,
                overrides: vec![EventReminderOverride {
                    method: "email".into(),
                    minutes: 10,
                }],
            }),
            ..Default::default()
        },
        None,
    )
    .unwrap();
    assert_eq!(email_reminder["isReminderOn"], false);
    let mut email_event = event("email-reminder");
    email_event["isReminderOn"] = email_reminder["isReminderOn"].clone();
    email_event["singleValueExtendedProperties"] =
        email_reminder["singleValueExtendedProperties"].clone();
    let restored = normalize::projection(&target(), email_event, vec![]).unwrap();
    assert_eq!(restored.event.reminders.overrides[0].method, "email");
}

#[tokio::test]
async fn retrying_an_acknowledged_creation_adopts_the_assigned_id_without_reinviting() {
    let (server, api) = setup().await;
    let target = target();
    let key = Uuid::now_v7();
    let correlation = creation_provider_id(key, &target.owner_id);
    let mut existing = event("microsoft-assigned-id");
    existing["transactionId"] = json!(correlation);
    let reads = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let counter = reads.clone();
    let found = existing.clone();
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars/calendar/events"))
        .respond_with(move |_: &wiremock::Request| {
            ResponseTemplate::new(200).set_body_json(
                if counter.fetch_add(1, std::sync::atomic::Ordering::SeqCst) == 0 {
                    json!({"value":[]})
                } else {
                    json!({"value":[found.clone()]})
                },
            )
        })
        .expect(2)
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/v1.0/me/calendars/calendar/events"))
        .and(body_partial_json(json!({"transactionId":correlation})))
        .respond_with(ResponseTemplate::new(201).set_body_json(existing.clone()))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path(
            "/v1.0/me/calendars/calendar/events/microsoft-assigned-id",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(existing))
        .expect(2)
        .mount(&server)
        .await;
    let draft = CalendarEventDraft {
        idempotency_key: Some(key),
        title: "Booking".into(),
        description: None,
        location: None,
        time: normalize::event_time(&event("e")).unwrap(),
        attendees: vec![],
        recurrence_lines: vec![],
        visibility: None,
        transparency: None,
        reminders: None,
        conference: None,
        out_of_office: None,
    };
    let first = api.create_event("token", &target, &draft).await.unwrap();
    let replay = api.create_event("token", &target, &draft).await.unwrap();
    assert_eq!(
        first.source.details().provider_event_id,
        "microsoft-assigned-id"
    );
    assert_eq!(
        first.source.details().provider_event_id,
        replay.source.details().provider_event_id
    );
}

#[tokio::test]
async fn cancelling_an_unacknowledged_booking_resolves_its_provider_assigned_id() {
    let (server, api) = setup().await;
    let target = target();
    let key = Uuid::now_v7();
    let correlation = creation_provider_id(key, &target.owner_id);
    let mut existing = event("assigned");
    existing["transactionId"] = json!(correlation);
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars/calendar/events"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"value":[existing]})))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/v1.0/me/events/assigned"))
        .and(header("if-match", "W/\"1\""))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(
        api.delete_created_event("token", &target, key)
            .await
            .unwrap(),
        vec!["assigned"]
    );
}

#[test]
fn native_reminder_edits_supersede_macro_extra_reminders() {
    let mut current = event("e");
    current["isReminderOn"] = json!(true);
    current["reminderMinutesBeforeStart"] = json!(60);
    current["singleValueExtendedProperties"] = json!([{"id":PREFERENCES_ID,"value":json!({"nativeReminderOn":true,"nativeReminderMinutes":10,"reminders":{"useDefault":false,"overrides":[{"method":"popup","minutes":10},{"method":"popup","minutes":30}]}}).to_string()}]);
    let reminders = normalize::projection(&target(), current, vec![])
        .unwrap()
        .event
        .reminders;
    assert_eq!(
        reminders.overrides,
        vec![EventReminderOverride {
            method: "popup".into(),
            minutes: 60
        }]
    );
}

#[test]
fn custom_zones_do_not_poison_timed_calendar_pages_and_sequence_tracks_invitation_updates() {
    let mut value = event("custom");
    value["originalStartTimeZone"] = json!("tzone://Microsoft/Custom");
    value["singleValueExtendedProperties"] = json!([{"id":APPOINTMENT_SEQUENCE_ID,"value":"3"}]);
    let projection = normalize::projection(&target(), value, vec![]).unwrap();
    assert_eq!(projection.event.sequence, 3);
    assert!(
        matches!(projection.event.time,EventTime::Timed {time_zone:Some(ref zone),..} if zone=="Etc/UTC")
    );
}

#[test]
fn until_before_the_daily_start_excludes_that_whole_date() {
    let time = EventTime::Timed {
        starts_at: "2026-10-01T10:00:00Z".parse().unwrap(),
        ends_at: "2026-10-01T11:00:00Z".parse().unwrap(),
        time_zone: Some("UTC".into()),
    };
    for (until, date) in [
        ("20261005T090000Z", "2026-10-04"),
        ("20261005T100000Z", "2026-10-05"),
        ("20261005T110000Z", "2026-10-05"),
    ] {
        let value =
            recurrence::to_graph(&[format!("RRULE:FREQ=DAILY;UNTIL={until}")], &time).unwrap();
        assert_eq!(value["range"]["endDate"], date);
    }
}

#[test]
fn description_edits_and_clear_keep_the_provider_meeting_block() {
    let blob = "<div class=\"me-email-text\">Join <a href=\"https://teams.example/join\">meeting</a> PIN 123</div>";
    let current = json!({"isOnlineMeeting":true,"onlineMeeting":{"joinUrl":"https://teams.example/join"},"body":{"content":format!("<html><body><p>Old description</p>{blob}</body></html>")}});
    for description in ["<p>New description</p>", ""] {
        let body = patch_body(
            &CalendarEventPatch {
                description: Some(description.into()),
                ..Default::default()
            },
            Some(&current),
        )
        .unwrap();
        assert_eq!(body["body"]["content"], format!("{description}{blob}"));
    }
}

#[tokio::test]
async fn moved_event_is_absent_from_its_old_calendar_even_if_mailbox_id_survives() {
    let (server, api) = setup().await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/events/moved"))
        .respond_with(ResponseTemplate::new(200).set_body_json(event("moved")))
        .expect(0)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars/calendar/events/moved"))
        .respond_with(ResponseTemplate::new(404))
        .expect(1)
        .mount(&server)
        .await;
    assert!(
        api.refresh_calendar_event("token", &target(), "moved")
            .await
            .unwrap()
            .is_none()
    );
}

#[test]
fn automatic_decline_preferences_survive_reminder_edits_and_identical_retries() {
    let properties = OutOfOfficeProperties {
        auto_decline_mode: OutOfOfficeAutoDeclineMode::DeclineOnlyNewConflictingInvitations,
        decline_message: Some("I'm away".into()),
    };
    let patch = CalendarEventPatch {
        out_of_office: Some(properties.clone()),
        reminders: Some(EventReminders::default()),
        ..Default::default()
    };
    let body = patch_body(&patch, None).unwrap();
    let mut current = event("away");
    current["showAs"] = body["showAs"].clone();
    current["singleValueExtendedProperties"] = body["singleValueExtendedProperties"].clone();
    let policy = normalize::projection(&target(), current.clone(), vec![])
        .unwrap()
        .source
        .details()
        .automatic_decline
        .clone()
        .unwrap();
    assert_eq!(policy.properties, properties);
    let retried = patch_body(&patch, Some(&current)).unwrap();
    assert_eq!(
        retried["singleValueExtendedProperties"],
        body["singleValueExtendedProperties"]
    );
    let edited_reply = patch_body(
        &CalendarEventPatch {
            out_of_office: Some(OutOfOfficeProperties {
                auto_decline_mode: properties.auto_decline_mode,
                decline_message: Some("Updated away reply".into()),
            }),
            ..Default::default()
        },
        Some(&current),
    )
    .unwrap();
    let mut updated = current.clone();
    updated["singleValueExtendedProperties"] =
        edited_reply["singleValueExtendedProperties"].clone();
    let edited_policy = normalize::projection(&target(), updated, vec![])
        .unwrap()
        .source
        .details()
        .automatic_decline
        .clone()
        .unwrap();
    assert_eq!(edited_policy.enabled_at, policy.enabled_at);
    assert_eq!(edited_policy.id, policy.id);

    let changed_reminder = patch_body(
        &CalendarEventPatch {
            reminders: Some(EventReminders {
                use_default: false,
                overrides: vec![],
            }),
            ..Default::default()
        },
        Some(&current),
    )
    .unwrap();
    current["singleValueExtendedProperties"] =
        changed_reminder["singleValueExtendedProperties"].clone();
    assert_eq!(
        normalize::projection(&target(), current.clone(), vec![])
            .unwrap()
            .source
            .details()
            .automatic_decline
            .as_ref(),
        Some(&policy)
    );
    current["showAs"] = json!("busy");
    assert!(
        normalize::projection(&target(), current.clone(), vec![])
            .unwrap()
            .source
            .details()
            .automatic_decline
            .is_none()
    );
    let enabled_again = patch_body(&patch, Some(&current)).unwrap();
    current["showAs"] = enabled_again["showAs"].clone();
    current["singleValueExtendedProperties"] =
        enabled_again["singleValueExtendedProperties"].clone();
    let new_policy = normalize::projection(&target(), current, vec![])
        .unwrap()
        .source
        .details()
        .automatic_decline
        .clone()
        .unwrap();
    assert_ne!(new_policy.id, policy.id);
    assert!(new_policy.enabled_at >= policy.enabled_at);
}

#[tokio::test]
async fn automatic_decline_sends_the_custom_reply_once_without_replaying_a_server_failure() {
    use calendar_events::domain::outlook::automatic_decline::AutomaticDeclineProvider;
    let (server, api) = setup().await;
    Mock::given(method("POST"))
        .and(path(
            "/v1.0/me/calendars/calendar/events/invitation/decline",
        ))
        .and(body_partial_json(
            json!({"sendResponse":true,"comment":"Away until Monday"}),
        ))
        .respond_with(ResponseTemplate::new(503))
        .expect(1)
        .mount(&server)
        .await;
    assert!(
        api.decline_away_invitation("token", &target(), "invitation", Some("Away until Monday"))
            .await
            .is_err()
    );
}

#[test]
fn ordinary_outlook_recurrence_round_trips_in_the_shared_editor_shape() {
    for (pattern, expected) in [
        (
            json!({"type":"absoluteMonthly","interval":1,"dayOfMonth":2}),
            "RRULE:FREQ=MONTHLY;INTERVAL=1",
        ),
        (
            json!({"type":"absoluteYearly","interval":1,"dayOfMonth":2,"month":11}),
            "RRULE:FREQ=YEARLY;INTERVAL=1",
        ),
        (
            json!({"type":"relativeMonthly","interval":1,"daysOfWeek":["monday"],"index":"first"}),
            "RRULE:FREQ=MONTHLY;INTERVAL=1;BYDAY=1MO",
        ),
    ] {
        let mut current = event("series");
        current["recurrence"] = json!({"pattern":pattern,"range":{"type":"noEnd","startDate":"2026-11-02","recurrenceTimeZone":"America/Los_Angeles"}});
        let lines = recurrence::from_graph(&current).unwrap();
        assert_eq!(lines, vec![expected.to_owned()]);
        let body = recurrence::to_graph(&lines, &normalize::event_time(&current).unwrap()).unwrap();
        assert_eq!(body["pattern"], current["recurrence"]["pattern"]);
    }
}

#[test]
fn occurrence_preferences_override_or_inherit_series_reminders_and_decline_policy() {
    let policy = AutomaticDeclinePolicy {
        id: Uuid::now_v7(),
        enabled_at: Utc::now(),
        properties: OutOfOfficeProperties {
            auto_decline_mode: OutOfOfficeAutoDeclineMode::DeclineAllConflictingInvitations,
            decline_message: None,
        },
    };
    let mut master = event("series");
    master["showAs"] = json!("oof");
    master["isReminderOn"] = json!(false);
    master["singleValueExtendedProperties"] = json!([{"id":PREFERENCES_ID,"value":json!({
        "nativeReminderOn":false,"reminders":{"useDefault":false,"overrides":[{"method":"email","minutes":30}]},"automaticDecline":policy,
    }).to_string()}]);
    let mut instance = master.clone();
    instance["id"] = json!("exception");
    instance["type"] = json!("exception");
    instance["originalStart"] = json!("2026-11-02T17:00:00Z");
    instance["singleValueExtendedProperties"] = json!([]);
    let inherited =
        normalize::projection(&target(), master.clone(), vec![instance.clone()]).unwrap();
    assert_eq!(
        inherited.overrides[0].reminders.as_ref().unwrap(),
        &inherited.event.reminders
    );
    assert!(inherited.overrides[0].automatic_decline.is_none());
    let mut disabled = policy.clone();
    disabled.properties.auto_decline_mode = OutOfOfficeAutoDeclineMode::DeclineNone;
    instance["singleValueExtendedProperties"] = json!([{"id":PREFERENCES_ID,"value":json!({
        "nativeReminderOn":false,"reminders":{"useDefault":false,"overrides":[]},"automaticDecline":disabled,
    }).to_string()}]);
    let overridden = normalize::projection(&target(), master, vec![instance]).unwrap();
    assert!(
        overridden.overrides[0]
            .reminders
            .as_ref()
            .unwrap()
            .overrides
            .is_empty()
    );
    assert_eq!(
        overridden.overrides[0].automatic_decline.as_ref(),
        Some(&disabled)
    );
    assert_eq!(
        overridden.source.details().automatic_decline.as_ref(),
        Some(&policy)
    );
}
