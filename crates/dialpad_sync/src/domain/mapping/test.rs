use super::*;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use serde_json::json;
use uuid::Uuid;

fn connection() -> Connection {
    Connection {
        id: Uuid::from_u128(1),
        namespace: Uuid::from_u128(2),
        user_id: MacroUserIdStr::parse_from_str("macro|dialpad-a@example.com")
            .unwrap()
            .into_owned(),
        enabled: true,
        setup_lease: None,
        dialpad_user_id: Some(DialpadId(5908860123456789)),
        registration: None,
        secret: None,
        backfill: BackfillState::Done,
        enrolled_at: Utc::now(),
        last_synced_at: None,
        last_error: None,
        calls: CallHealth::Healthy,
    }
}

/// Dialpad's documented event shape, trimmed.
fn event(state: &str, timestamp: i64, extra: serde_json::Value) -> CallEvent {
    let mut event = json!({
        "call_id": 5747322335264768_i64,
        "state": state,
        "direction": "inbound",
        "date_started": 1_746_469_000_000_i64,
        "date_connected": 1_746_469_010_000_i64,
        "date_ended": 1_746_469_070_000_i64,
        "event_timestamp": timestamp,
        "external_number": "+1604311",
        "internal_number": "+1601012",
        "target": {"id": 5908860123456789_i64, "type": "user", "name": "Sam Rep",
            "email": "sam@example.com", "phone": "+1601012"},
        "contact": {"id": "http://www.google.com/m8/feeds/contacts/x/base/1", "type": "google",
            "name": "Jane Doe", "phone": "+1 604 311", "email": ""},
    });
    if let serde_json::Value::Object(extra) = extra {
        event.as_object_mut().unwrap().extend(extra);
    }
    serde_json::from_value(event).unwrap()
}

/// An event with only `fields` beyond its call, state and time: Dialpad's
/// events need not repeat a call's details.
fn sparse(state: &str, timestamp: i64, fields: serde_json::Value) -> CallEvent {
    let mut event = json!({
        "call_id": 5747322335264768_i64,
        "state": state,
        "event_timestamp": timestamp,
    });
    if let serde_json::Value::Object(fields) = fields {
        event.as_object_mut().unwrap().extend(fields);
    }
    serde_json::from_value(event).unwrap()
}

fn line(kind: &str, name: &str, time: &str, content: &str) -> TranscriptLine {
    serde_json::from_value(json!({"type": kind, "name": name, "time": time, "content": content}))
        .unwrap()
}

#[test]
fn a_call_is_rebuilt_from_all_its_events_in_any_order() {
    let events = vec![
        event(
            "recap_action_items",
            1_746_469_200_000,
            json!({"recap_action_items": ["Send the quote", " "]}),
        ),
        event("hangup", 1_746_469_071_000, json!({})),
        event(
            "recap_summary",
            1_746_469_190_000,
            json!({"recap_summary": "Jane wants a quote."}),
        ),
        event(
            "call_transcription",
            1_746_469_100_000,
            json!({"company_call_review_share_link": "https://dialpad.com/shared/call/abc"}),
        ),
    ];
    assert_eq!(
        needs(&events),
        Some(Needs {
            transcript: true,
            recap: false
        })
    );
    let transcript = vec![
        line(
            "transcript",
            "Jane Doe",
            "2025-05-05T18:16:50.000",
            "Hi, is this Sam?",
        ),
        line("moment", "", "2025-05-05T18:16:51.000", "pricing"),
        line(
            "transcript",
            "Sam Rep",
            "2025-05-05T18:16:52.500",
            "Yes, speaking.",
        ),
    ];
    let call = imported_call(&connection(), &events, Some(transcript), None).unwrap();

    assert_eq!(call.title.as_deref(), Some("Call with Jane Doe"));
    assert_eq!(call.source.provider, CallProvider::Dialpad);
    assert_eq!(call.source.external_id.as_ref(), "5747322335264768");
    assert_eq!(call.source.namespace, Uuid::from_u128(2).to_string());
    assert_eq!(
        call.source.external_url.as_deref(),
        Some("https://dialpad.com/shared/call/abc")
    );
    assert_eq!(
        call.source.external_updated_at,
        DateTime::from_timestamp_millis(1_746_469_200_000)
    );
    assert_eq!(
        call.started_at,
        DateTime::from_timestamp_millis(1_746_469_010_000)
    );
    assert_eq!(
        call.ended_at,
        DateTime::from_timestamp_millis(1_746_469_070_000)
    );
    assert_eq!(
        call.source.metadata["summary"],
        "Jane wants a quote.\n\n**Action items**\n\n- Send the quote"
    );

    let [rep, caller] = call.participants.as_slice() else {
        panic!("expected the rep and the caller");
    };
    assert_eq!(rep.email.as_deref(), Some("sam@example.com"));
    assert_eq!(rep.phone.as_deref(), Some("+1601012"));
    assert_eq!(caller.display_name.as_deref(), Some("Jane Doe"));
    assert_eq!(caller.phone.as_deref(), Some("+1604311"));
    assert_eq!(
        caller.email, None,
        "Dialpad's empty email is not an address"
    );
    assert_eq!(
        rep.user_id.as_ref(),
        Some(&connection().user_id),
        "the rep is the connected Macro user"
    );
    assert!(caller.user_id.is_none());

    let transcript = call.transcript.unwrap();
    let lines: Vec<(&str, Option<i64>)> = transcript
        .segments
        .iter()
        .map(|segment| (segment.content.as_str(), segment.start_ms))
        .collect();
    assert_eq!(
        lines,
        vec![
            ("Hi, is this Sam?", Some(0)),
            ("Yes, speaking.", Some(2500))
        ]
    );
    assert_eq!(
        transcript.segments[1].speaker_label.as_deref(),
        Some("Sam Rep")
    );
}

