use super::super::test::{event, setup, target};
use super::*;
use wiremock::{
    Mock, ResponseTemplate,
    matchers::{header, method, path, query_param},
};

fn organized(id: &str) -> Value {
    let mut value = event(id);
    value["isOrganizer"] = json!(true);
    value["attendees"] = json!([{"emailAddress":{"address":"guest@example.com"},"type":"optional","status":{"response":"accepted"}}]);
    value["webLink"] = json!(format!("https://outlook.office.com/calendar/item/{id}"));
    value
}
#[test]
fn replacement_preserves_local_time_content_and_guest_type_but_removes_old_conference_and_rsvps() {
    let mut source = organized("old");
    source["isOnlineMeeting"] = json!(true);
    source["onlineMeetingProvider"] = json!("teamsForBusiness");
    source["onlineMeeting"] = json!({"joinUrl":"https://teams.microsoft.com/meet/old?a=1&b=2"});
    source["body"] = json!({"contentType":"html","content":"<p>Agenda</p><div class=\"me-email-text\"><a href=\"https://teams.microsoft.com/meet/old?a=1&amp;b=2\">Join old meeting</a><p>Meeting ID 456. PIN 123.</p><a href=\"tel:+12345\">Dial in</a><a href=\"https://teams.microsoft.com/options/old\">Options</a></div><p>Keep these notes</p>"});
    source["categories"] = json!(["Work"]);
    source["showAs"] = json!("oof");
    source["singleValueExtendedProperties"] =
        json!([{"id":PREFERENCES_ID,"value":"{\"reminders\":{\"overrides\":[]}}"}]);
    let body = copy_body(&source, true).unwrap();
    assert_eq!(body["start"]["dateTime"], "2026-11-02T09:00:00");
    assert_eq!(body["start"]["timeZone"], "America/Los_Angeles");
    assert_eq!(body["attendees"][0]["type"], "optional");
    assert!(body["attendees"][0].get("status").is_none());
    assert_eq!(
        body["body"]["content"],
        "<p>Agenda</p><p>Keep these notes</p>"
    );
    assert!(body.get("isOnlineMeeting").is_none());
    assert_eq!(body["categories"], source["categories"]);
    assert_eq!(body["showAs"], source["showAs"]);
    assert_eq!(
        marker(&body, PREFERENCES_ID),
        marker(&source, PREFERENCES_ID)
    );
    assert_eq!(copy_body(&source, false).unwrap()["isOnlineMeeting"], true);
}
#[test]
fn provider_links_are_https_on_exact_microsoft_hosts() {
    for url in [
        "https://outlook.office.com/calendar/item/e",
        "https://outlook.live.com/owa/?itemid=e",
    ] {
        assert!(safe_event_url(&json!({"webLink":url})).is_some());
    }
    for url in [
        "javascript:alert(1)",
        "https://outlook.office.com.evil.test/e",
        "https://name@outlook.office.com/e",
        "http://outlook.office.com/e",
    ] {
        assert!(safe_event_url(&json!({"webLink":url})).is_none());
    }
}
#[tokio::test]
async fn uncertain_create_is_only_read_back_never_reposted() {
    let (server, api) = setup().await;
    let target = target();
    let key = "stable";
    Mock::given(method("POST"))
        .and(path("/v1.0/me/calendars/calendar/events"))
        .respond_with(ResponseTemplate::new(503))
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars/calendar/events"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"value":[]})))
        .expect(2)
        .mount(&server)
        .await;
    let command = json!({"kind":"create","key":key,"body":{"transactionId":key}});
    assert!(
        api.apply_replacement_write("token", &target, &command, true)
            .await
            .is_err()
    );
    for _ in 0..2 {
        assert!(matches!(
            api.apply_replacement_write("token", &target, &command, false)
                .await
                .unwrap(),
            ReplacementWriteOutcome::Unconfirmed
        ));
    }
}
#[tokio::test]
async fn definite_throttle_is_retriable_but_existing_marker_recovers_without_a_post() {
    let (server, api) = setup().await;
    let target = target();
    let key = "stable";
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(429))
        .expect(1)
        .mount(&server)
        .await;
    let command = json!({"kind":"create","key":key,"body":{"transactionId":key}});
    assert!(matches!(
        api.apply_replacement_write("token", &target, &command, true)
            .await
            .unwrap(),
        ReplacementWriteOutcome::Rejected(_)
    ));
    let mut created = organized("new");
    created["transactionId"] = json!(key);
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars/calendar/events"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"value":[created.clone()]})))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars/calendar/events/new"))
        .respond_with(ResponseTemplate::new(200).set_body_json(created))
        .mount(&server)
        .await;
    assert!(
        matches!(api.apply_replacement_write("token",&target,&command,false).await.unwrap(),ReplacementWriteOutcome::Applied(Some(id)) if id=="new")
    );
}
#[tokio::test]
async fn cancellation_is_conditional_and_missing_original_is_idempotent() {
    let (server, api) = setup().await;
    let target = target();
    let source = organized("old");
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars/calendar/events/old"))
        .respond_with(ResponseTemplate::new(200).set_body_json(&source))
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .and(path("/v1.0/me/events/old"))
        .and(header("If-Match", "W/\"1\""))
        .respond_with(ResponseTemplate::new(204))
        .expect(1)
        .mount(&server)
        .await;
    assert!(matches!(
        api.apply_replacement_write(
            "token",
            &target,
            &json!({"kind":"delete","source":source}),
            false
        )
        .await
        .unwrap(),
        ReplacementWriteOutcome::Applied(None)
    ));
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars/calendar/events/gone"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;
    assert!(matches!(
        api.apply_replacement_write(
            "token",
            &target,
            &json!({"kind":"delete","source":organized("gone")}),
            false
        )
        .await
        .unwrap(),
        ReplacementWriteOutcome::Applied(None)
    ));
}
#[tokio::test]
async fn external_edits_or_a_removed_replacement_never_cancel_the_original() {
    let (server, api) = setup().await;
    let target = target();
    let source = organized("old");
    let mut changed = source.clone();
    changed["@odata.etag"] = json!("new-version");
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars/calendar/events/old"))
        .respond_with(ResponseTemplate::new(200).set_body_json(changed))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars/calendar/events/new"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;
    Mock::given(method("DELETE"))
        .respond_with(ResponseTemplate::new(204))
        .expect(0)
        .mount(&server)
        .await;
    assert!(
        api.apply_replacement_write(
            "token",
            &target,
            &json!({"kind":"delete","source":source}),
            false
        )
        .await
        .is_err()
    );
    assert!(
        api.apply_replacement_write(
            "token",
            &target,
            &json!({"kind":"delete","source":source,"replacementId":"new"}),
            false
        )
        .await
        .is_err()
    );
}
#[tokio::test]
async fn applied_exception_marker_prevents_resending_updates_even_after_an_external_edit() {
    let (server, api) = setup().await;
    let target = target();
    let mut current = organized("instance");
    current["@odata.etag"] = json!("external-edit");
    add_marker(&mut current, STEP_ID, "operation:1");
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars/calendar/events/instance"))
        .respond_with(ResponseTemplate::new(200).set_body_json(current))
        .mount(&server)
        .await;
    Mock::given(method("PATCH"))
        .respond_with(ResponseTemplate::new(200))
        .expect(0)
        .mount(&server)
        .await;
    assert!(matches!(
        api.apply_replacement_write(
            "token",
            &target,
            &json!({"kind":"patch","source":organized("instance"),"key":"operation:1"}),
            false
        )
        .await
        .unwrap(),
        ReplacementWriteOutcome::Applied(None)
    ));
}
#[tokio::test]
async fn series_preview_includes_exceptions_and_cancellations_outside_the_sync_horizon() {
    let (server, api) = setup().await;
    let target = target();
    let mut master = organized("master");
    master["type"] = json!("seriesMaster");
    master["recurrence"] = json!({"pattern":{"type":"daily","interval":1},"range":{"type":"noEnd","startDate":"2026-11-02"}});
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars/calendar/events/master"))
        .respond_with(ResponseTemplate::new(200).set_body_json(&master))
        .with_priority(10)
        .mount(&server)
        .await;
    Mock::given(method("GET")).and(path("/v1.0/me/calendars/calendar/events/master"))
        .and(query_param("$select","id,exceptionOccurrences,cancelledOccurrences"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"@odata.etag":"W/\"1\"","exceptionOccurrences":[{"id":"future","occurrenceId":"OID.master.2030-04-30"}],"cancelledOccurrences":["OID.master.2031-05-07"]}))).with_priority(1).mount(&server).await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars/calendar/events/future"))
        .respond_with(ResponseTemplate::new(200).set_body_json(organized("future")))
        .mount(&server)
        .await;
    let snapshot = api
        .inspect_replacement(
            "token",
            &target,
            "master",
            None,
            true,
            &CalendarEventPatch::default(),
        )
        .await
        .unwrap();
    assert_eq!(snapshot.occurrences.len(), 2);
    assert_eq!(snapshot.occurrences[0]["date"], "2030-04-30");
    assert_eq!(snapshot.occurrences[1]["date"], "2031-05-07");
    assert_eq!(snapshot.occurrences[1]["cancelled"], true);
    assert!(snapshot.is_series);
    assert!(
        !server
            .received_requests()
            .await
            .unwrap()
            .iter()
            .any(|r| r.method.as_str() != "GET")
    );
}

