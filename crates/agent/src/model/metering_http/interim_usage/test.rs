use super::InterimUsageFilter;
use crate::model::metering_http::MAX_EVENT_BYTES;

#[test]
fn interim_chunks_lose_their_usage_and_the_final_chunk_keeps_it() {
    let mut filter = InterimUsageFilter::default();
    let body = concat!(
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"h\"}]}}],",
        "\"usageMetadata\":{\"promptTokenCount\":39691,\"totalTokenCount\":39713}}\r\n\r\n",
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"i\"}]},\"finishReason\":\"STOP\"}],",
        "\"usageMetadata\":{\"promptTokenCount\":39691,\"cachedContentTokenCount\":37644}}\r\n\r\n",
    );

    let out = filter.push(body.as_bytes());

    assert_eq!(
        std::str::from_utf8(&out).unwrap(),
        concat!(
            "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"h\"}]}}]}\r\n\r\n",
            "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"i\"}]},\"finishReason\":\"STOP\"}],",
            "\"usageMetadata\":{\"promptTokenCount\":39691,\"cachedContentTokenCount\":37644}}\r\n\r\n",
        )
    );
    assert!(filter.finish().is_empty());
}

#[test]
fn an_event_split_across_chunks_is_held_until_it_ends() {
    let mut filter = InterimUsageFilter::default();

    let first = filter.push(b"data: {\"candidates\":[{}],\"usageMet");
    let second = filter.push(b"adata\":{\"promptTokenCount\":5}}\n");
    let third = filter.push(b"\n");

    assert!(first.is_empty());
    assert!(second.is_empty());
    assert_eq!(&third[..], b"data: {\"candidates\":[{}]}\n\n");
}

#[test]
fn events_it_does_not_understand_pass_through_unchanged() {
    let mut filter = InterimUsageFilter::default();
    let body = concat!(
        ": keep-alive\n\n",
        "data: not json\n\n",
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"x\"}]}}]}\n\n",
        "data: {\"promptFeedback\":{\"blockReason\":\"SAFETY\"},\"usageMetadata\":{\"promptTokenCount\":5}}\n\n",
        "data: {\"usageMetadata\":{\"promptTokenCount\":5}}\n",
    );

    let out = filter.push(body.as_bytes());
    let rest = filter.finish();

    assert_eq!(
        std::str::from_utf8(&out).unwrap(),
        concat!(
            ": keep-alive\n\n",
            "data: not json\n\n",
            "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"x\"}]}}]}\n\n",
            "data: {\"promptFeedback\":{\"blockReason\":\"SAFETY\"},\"usageMetadata\":{\"promptTokenCount\":5}}\n\n",
        )
    );
    assert_eq!(
        &rest[..],
        b"data: {\"usageMetadata\":{\"promptTokenCount\":5}}\n"
    );
}

#[test]
fn a_stream_that_ends_before_its_final_chunk_gets_its_last_usage_back() {
    let mut filter = InterimUsageFilter::default();

    let out = filter
        .push(b"data: {\"candidates\":[{}],\"usageMetadata\":{\"promptTokenCount\":5}}\r\n\r\n");
    let rest = filter.finish();

    assert_eq!(&out[..], b"data: {\"candidates\":[{}]}\r\n\r\n");
    assert_eq!(
        &rest[..],
        b"data: {\"usageMetadata\":{\"promptTokenCount\":5}}\r\n\r\n"
    );
}

#[test]
fn an_event_larger_than_the_limit_passes_through_as_sent() {
    let mut filter = InterimUsageFilter::default();
    let text = "x".repeat(MAX_EVENT_BYTES);
    let start = format!("data: {{\"candidates\":[{{\"text\":\"{text}");

    let first = filter.push(start.as_bytes());
    let second = filter.push(b"\"}],\"usageMetadata\":{\"promptTokenCount\":5}}\n\n");

    assert_eq!(&first[..], start.as_bytes());
    assert_eq!(
        &second[..],
        b"\"}],\"usageMetadata\":{\"promptTokenCount\":5}}\n\n"
    );
    assert!(filter.finish().is_empty());
}