#[test]
fn sparse_events_merge_field_by_field_and_the_newest_value_wins() {
    let events = vec![
        sparse(
            "hangup",
            1_746_469_071_000,
            json!({
                "date_started": 1_746_469_000_000_i64,
                "date_connected": 1_746_469_010_000_i64,
                "date_ended": 1_746_469_070_000_i64,
                "external_number": "+1604311",
                "target": {"id": 5908860123456789_i64, "name": "Sam Rep", "email": "sam@example.com"},
                "contact": {"name": "Jane Doe", "phone": "+1604311", "email": "jane@example.com"},
            }),
        ),
        // Later events repeat only some details, and blank others.
        sparse(
            "call_transcription",
            1_746_469_100_000,
            json!({
                "date_started": 1_746_469_000_000_i64,
                "target": {"id": 5908860123456789_i64},
                "contact": {"name": "", "email": ""},
                "company_call_review_share_link": "https://dialpad.com/shared/call/abc",
            }),
        ),
        sparse(
            "recap_summary",
            1_746_469_190_000,
            json!({"recap_summary": "Jane wants a quote.", "date_ended": 1_746_469_080_000_i64}),
        ),
    ];
    assert_eq!(
        needs(&events),
        Some(Needs {
            transcript: true,
            recap: false
        }),
        "a later event without date_connected does not make the call unanswered"
    );
    let call = imported_call(&connection(), &events, None, None).unwrap();

    assert_eq!(call.title.as_deref(), Some("Call with Jane Doe"));
    assert_eq!(
        call.started_at,
        DateTime::from_timestamp_millis(1_746_469_010_000)
    );
    assert_eq!(
        call.ended_at,
        DateTime::from_timestamp_millis(1_746_469_080_000),
        "the newest value wins"
    );
    assert_eq!(
        call.source.external_url.as_deref(),
        Some("https://dialpad.com/shared/call/abc")
    );
    let [rep, caller] = call.participants.as_slice() else {
        panic!("expected the rep and the caller");
    };
    assert_eq!(rep.display_name.as_deref(), Some("Sam Rep"));
    assert_eq!(rep.email.as_deref(), Some("sam@example.com"));
    assert_eq!(caller.display_name.as_deref(), Some("Jane Doe"));
    assert_eq!(caller.email.as_deref(), Some("jane@example.com"));
    assert_eq!(caller.phone.as_deref(), Some("+1604311"));
}

#[test]
fn unanswered_calls_are_not_imported() {
    let missed = vec![event("hangup", 1, json!({"date_connected": null}))];
    assert_eq!(needs(&missed), None);
    assert!(imported_call(&connection(), &missed, None, None).is_none());
}

#[test]
fn a_caller_known_only_by_number_is_titled_by_it() {
    let events = vec![event(
        "hangup",
        1_746_469_071_000,
        json!({"contact": {"name": "+1604311", "phone": "+1604311"}}),
    )];
    let call = imported_call(&connection(), &events, None, None).unwrap();
    assert_eq!(call.title.as_deref(), Some("Call with +1604311"));
    assert_eq!(call.participants[1].display_name, None);
    assert!(call.transcript.is_none());
    assert_eq!(call.source.metadata["summary"], serde_json::Value::Null);
}

#[test]
fn past_calls_fetch_their_transcript_and_recap() {
    let events = vec![event("backfill", 1_746_469_070_000, json!({}))];
    assert_eq!(
        needs(&events),
        Some(Needs {
            transcript: true,
            recap: true
        })
    );
    let recap = Recap {
        summary: Some("Renewal call.".into()),
        action_items: vec!["Book a demo".into()],
    };
    let call = imported_call(&connection(), &events, None, Some(recap)).unwrap();
    assert_eq!(
        call.source.metadata["summary"],
        "Renewal call.\n\n**Action items**\n\n- Book a demo"
    );
}

#[test]
fn only_a_transcript_notice_fetches_the_transcript() {
    let events = vec![event("hangup", 1, json!({}))];
    assert_eq!(
        needs(&events),
        Some(Needs {
            transcript: false,
            recap: false
        })
    );
}

#[test]
fn backfill_fetches_the_missing_recap_component() {
    for partial in [
        event("recap_summary", 3, json!({"recap_summary": "Summary"})),
        event(
            "recap_action_items",
            3,
            json!({"recap_action_items": ["Follow up"]}),
        ),
    ] {
        let events = vec![event("backfill", 2, json!({})), partial];
        assert!(needs(&events).unwrap().recap);
        let call = imported_call(
            &connection(),
            &events,
            None,
            Some(Recap {
                summary: Some("Summary".into()),
                action_items: vec!["Follow up".into()],
            }),
        )
        .unwrap();
        assert_eq!(
            call.source.metadata["summary"],
            "Summary\n\n**Action items**\n\n- Follow up"
        );
    }
    let events = vec![
        event("backfill", 2, json!({})),
        event("recap_summary", 3, json!({"recap_summary": "Summary"})),
        event(
            "recap_action_items",
            4,
            json!({"recap_action_items": ["Follow up"]}),
        ),
    ];
    assert!(!needs(&events).unwrap().recap);
}