#[tokio::test]
async fn moved_exception_preview_and_outlook_link_follow_original_identity_outside_window() {
    let (server, api) = setup().await;
    let target = target();
    let mut master = organized("master");
    master["type"] = json!("seriesMaster");
    let mut moved = organized("moved");
    moved["type"] = json!("exception");
    moved["originalStart"] = json!("2026-11-02T17:00:00Z");
    moved["start"]["dateTime"] = json!("2026-12-02T17:00:00");
    moved["end"]["dateTime"] = json!("2026-12-02T18:00:00");
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars/calendar/events/master"))
        .respond_with(ResponseTemplate::new(200).set_body_json(&master))
        .with_priority(10)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars/calendar/events/master"))
        .and(query_param(
            "$select",
            "id,exceptionOccurrences,cancelledOccurrences",
        ))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            json!({"@odata.etag":"W/\"1\"","exceptionOccurrences":[],"cancelledOccurrences":[],
            "exceptionOccurrences@odata.nextLink":format!("{}/v1.0/exception-page",server.uri())}),
        ))
        .with_priority(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1.0/exception-page"))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            json!({"value":[{"id":"moved","occurrenceId":"OID.master.2026-11-02"}]}),
        ))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars/calendar/events/moved"))
        .respond_with(ResponseTemplate::new(200).set_body_json(&moved))
        .mount(&server)
        .await;
    let original = normalize::original(&moved)
        .unwrap()
        .unwrap()
        .occurrence_key();
    let preview = api
        .inspect_replacement(
            "token",
            &target,
            "master",
            Some(&original),
            true,
            &CalendarEventPatch::default(),
        )
        .await
        .unwrap();
    assert_eq!(preview.source_id, "moved");
    assert!(!preview.is_series);
    assert!(preview.occurrences.is_empty());
    assert_eq!(
        api.event_url("token", &target, "master", Some(&original))
            .await
            .unwrap(),
        Some("https://outlook.office.com/calendar/item/moved".into())
    );
    assert!(
        !server
            .received_requests()
            .await
            .unwrap()
            .iter()
            .any(|r| r.url.path().ends_with("instances"))
    );
}

