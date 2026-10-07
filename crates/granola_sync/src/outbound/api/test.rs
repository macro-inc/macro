use super::*;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};

fn connection() -> Connection {
    Connection {
        id: macro_uuid::generate_uuid_v7(),
        namespace: macro_uuid::generate_uuid_v7(),
        user_id: MacroUserIdStr::parse_from_str("macro|owner@test.com")
            .unwrap()
            .into_owned(),
        account_id: "apn_account".into(),
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
        "updated_at": "2026-10-07T15:00:00Z", "deleted_at": null,
        "web_url": "https://notes.granola.ai/d/example",
        "calendar_event": {"scheduled_start_time": "2026-10-07T12:00:00Z"},
        "attendees": [{"name": "Guest", "email": "guest@test.com"}],
        "summary_markdown": "Decided to ship", "private_notes_text": "Do not import"
    }))
    .unwrap()
}

#[test]
fn meetings_without_transcripts_do_not_fabricate_timing_or_macro_participants() {
    let call = map_meeting(&connection(), note(), vec![]).unwrap();
    assert!(call.started_at.is_none());
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

#[test]
fn provider_ids_reject_path_injection() {
    assert!(NoteId::try_from("not_123456789abcde".to_owned()).is_ok());
    for id in [
        "../webhook-endpoints",
        "not_123456789abcd/",
        "",
        "not_short",
    ] {
        assert!(NoteId::try_from(id.to_owned()).is_err());
    }
}

struct FakeProxy {
    responses:
        std::sync::Mutex<std::collections::VecDeque<pipedream_mcp::domain::ports::ProxyResponse>>,
    urls: std::sync::Mutex<Vec<String>>,
}
impl FakeProxy {
    fn new(responses: Vec<(u16, Value)>) -> Arc<Self> {
        Arc::new(Self {
            responses: std::sync::Mutex::new(
                responses
                    .into_iter()
                    .map(
                        |(status, body)| pipedream_mcp::domain::ports::ProxyResponse {
                            status,
                            body,
                        },
                    )
                    .collect(),
            ),
            urls: Default::default(),
        })
    }
}
impl ApiProxy for FakeProxy {
    async fn proxy(
        &self,
        connection: &PipedreamConnection,
        _method: ProxyMethod,
        url: &str,
        _body: Option<Value>,
    ) -> anyhow::Result<pipedream_mcp::domain::ports::ProxyResponse> {
        assert_eq!(connection.app_slug, "granola");
        assert_eq!(connection.account_id, "apn_account");
        self.urls.lock().unwrap().push(url.into());
        Ok(self
            .responses
            .lock()
            .unwrap()
            .pop_front()
            .expect("unexpected request"))
    }
}
fn meeting_json() -> Value {
    json!({"id":"not_123456789abcde", "title":"Review", "owner":{"email":"owner@test.com"},
        "updated_at":"2026-10-07T15:00:00Z", "web_url":"https://notes.granola.ai/t/test"})
}

#[tokio::test]
async fn pagination_fetches_all_text_and_encodes_opaque_cursors() {
    let proxy = FakeProxy::new(vec![
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
    let adapter = GranolaApi(proxy.clone());
    let call = adapter
        .meeting(
            &connection(),
            &"not_123456789abcde".to_owned().try_into().unwrap(),
        )
        .await
        .unwrap()
        .unwrap();
    let segments = call.transcript.unwrap().segments;
    assert_eq!(segments.len(), 2);
    assert_eq!(segments[1].content, "Two");
    assert!(proxy.urls.lock().unwrap()[2].ends_with("?cursor=next%2F%26%3F"));
}

#[tokio::test]
async fn failed_later_pages_never_commit_partial_transcripts() {
    for status in [404, 429, 500] {
        let proxy = FakeProxy::new(vec![
            (200, meeting_json()),
            (
                200,
                json!({"transcript":[{"text":"Partial"}],"hasMore":true,"cursor":"next"}),
            ),
            (status, Value::Null),
        ]);
        let adapter = GranolaApi(proxy);
        assert!(
            adapter
                .meeting(
                    &connection(),
                    &"not_123456789abcde".to_owned().try_into().unwrap()
                )
                .await
                .is_err()
        );
    }
}

#[tokio::test]
async fn absent_transcript_still_imports_a_meeting() {
    let adapter = GranolaApi(FakeProxy::new(vec![
        (200, meeting_json()),
        (404, Value::Null),
    ]));
    let meeting = adapter
        .meeting(
            &connection(),
            &"not_123456789abcde".to_owned().try_into().unwrap(),
        )
        .await
        .unwrap()
        .unwrap();
    assert!(meeting.transcript.is_none());
    assert_eq!(meeting.title.as_deref(), Some("Review"));
}
