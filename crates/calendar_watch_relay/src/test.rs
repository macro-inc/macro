use super::*;

#[test]
fn sse_parser_extracts_single_event() {
    let mut parser = SseDataParser::default();
    let events = parser.push("data: {\"a\":1}\n\n");
    assert_eq!(events, vec!["{\"a\":1}".to_owned()]);
}

#[test]
fn sse_parser_handles_chunks_split_mid_line() {
    let mut parser = SseDataParser::default();
    assert!(parser.push("data: {\"a\"").is_empty());
    assert!(parser.push(":1}\n").is_empty());
    let events = parser.push("\n");
    assert_eq!(events, vec!["{\"a\":1}".to_owned()]);
}

#[test]
fn sse_parser_ignores_comments_and_other_fields() {
    let mut parser = SseDataParser::default();
    let events = parser.push(": keep-alive\n\nevent: message\ndata: x\nid: 7\n\n");
    assert_eq!(events, vec!["x".to_owned()]);
}

#[test]
fn sse_parser_joins_multi_line_data_and_handles_crlf() {
    let mut parser = SseDataParser::default();
    let events = parser.push("data: one\r\ndata: two\r\n\r\ndata:three\n\n");
    assert_eq!(events, vec!["one\ntwo".to_owned(), "three".to_owned()]);
}

#[test]
fn secrets_match_requires_equality() {
    assert!(secrets_match("s3cret", "s3cret"));
    assert!(!secrets_match("s3cret", "s3cret "));
    assert!(!secrets_match("", "s3cret"));
}

#[test]
fn relayed_notification_wire_round_trip() {
    let notification = RelayedWatchNotification {
        state: "exists".to_owned(),
        channel_id: "chan".to_owned(),
        resource_id: "res".to_owned(),
    };
    let encoded = serde_json::to_string(&notification).unwrap();
    let decoded: RelayedWatchNotification = serde_json::from_str(&encoded).unwrap();
    assert_eq!(decoded, notification);
}
