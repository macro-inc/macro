use super::*;
use connectors::fake::{ApiCall, FakeConnection, FakeConnectors};
use connectors::{ApiResponse, Connectors};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};

fn connection() -> Connection {
    Connection {
        id: macro_uuid::generate_uuid_v7(),
        namespace: macro_uuid::generate_uuid_v7(),
        user_id: MacroUserIdStr::parse_from_str("macro|owner@test.com")
            .unwrap()
            .into_owned(),
        scope: Scope::Personal,
        enabled: true,
        endpoint_id: None,
        secret: None,
        started_at: Utc::now(),
        last_synced_at: None,
        last_error: None,
    }
}
fn note() -> Note {
    serde_json::from_value(json!({
        "id": "not_123456789abcde", "title": "Design review",
        "owner": {"name": "Owner", "email": "owner@test.com"},
        "created_at": "2026-10-07T11:00:00Z",
        "updated_at": "2026-10-07T15:00:00Z", "deleted_at": null,
        "web_url": "https://notes.granola.ai/d/example",
        "calendar_event": {"scheduled_start_time": "2026-10-07T12:00:00Z"},
        "attendees": [{"name": "Guest", "email": "guest@test.com"}],
        "summary_markdown": "Decided to ship", "private_notes_text": "Do not import"
    }))
    .unwrap()
}

/// Without transcript timing, a meeting starts when its calendar event was
/// scheduled, so an old note never sorts as a meeting held today.
#[test]
fn meetings_without_transcripts_start_at_their_calendar_event_without_macro_participants() {
    let call = map_meeting(&connection(), note(), vec![]).unwrap();
    assert_eq!(
        call.started_at.unwrap().to_rfc3339(),
        "2026-10-07T12:00:00+00:00"
    );
    assert!(call.ended_at.is_none());
    assert!(call.transcript.is_none());
    assert_eq!(call.participants.len(), 1);
    assert!(call.participants[0].user_id.is_none());
    assert!(call.participants[0].attendance.is_empty());
    assert_eq!(call.source.provider, CallProvider::Granola);
    assert_eq!(call.source.metadata["summary"], "Decided to ship");
    assert!(
        !json!(call.source.metadata)
            .to_string()
            .contains("Do not import")
    );
}

/// With neither transcript timing nor a calendar event, a meeting starts
/// when its note was created.
#[test]
fn meetings_without_timing_or_calendar_start_when_the_note_was_created() {
    let mut note = note();
    note.calendar_event = None;
    let call = map_meeting(&connection(), note, vec![]).unwrap();
    assert_eq!(
        call.started_at.unwrap().to_rfc3339(),
        "2026-10-07T11:00:00+00:00"
    );
}

#[test]
fn transcript_timing_is_relative_to_observed_audio_and_speakers_are_not_guessed() {
    let segments = serde_json::from_value(json!([
        {"text":"Hello","start_time":"2026-10-07T12:03:00Z","end_time":"2026-10-07T12:03:02Z","speaker":{"attribution":"me"}},
        {"text":"Hi","start_time":"2026-10-07T12:03:03Z","end_time":"2026-10-07T12:03:04Z","speaker":{"attribution":"them"}},
        {"text":"No timing","speaker":{"diarization_label":"Speaker A"}}
    ])).unwrap();
    let call = map_meeting(&connection(), note(), segments).unwrap();
    assert_eq!(
        call.started_at.unwrap().to_rfc3339(),
        "2026-10-07T12:03:00+00:00"
    );
    let transcript = call.transcript.unwrap();
    assert_eq!(transcript.segments[1].start_ms, Some(3000));
    assert_eq!(
        transcript.segments[0].speaker_label.as_deref(),
        Some("Owner")
    );
    assert_eq!(
        transcript.segments[1].speaker_label.as_deref(),
        Some("Other participants")
    );
    assert_eq!(
        transcript.segments[2].speaker_label.as_deref(),
        Some("Speaker A")
    );
    assert!(
        transcript
            .segments
            .iter()
            .all(|s| s.participant_id.is_none())
    );
}