#[tokio::test]
async fn copied_exception_preserves_the_new_teams_block_without_old_credentials() {
    let (server, api) = setup().await;
    let target = target();
    let mut current = organized("new-instance");
    let new_blob = "<div class=\"me-email-text\">Microsoft Teams <a href=\"https://teams.microsoft.com/new\">Join</a> NEW PIN 999</div>";
    current["isOnlineMeeting"] = json!(true);
    current["onlineMeeting"] = json!({"joinUrl":"https://teams.microsoft.com/new"});
    current["body"] = json!({"contentType":"html","content":format!("<p>Master notes</p>{new_blob}<p>Master-only trailing note</p>")});
    Mock::given(method("GET"))
        .and(path("/v1.0/me/events/new-master/instances"))
        .respond_with(ResponseTemplate::new(200).set_body_json(
            json!({"value":[{"id":"new-instance","occurrenceId":"OID.new-master.2026-11-02"}]}),
        ))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars/calendar/events/new-instance"))
        .respond_with(ResponseTemplate::new(200).set_body_json(current))
        .mount(&server)
        .await;
    let operation = CalendarReplacement {
        id: Uuid::now_v7(),
        user_id: target.owner_id.clone(),
        calendar_id: target.calendar_id,
        event_id: Uuid::now_v7(),
        master_id: "old-master".into(),
        recurrence_id: None,
        snapshot: ReplacementSnapshot {
            source_id: "old-master".into(),
            is_organizer: true,
            title: "Meeting".into(),
            time: normalize::event_time(&organized("old-master")).unwrap(),
            attendee_count: 1,
            is_series: true,
            remove_conference: false,
            provider_url: None,
            payload: json!({}),
            occurrences: vec![
                json!({"date":"2026-11-02","body":{"body":{"contentType":"html","content":"<p>Exception notes</p>"}}}),
            ],
        },
        next_step: 1,
        command: None,
        replacement_provider_id: Some("new-master".into()),
        result: None,
    };
    let command = api
        .prepare_replacement_write("token", &target, &operation)
        .await
        .unwrap();
    assert_eq!(
        command["body"]["body"]["content"],
        format!("<p>Exception notes</p>{new_blob}")
    );
}