#[test]
fn usage_removed_before_an_oversized_event_is_not_replayed() {
    let mut filter = InterimUsageFilter::default();
    filter.push(b"data: {\"candidates\":[{}],\"usageMetadata\":{\"promptTokenCount\":5}}\n\n");
    let text = "x".repeat(MAX_EVENT_BYTES);

    filter.push(format!("data: {{\"candidates\":[{{\"text\":\"{text}").as_bytes());
    filter.push(b"\",\"finishReason\":\"STOP\"}]}\n\n");

    assert!(filter.finish().is_empty());
}

#[test]
fn usage_sent_without_candidates_is_not_overwritten_by_a_replay() {
    let mut filter = InterimUsageFilter::default();

    let out = filter.push(
        concat!(
            "data: {\"candidates\":[{}],\"usageMetadata\":{\"promptTokenCount\":5}}\n\n",
            "data: {\"usageMetadata\":{\"promptTokenCount\":7}}\n\n",
        )
        .as_bytes(),
    );

    assert_eq!(
        std::str::from_utf8(&out).unwrap(),
        concat!(
            "data: {\"candidates\":[{}]}\n\n",
            "data: {\"usageMetadata\":{\"promptTokenCount\":7}}\n\n",
        )
    );
    assert!(filter.finish().is_empty());
}

#[test]
fn gemini_4_capture_never_exposes_signatures_to_rig() {
    use crate::GEMINI_4_NEON;
    use crate::Gemini4ReplaySession;
    use crate::model::gemini_replay::Capture;

    let replay = Gemini4ReplaySession::new(GEMINI_4_NEON, vec![]).unwrap();
    let mut filter = InterimUsageFilter {
        capture: Some(Capture::new(replay.clone())),
        ..Default::default()
    };
    let output = filter.push(
        concat!(
            "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"answer\",",
            "\"thoughtSignature\":\"cHJpdmF0ZQ==\"},",
            "{\"functionCall\":{\"id\":\"native-call-id\",\"name\":\"lookup\",\"args\":{}},",
            "\"thoughtSignature\":\"dG9vbA==\"}]},\"finishReason\":\"STOP\"}]}\n\n",
        )
        .as_bytes(),
    );
    let output = std::str::from_utf8(&output).unwrap();
    assert!(output.contains("answer"));
    assert!(!output.contains("thoughtSignature"));
    assert!(!output.contains("cHJpdmF0ZQ=="));
    assert!(!output.contains("native-call-id"));
    assert!(output.contains("gemini-call-"));
    assert!(
        serde_json::to_string(&replay.complete().unwrap())
            .unwrap()
            .contains("cHJpdmF0ZQ==")
    );
}

#[test]
fn gemini_4_capture_drops_invalid_and_unsupported_events_before_rig() {
    use crate::GEMINI_4_NEON;
    use crate::Gemini4ReplaySession;
    use crate::model::gemini_replay::Capture;

    for rejected in [
        "not-json private-marker",
        r#"{"candidates":[{"content":{"parts":[{"text":{"hint":"private-marker"}}]}}]}"#,
        r#"{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"private-marker"}}]}}]}"#,
        r#"{"error":{"message":"private-marker"}}"#,
    ] {
        let replay = Gemini4ReplaySession::new(GEMINI_4_NEON, vec![]).unwrap();
        let mut filter = InterimUsageFilter {
            capture: Some(Capture::new(replay.clone())),
            ..Default::default()
        };
        let rejected = filter.push(format!("data: {rejected}\n\n").as_bytes());
        assert!(rejected.is_empty());
        let output = filter.push(
            concat!(
                "data: {\"responseId\":\"private-marker\",\"candidates\":[{",
                "\"content\":{\"parts\":[{\"text\":\"answer\"}]},",
                "\"finishReason\":\"STOP\",\"finishMessage\":\"private-marker\"}]}\n\n"
            )
            .as_bytes(),
        );
        assert!(
            !std::str::from_utf8(&output)
                .unwrap()
                .contains("private-marker")
        );
        assert!(replay.complete().is_none());
    }
}