/// Granola's API for the test connection's user, answering `responses` in
/// turn.
fn adapter(responses: Vec<(u16, Value)>) -> (FakeConnectors, GranolaApi<Connectors>) {
    let fake = FakeConnectors::new().with_connection(
        &connection().user_id,
        FakeConnection::app("granola").answering_in_turn(responses.into_iter().map(
            |(status, body)| ApiResponse {
                status: http::StatusCode::from_u16(status).unwrap(),
                headers: http::HeaderMap::new(),
                body: body.to_string(),
            },
        )),
    );
    let adapter = GranolaApi(Arc::new(fake.build()));
    (fake, adapter)
}

fn urls(fake: &FakeConnectors) -> Vec<String> {
    fake.api_calls()
        .into_iter()
        .map(|call: ApiCall| call.url)
        .collect()
}

#[tokio::test]
async fn provider_ids_cannot_change_the_request_path() {
    let (fake, adapter) = adapter(vec![(200, meeting_json())]);
    let id = NoteId("../webhook-endpoints?x=1#".into());
    // The fetched note has a different ID, so the import is rejected.
    assert!(adapter.meeting(&connection(), &id).await.is_err());
    assert!(urls(&fake)[0].ends_with("/notes/..%2Fwebhook-endpoints%3Fx%3D1%23"));
}

/// Sync reads Granola only through a connection that gives API access; a
/// user on Macro Connect, which holds Granola as tools only, has none.
#[tokio::test]
async fn without_api_access_nothing_is_called() {
    let user = connection().user_id;
    let fake = FakeConnectors::new()
        .with_connect_app("granola", false)
        .with_macro_connect_enabled(&user)
        .with_connection(&user, FakeConnection::app("granola"));
    let adapter = GranolaApi(Arc::new(fake.build()));
    assert!(
        adapter
            .meeting(&connection(), &NoteId("not_123456789abcde".into()))
            .await
            .is_err()
    );
    assert!(fake.api_calls().is_empty());
}

fn meeting_json() -> Value {
    json!({"id":"not_123456789abcde", "title":"Review", "owner":{"email":"owner@test.com"},
        "updated_at":"2026-10-07T15:00:00Z", "web_url":"https://notes.granola.ai/t/test"})
}

#[tokio::test]
async fn pagination_fetches_all_text_and_encodes_opaque_cursors() {
    let (fake, adapter) = adapter(vec![
        (200, meeting_json()),
        (
            200,
            json!({"transcript":[{"text":"One"}],"hasMore":true,"cursor":"next/&?"}),
        ),
        (
            200,
            json!({"transcript":[{"text":"Two"}],"hasMore":false,"cursor":null}),
        ),
    ]);
    let call = adapter
        .meeting(&connection(), &NoteId("not_123456789abcde".into()))
        .await
        .unwrap()
        .unwrap();
    let segments = call.transcript.unwrap().segments;
    assert_eq!(segments.len(), 2);
    assert_eq!(segments[1].content, "Two");
    assert!(urls(&fake)[2].ends_with("?cursor=next%2F%26%3F"));
}

#[tokio::test]
async fn failed_later_pages_never_commit_partial_transcripts() {
    for status in [404, 429, 500] {
        let (_, adapter) = adapter(vec![
            (200, meeting_json()),
            (
                200,
                json!({"transcript":[{"text":"Partial"}],"hasMore":true,"cursor":"next"}),
            ),
            (status, Value::Null),
        ]);
        assert!(
            adapter
                .meeting(&connection(), &NoteId("not_123456789abcde".into()))
                .await
                .is_err()
        );
    }
}

#[tokio::test]
async fn absent_transcript_still_imports_a_meeting() {
    let (_, adapter) = adapter(vec![(200, meeting_json()), (404, Value::Null)]);
    let meeting = adapter
        .meeting(&connection(), &NoteId("not_123456789abcde".into()))
        .await
        .unwrap()
        .unwrap();
    assert!(meeting.transcript.is_none());
    assert_eq!(meeting.title.as_deref(), Some("Review"));
}

