use std::time::Duration;

use futures::StreamExt as _;
use serde_json::json;
use wiremock::matchers::{method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;
use crate::client::Hosts;

fn posted_envelope(id: &str) -> String {
    json!({
        "event_id": id,
        "schema_version": 1,
        "event_type": "message.posted",
        "metadata": {
            "message_id": "m1",
            "content": "hey @agent",
            "created_at": "2026-11-02T10:00:00Z",
            "mentions": [{"entity_id": "macro|agent@example.com", "entity_type": "user"}],
            "attachments": [],
            "parent": {"type": "channel", "id": "ch1"},
            "root_id": "m1",
            "thread_id": null,
            "sender": "macro|someone@example.com",
            "triggered_by": null
        }
    })
    .to_string()
}

fn canned() -> String {
    format!(
        ": keep-alive\n\nevent: message.posted\ndata: {}\n\n: keep-alive\n\nevent: document.created\ndata: {}\n\nevent: broken\ndata: not json\n\n",
        posted_envelope("e1"),
        json!({"event_id": "e2", "schema_version": 1, "event_type": "document.created", "metadata": {"document_id": "d1"}}),
    )
}

#[tokio::test]
async fn decodes_a_canned_stream() {
    let text = canned();
    // Split mid-line to prove chunk boundaries don't matter.
    let (a, b) = text.split_at(text.len() / 2);
    let chunks = vec![
        Ok::<_, std::io::Error>(a.as_bytes().to_vec()),
        Ok(b.as_bytes().to_vec()),
    ];
    let events: Vec<Event> = decode_sse(futures::stream::iter(chunks)).collect().await;

    assert_eq!(
        events.len(),
        2,
        "keep-alives and undecodable data are skipped"
    );
    let EventKind::MessagePosted(posted) = &events[0].kind else {
        panic!("expected message.posted, got {:?}", events[0].kind);
    };
    assert_eq!(posted.channel_id(), Some("ch1"));
    assert!(posted.mentions("macro|agent@example.com"));
    assert!(!posted.sender.is_bot());
    assert!(!posted.is_reply());
    assert!(
        matches!(&events[1].kind, EventKind::Other { event_type, .. } if event_type == "document.created")
    );
}

#[test]
fn a_modeled_event_with_an_unexpected_payload_stays_raw() {
    let event = parse_envelope(
        &json!({"event_id": "e", "event_type": "message.posted", "metadata": {"odd": true}})
            .to_string(),
    )
    .unwrap();
    assert!(matches!(event.kind, EventKind::Other { .. }));
}

#[test]
fn filters_serialize_like_the_api_expects() {
    let filters = vec![
        EventFilter::events([MESSAGE_POSTED]),
        EventFilter::events([MESSAGE_POSTED]).ids(["ch1"]),
    ];
    assert_eq!(
        serde_json::to_value(&filters).unwrap(),
        json!([{"events": ["message.posted"]}, {"events": ["message.posted"], "ids": ["ch1"]}])
    );
}

#[tokio::test]
async fn reconnects_and_says_so() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/webhook/events/stream"))
        .and(query_param("scope", "user"))
        .respond_with(
            ResponseTemplate::new(200)
                .insert_header("content-type", "text/event-stream")
                .set_body_string(format!(
                    "event: message.posted\ndata: {}\n\n",
                    posted_envelope("e1")
                )),
        )
        .mount(&server)
        .await;
    let client = MacroClient::new("k", Hosts::all_at(&server.uri())).unwrap();
    let cancel = CancellationToken::new();
    let stream = EventStream::new(client, vec![EventFilter::events([MESSAGE_POSTED])])
        .with_backoff(Backoff {
            initial: Duration::from_millis(1),
            max: Duration::from_millis(5),
        })
        .stream(cancel.clone())
        .unwrap();
    let mut stream = Box::pin(stream);

    assert!(matches!(stream.next().await, Some(StreamItem::Event(_))));
    assert!(matches!(
        stream.next().await,
        Some(StreamItem::Reconnected { .. })
    ));
    assert!(matches!(stream.next().await, Some(StreamItem::Event(_))));
    cancel.cancel();
    assert!(stream.next().await.is_none());
}

#[test]
fn a_stream_needs_filters() {
    let client = MacroClient::new("k", Hosts::all_at("http://localhost:1")).unwrap();
    assert!(
        EventStream::new(client, Vec::new())
            .stream(CancellationToken::new())
            .is_err()
    );
}
