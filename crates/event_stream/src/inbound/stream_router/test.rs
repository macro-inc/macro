use super::*;
use crate::domain::models::ControlEvent;
use crate::domain::models::NormalizedEvent;

#[test]
fn stream_errors_map_to_their_statuses() {
    for (error, status) in [
        (
            StreamError::BadRequest("bad".to_owned()),
            StatusCode::BAD_REQUEST,
        ),
        (StreamError::Forbidden, StatusCode::FORBIDDEN),
        (StreamError::NotEnabled, StatusCode::NOT_FOUND),
        (StreamError::TooManyStreams, StatusCode::TOO_MANY_REQUESTS),
        (StreamError::CursorExpired, StatusCode::GONE),
    ] {
        assert_eq!(StreamHandlerError(error).into_response().status(), status);
    }
}

#[test]
fn the_api_key_digest_is_stable_and_never_the_key() {
    let mut headers = HeaderMap::new();
    headers.insert(USER_API_KEY_HEADER, "mak_secret".parse().unwrap());

    let digest = api_key_digest(&headers);

    assert_eq!(digest, api_key_digest(&headers));
    assert_eq!(digest.len(), 24);
    assert!(!digest.contains("secret"));
}

#[test]
fn events_and_control_events_encode() {
    let event = NormalizedEvent {
        event_id: "e".to_owned(),
        schema_version: 1,
        event_name: "document.updated".to_owned(),
        entity_type: "document".to_owned(),
        entity_id: "d".to_owned(),
        ordering_key: "d".to_owned(),
        occurred_at: chrono::Utc::now(),
        broker_envelope: serde_json::json!({"event_type": "document.updated"}),
    };

    assert!(
        sse_event(StreamItem::Event {
            id: "1-0".to_owned(),
            event: Arc::new(event),
        })
        .is_some()
    );
    assert!(
        sse_event(StreamItem::Control(ControlEvent::Lagged {
            cursor: Some("1-0".to_owned())
        }))
        .is_some()
    );
}