#[test]
fn unrecognized_conference_content_fails_before_copying_a_meeting() {
    let mut source = organized("old");
    source["isOnlineMeeting"] = json!(true);
    source["onlineMeeting"] = json!({"joinUrl":"https://teams.microsoft.com/old"});
    source["body"] = json!({"contentType":"html","content":"<p>User notes</p><section><a href=\"https://teams.microsoft.com/old\">Join</a> PIN 123</section>"});
    assert!(copy_body(&source, true).is_err());
}

#[test]
fn conference_removal_preserves_notes_in_an_ordinary_outer_wrapper() {
    let mut source = organized("old");
    source["isOnlineMeeting"] = json!(true);
    source["onlineMeeting"] = json!({"joinUrl":"https://teams.microsoft.com/old"});
    source["body"] = json!({"contentType":"html","content":"<div><div class=\"me-email-text\">Microsoft Teams <a href=\"https://teams.microsoft.com/old\">Join</a> PIN 123</div><p>Keep these notes</p></div>"});
    assert_eq!(
        copy_body(&source, true).unwrap()["body"]["content"],
        "<div><p>Keep these notes</p></div>"
    );
}

const JOIN: &str = "https://teams.microsoft.com/meet/old?a=1&b=2";

fn teams_meeting(id: &str) -> Value {
    let mut source = organized(id);
    source["isOnlineMeeting"] = json!(true);
    source["onlineMeetingProvider"] = json!("teamsForBusiness");
    source["onlineMeeting"] = json!({"joinUrl":JOIN});
    source["location"] = json!({"displayName":"Room 1"});
    source["locations"] = json!([{"displayName":"Room 1"}]);
    source["body"] = json!({"contentType":"html","content":"<p>Agenda</p><div class=\"me-email-text\"><div><span>Microsoft Teams meeting</span></div><div><a href=\"https://teams.microsoft.com/meet/old?a=1&amp;b=2\">Join the meeting now</a></div><div><span>Meeting ID: 456</span></div></div>"});
    source
}

