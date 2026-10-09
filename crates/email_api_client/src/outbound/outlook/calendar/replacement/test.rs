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
        .inspect_replacement("token", &target, "master", None, true)
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
        .inspect_replacement("token", &target, "master", Some(&original), true)
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