fn listed(id: &str, deleted_at: Value) -> Value {
    json!({"id": id, "object": "note", "title": "Listed", "owner": {"email": "owner@example.com"},
        "created_at": "2026-09-01T10:00:00Z", "updated_at": "2026-09-01T11:00:00Z",
        "deleted_at": deleted_at})
}

#[tokio::test]
async fn notes_are_listed_a_page_at_a_time_with_opaque_cursors() {
    let (fake, adapter) = adapter(vec![
        (
            200,
            json!({"notes": [listed("not_aaaaaaaaaaaaaa", Value::Null),
                listed("not_bbbbbbbbbbbbbb", json!("2026-09-02T00:00:00Z"))],
                "hasMore": true, "cursor": "next/&?"}),
        ),
        (200, json!({"notes": [], "hasMore": false, "cursor": null})),
    ]);

    let first = adapter.notes(&connection(), None).await.unwrap();
    let last = adapter.notes(&connection(), Some("next/&?")).await.unwrap();

    assert_eq!(
        first,
        NotesPage {
            notes: vec![
                ListedNote {
                    id: NoteId("not_aaaaaaaaaaaaaa".into()),
                    deleted: false,
                },
                ListedNote {
                    id: NoteId("not_bbbbbbbbbbbbbb".into()),
                    deleted: true,
                },
            ],
            next: Some("next/&?".into()),
        }
    );
    assert_eq!(
        last,
        NotesPage {
            notes: vec![],
            next: None,
        }
    );
    let urls = urls(&fake);
    assert_eq!(
        urls[0],
        "https://public-api.granola.ai/v1/notes?page_size=10"
    );
    assert_eq!(
        urls[1],
        "https://public-api.granola.ai/v1/notes?page_size=10&cursor=next%2F%26%3F"
    );
}

#[tokio::test]
async fn a_failed_or_unterminated_list_page_is_an_error() {
    for (status, body) in [
        (429, json!({"code": "RATE_LIMITED"})),
        (404, Value::Null),
        (200, json!({"notes": [], "hasMore": true, "cursor": null})),
    ] {
        let (_, adapter) = adapter(vec![(status, body)]);
        assert!(adapter.notes(&connection(), None).await.is_err());
    }
}

#[tokio::test]
async fn a_rate_limited_request_is_reported_as_such() {
    let (_, limited) = adapter(vec![(429, json!({"code": "RATE_LIMITED"}))]);
    let error = limited.notes(&connection(), None).await.unwrap_err();
    assert!(error.downcast_current_context::<RateLimited>().is_some());

    let (_, failing) = adapter(vec![(500, json!({"code": "INTERNAL_ERROR"}))]);
    let error = failing.notes(&connection(), None).await.unwrap_err();
    assert!(error.downcast_current_context::<RateLimited>().is_none());
}

#[tokio::test]
async fn a_rate_limit_carries_granolas_retry_after_in_seconds() {
    for (header, expected) in [
        (Some("120"), Some(std::time::Duration::from_secs(120))),
        (Some("Wed, 21 Oct 2015 07:28:00 GMT"), None),
        (None, None),
    ] {
        let mut headers = http::HeaderMap::new();
        if let Some(header) = header {
            headers.insert(
                http::header::RETRY_AFTER,
                http::HeaderValue::from_static(header),
            );
        }
        let fake = FakeConnectors::new().with_connection(
            &connection().user_id,
            FakeConnection::app("granola").answering_in_turn([ApiResponse {
                status: http::StatusCode::TOO_MANY_REQUESTS,
                headers,
                body: json!({"code": "RATE_LIMITED"}).to_string(),
            }]),
        );
        let adapter = GranolaApi(Arc::new(fake.build()));
        let error = adapter.notes(&connection(), None).await.unwrap_err();
        let limited = error.downcast_current_context::<RateLimited>().unwrap();
        assert_eq!(limited.retry_after, expected);
    }
}