#[tokio::test]
async fn unsaved_changes_ride_in_the_preview_and_the_new_invitation_without_the_old_meeting() {
    let (server, api) = setup().await;
    let target = target();
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars/calendar/events/old"))
        .respond_with(ResponseTemplate::new(200).set_body_json(teams_meeting("old")))
        .mount(&server)
        .await;
    let time = EventTime::Timed {
        starts_at: "2026-11-23T18:00:00Z".parse().unwrap(),
        ends_at: "2026-11-23T18:30:00Z".parse().unwrap(),
        time_zone: Some("America/New_York".into()),
    };
    // The description as Macro's editor exports it, the Teams block flattened.
    let changes = CalendarEventPatch {
        title: Some("Q4 design review".into()),
        description: Some("<p>New agenda</p><p>Microsoft Teams meeting</p><p><a href=\"https://teams.microsoft.com/meet/old?a=1&amp;b=2\">Join the meeting now</a></p><p>Meeting ID: 456</p>".into()),
        location: Some("Room 2".into()),
        time: Some(time.clone()),
        attendees: Some(vec![
            CalendarAttendeeInput {
                email: "ada@example.com".into(),
                is_optional: false,
                response_status: None,
            },
            CalendarAttendeeInput {
                email: "grace@example.com".into(),
                is_optional: true,
                response_status: None,
            },
        ]),
        ..CalendarEventPatch::default()
    };

    let snapshot = api
        .inspect_replacement("token", &target, "old", None, true, &changes)
        .await
        .unwrap();

    assert_eq!(snapshot.title, "Q4 design review");
    assert_eq!(snapshot.time, time);
    assert_eq!(snapshot.attendee_count, 2);
    let body = &snapshot.payload["body"];
    assert_eq!(body["subject"], "Q4 design review");
    assert_eq!(body["body"]["content"], "<p>New agenda</p>");
    assert_eq!(body["location"]["displayName"], "Room 2");
    assert!(body.get("locations").is_none());
    assert_eq!(body["start"]["dateTime"], "2026-11-23T13:00:00");
    assert_eq!(body["start"]["timeZone"], "America/New_York");
    assert_eq!(
        body["attendees"][1]["emailAddress"]["address"],
        "grace@example.com"
    );
    assert_eq!(body["attendees"][1]["type"], "optional");
    assert!(body.get("isOnlineMeeting").is_none());
    // Nothing the replacement copy and an Outlook update do not already send.
    let sent = [
        "subject",
        "body",
        "location",
        "locations",
        "categories",
        "sensitivity",
        "showAs",
        "importance",
        "isAllDay",
        "isReminderOn",
        "reminderMinutesBeforeStart",
        "responseRequested",
        "allowNewTimeProposals",
        "hideAttendees",
        "recurrence",
        "start",
        "end",
        "attendees",
        "singleValueExtendedProperties",
    ];
    for field in body.as_object().unwrap().keys() {
        assert!(sent.contains(&field.as_str()), "{field}");
    }
    assert!(
        !server
            .received_requests()
            .await
            .unwrap()
            .iter()
            .any(|r| r.method.as_str() != "GET")
    );
}

fn series(id: &str) -> Value {
    let mut master = teams_meeting(id);
    master["type"] = json!("seriesMaster");
    master["recurrence"] = json!({"pattern":{"type":"daily","interval":1},"range":{"type":"noEnd","startDate":"2026-11-02"}});
    master
}

#[tokio::test]
async fn a_series_schedule_change_drops_its_copied_occurrences_without_reading_them() {
    let (server, api) = setup().await;
    let target = target();
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars/calendar/events/master"))
        .respond_with(ResponseTemplate::new(200).set_body_json(series("master")))
        .with_priority(10)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars/calendar/events/master"))
        .and(query_param(
            "$select",
            "id,exceptionOccurrences,cancelledOccurrences",
        ))
        .respond_with(ResponseTemplate::new(200))
        .with_priority(1)
        .expect(0)
        .mount(&server)
        .await;
    let changes = CalendarEventPatch {
        time: Some(EventTime::Timed {
            starts_at: "2026-11-02T18:00:00Z".parse().unwrap(),
            ends_at: "2026-11-02T19:00:00Z".parse().unwrap(),
            time_zone: Some("UTC".into()),
        }),
        ..CalendarEventPatch::default()
    };

    let snapshot = api
        .inspect_replacement("token", &target, "master", None, true, &changes)
        .await
        .unwrap();

    assert!(snapshot.is_series);
    assert!(snapshot.occurrences.is_empty());
    assert_eq!(snapshot.write_count(), 2);
    assert_eq!(
        snapshot.payload["body"]["recurrence"]["pattern"]["type"],
        "daily"
    );
}

