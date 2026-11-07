use super::*;

const DELTA: &str = "data: {\"id\":\"event-1\",\"item_type\":\"thread_event\",\"event\":{\"method\":\"item/agentMessage/delta\",\"params\":{\"delta\":\"🐺\"}}}\r\n\r\n";

#[test]
fn byte_fragmentation_preserves_unicode_crlf_and_replay_identity() {
    let mut parser = Parser::default();
    for byte in DELTA.bytes().chain(DELTA.bytes()) {
        parser.push(&[byte]).unwrap();
    }
    assert_eq!(
        parser.ready.len(),
        2,
        "deduplication happens after raw capture"
    );
    let event = parser.ready.pop_front().unwrap().decode().unwrap().unwrap();
    assert_eq!(event.id, "event-1");
    assert_eq!(event.params["delta"], "🐺");
    assert!(parser.line.is_empty());
    assert!(parser.data.is_empty());
}

#[test]
fn comments_multiline_data_and_unknown_methods_are_preserved() {
    let mut parser = Parser::default();
    parser
        .push(
            b": heartbeat\n\ndata: {\"id\":\"2\",\"item_type\":\"thread_event\",\n\
data: \"event\":{\"method\":\"future/event\",\"params\":{}}}\n\n",
        )
        .unwrap();
    assert_eq!(
        parser
            .ready
            .pop_front()
            .unwrap()
            .decode()
            .unwrap()
            .unwrap()
            .method,
        "future/event"
    );
}

#[test]
fn captures_malformed_payloads_before_decode_and_rejects_oversized_framing() {
    for data in [
        b"data: broken\n\n".as_slice(),
        b"data: {\"item_type\":\"thread_event\"}\n\n",
    ] {
        let mut parser = Parser::default();
        parser.push(data).unwrap();
        assert!(parser.ready.pop_front().unwrap().decode().is_err());
    }
    assert!(
        Parser::default()
            .push(&vec![b'x'; MAX_EVENT_BYTES + 1])
            .is_err()
    );
}

#[test]
fn log_envelopes_keep_their_identity() {
    let mut parser = Parser::default();
    parser
        .push(b"data: {\"id\":\"log-1\",\"item_type\":\"log\",\"line\":\"setup\"}\r\r")
        .unwrap();
    let event = parser.ready.pop_front().unwrap().decode().unwrap().unwrap();
    assert_eq!(event.method, "log");
    assert_eq!(event.params["line"], "setup");
}

#[test]
fn unknown_envelopes_and_sse_headers_survive_native_capture() {
    let mut parser = Parser::default();
    parser.push(b"event: future\nid: wire-1\ndata: {\"item_type\":\"new_kind\",\"unknown\": [1, 2]}\n\n").unwrap();
    let record = parser.ready.pop_front().unwrap();
    assert_eq!(record.event, "future");
    assert_eq!(record.id.as_deref(), Some("wire-1"));
    assert_eq!(record.data, r#"{"item_type":"new_kind","unknown": [1, 2]}"#);
    assert!(record.decode().unwrap().is_none());
}
