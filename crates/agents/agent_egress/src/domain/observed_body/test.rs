use super::*;
use http_body_util::{BodyExt, Full, StreamBody};

fn identity() -> StreamIdentity {
    StreamIdentity {
        session: AgentSessionId::new(),
        upstream: "datadog".to_owned(),
        status: 200,
        content_type: Some("text/event-stream".to_owned()),
    }
}

#[tokio::test]
async fn a_body_read_to_its_end_counts_what_passed_and_knows_it_ended() {
    let inner: ProxyBody = Full::new(Bytes::from_static(b"data: hello\n\n"))
        .map_err(|never| match never {})
        .boxed_unsync();
    let mut observed = ObservedBody::new(inner, identity());
    let mut collected = Vec::new();
    while let Some(frame) = observed.frame().await {
        if let Ok(data) = frame.expect("a full body does not fail").into_data() {
            collected.extend_from_slice(&data);
        }
    }
    assert_eq!(collected, b"data: hello\n\n");
    assert_eq!(observed.bytes, 13);
    assert_eq!(observed.frames, 1);
    assert!(observed.ended);
    assert_eq!(observed.outcome(), "closed by upstream");
}

#[tokio::test]
async fn a_body_dropped_early_is_known_to_have_been_dropped() {
    let inner: ProxyBody = Full::new(Bytes::from_static(b"data: hello\n\n"))
        .map_err(|never| match never {})
        .boxed_unsync();
    let observed = ObservedBody::new(inner, identity());
    assert!(!observed.ended);
    assert_eq!(observed.outcome(), "dropped by sandbox");
}

#[tokio::test]
async fn a_body_that_fails_is_known_to_have_failed() {
    let failing = futures::stream::iter(vec![
        Ok::<_, BoxError>(Frame::data(Bytes::from_static(b"data: a\n\n"))),
        Err("connection reset".into()),
    ]);
    let inner: ProxyBody = StreamBody::new(failing).boxed_unsync();
    let mut observed = ObservedBody::new(inner, identity());
    assert!(observed.frame().await.expect("a frame").is_ok());
    assert!(observed.frame().await.expect("an error").is_err());
    assert!(observed.failed);
    assert_eq!(observed.outcome(), "failed");
    assert_eq!(observed.bytes, 9);
}