#[tokio::test]
async fn occurrences_showing_the_series_value_take_its_edit_and_changed_ones_keep_theirs() {
    let (server, api) = setup().await;
    let target = target();
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars/calendar/events/master"))
        .respond_with(ResponseTemplate::new(200).set_body_json(series("master")))
        .with_priority(10)
        .mount(&server)
        .await;
    Mock::given(method("GET")).and(path("/v1.0/me/calendars/calendar/events/master"))
        .and(query_param("$select","id,exceptionOccurrences,cancelledOccurrences"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"@odata.etag":"W/\"1\"","exceptionOccurrences":[{"id":"same","occurrenceId":"OID.master.2026-11-03"},{"id":"own","occurrenceId":"OID.master.2026-11-04"}],"cancelledOccurrences":[]}))).with_priority(1).mount(&server).await;
    let mut same = teams_meeting("same");
    same["type"] = json!("exception");
    let mut own = teams_meeting("own");
    own["type"] = json!("exception");
    own["subject"] = json!("Moved standup");
    for occurrence in [same, own] {
        Mock::given(method("GET"))
            .and(path(format!(
                "/v1.0/me/calendars/calendar/events/{}",
                occurrence["id"].as_str().unwrap()
            )))
            .respond_with(ResponseTemplate::new(200).set_body_json(occurrence))
            .mount(&server)
            .await;
    }
    let changes = CalendarEventPatch {
        title: Some("Renamed".into()),
        ..CalendarEventPatch::default()
    };

    let snapshot = api
        .inspect_replacement("token", &target, "master", None, true, &changes)
        .await
        .unwrap();

    assert_eq!(snapshot.occurrences.len(), 2);
    assert_eq!(snapshot.occurrences[0]["body"]["subject"], "Renamed");
    assert_eq!(snapshot.occurrences[1]["body"]["subject"], "Moved standup");
    assert_eq!(
        snapshot.occurrences[0]["body"]["attendees"],
        snapshot.payload["body"]["attendees"]
    );
}

#[test]
fn series_guest_changes_reach_every_occurrence_even_with_its_own_list() {
    let guest = |address: &str| json!({"emailAddress":{"address":address},"type":"required"});
    let saved = json!({"attendees":[guest("ada@example.com"), guest("x@example.com")]});
    let edited = json!({"attendees":[guest("ada@example.com"), guest("new@example.com")]});
    let mut own_list = json!({"attendees":[guest("X@example.com"), guest("grace@example.com")]});

    inherit_changes(&mut own_list, &saved, &edited);

    assert_eq!(
        own_list["attendees"],
        json!([guest("grace@example.com"), guest("new@example.com")])
    );
}

#[tokio::test]
async fn a_series_moved_to_another_day_starts_its_repeat_rule_there() {
    let (server, api) = setup().await;
    let target = target();
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars/calendar/events/master"))
        .respond_with(ResponseTemplate::new(200).set_body_json(series("master")))
        .mount(&server)
        .await;
    let changes = CalendarEventPatch {
        time: Some(EventTime::Timed {
            starts_at: "2026-11-05T15:00:00Z".parse().unwrap(),
            ends_at: "2026-11-05T16:00:00Z".parse().unwrap(),
            time_zone: Some("America/New_York".into()),
        }),
        ..CalendarEventPatch::default()
    };

    let snapshot = api
        .inspect_replacement("token", &target, "master", None, true, &changes)
        .await
        .unwrap();

    let recurrence = &snapshot.payload["body"]["recurrence"];
    assert_eq!(recurrence["range"]["startDate"], "2026-11-05");
    assert_eq!(recurrence["pattern"]["type"], "daily");
    assert!(snapshot.is_series);
}

#[tokio::test]
async fn the_preview_names_a_series_by_what_the_replacement_repeats() {
    let (server, api) = setup().await;
    let target = target();
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars/calendar/events/old"))
        .respond_with(ResponseTemplate::new(200).set_body_json(teams_meeting("old")))
        .mount(&server)
        .await;
    let changes = CalendarEventPatch {
        recurrence_lines: Some(vec!["RRULE:FREQ=WEEKLY;BYDAY=MO".into()]),
        ..CalendarEventPatch::default()
    };

    let snapshot = api
        .inspect_replacement("token", &target, "old", None, true, &changes)
        .await
        .unwrap();

    assert!(snapshot.is_series);
    assert_eq!(snapshot.write_count(), 2);
}

#[test]
fn a_series_guest_made_optional_and_its_reminder_settings_reach_occurrences_still_like_it() {
    let guest = |address: &str, kind: &str| json!({"emailAddress":{"address":address},"type":kind});
    let preferences = |minutes: u32| json!([{"id":PREFERENCES_ID,"value":format!("{{\"reminders\":{{\"useDefault\":false,\"overrides\":[{{\"method\":\"popup\",\"minutes\":{minutes}}}]}}}}")}]);
    let saved = json!({
        "attendees":[guest("ada@example.com", "required")],
        "singleValueExtendedProperties": preferences(10),
    });
    let edited = json!({
        "attendees":[guest("ada@example.com", "optional")],
        "singleValueExtendedProperties": preferences(30),
    });
    let mut like_series = saved.clone();
    let mut own_reminder = json!({
        "attendees":[guest("ADA@example.com", "required")],
        "singleValueExtendedProperties": preferences(5),
    });

    inherit_changes(&mut like_series, &saved, &edited);
    inherit_changes(&mut own_reminder, &saved, &edited);

    assert_eq!(like_series, edited);
    assert_eq!(own_reminder["attendees"][0]["type"], "optional");
    assert_eq!(
        own_reminder["singleValueExtendedProperties"],
        preferences(5)
    );
}

#[tokio::test]
async fn a_time_that_names_the_saved_schedule_keeps_the_copied_occurrences() {
    let (server, api) = setup().await;
    let target = target();
    Mock::given(method("GET"))
        .and(path("/v1.0/me/calendars/calendar/events/master"))
        .respond_with(ResponseTemplate::new(200).set_body_json(series("master")))
        .with_priority(10)
        .mount(&server)
        .await;
    Mock::given(method("GET")).and(path("/v1.0/me/calendars/calendar/events/master"))
        .and(query_param("$select","id,exceptionOccurrences,cancelledOccurrences"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"@odata.etag":"W/\"1\"","exceptionOccurrences":[],"cancelledOccurrences":["OID.master.2026-11-05"]}))).with_priority(1).expect(1).mount(&server).await;
    // The saved time, named in another zone.
    let changes = CalendarEventPatch {
        time: Some(EventTime::Timed {
            starts_at: "2026-11-02T17:00:00Z".parse().unwrap(),
            ends_at: "2026-11-02T18:00:00Z".parse().unwrap(),
            time_zone: Some("America/New_York".into()),
        }),
        title: Some("Renamed".into()),
        ..CalendarEventPatch::default()
    };

    let snapshot = api
        .inspect_replacement("token", &target, "master", None, true, &changes)
        .await
        .unwrap();

    assert_eq!(snapshot.occurrences.len(), 1);
    assert_eq!(snapshot.occurrences[0]["cancelled"], true);
    // The saved rule and zone stay, so no occurrence moves.
    let body = &snapshot.payload["body"];
    assert_eq!(
        body["start"],
        copy_body(&series("master"), true).unwrap()["start"]
    );
    assert_eq!(body["recurrence"], series("master")["recurrence"]);
}

#[test]
fn an_occurrence_with_its_own_reminders_keeps_them_whole_when_the_series_reminder_changes() {
    let reminders = |minutes: &[u32]| {
        json!([{"id":PREFERENCES_ID,"value":json!({
            "reminders":{"useDefault":false,"overrides":minutes.iter().map(|m| json!({"method":"popup","minutes":m})).collect::<Vec<_>>()},
            "nativeReminderMinutes":minutes[0],
        }).to_string()}])
    };
    let saved = json!({
        "isReminderOn":true, "reminderMinutesBeforeStart":10,
        "singleValueExtendedProperties":reminders(&[10]),
    });
    let edited = json!({
        "isReminderOn":true, "reminderMinutesBeforeStart":30,
        "singleValueExtendedProperties":reminders(&[30]),
    });
    let own = json!({
        "isReminderOn":true, "reminderMinutesBeforeStart":10,
        "singleValueExtendedProperties":reminders(&[10, 60]),
    });
    let mut occurrence = own.clone();
    let mut like_series = saved.clone();

    inherit_changes(&mut occurrence, &saved, &edited);
    inherit_changes(&mut like_series, &saved, &edited);

    assert_eq!(occurrence, own);
    assert_eq!(like_series, edited);
}
