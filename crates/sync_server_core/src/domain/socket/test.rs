use super::*;

#[test]
fn tags_retain_legacy_prefix_only_validation_and_first_tag_selection() {
    assert_eq!(
        WebSocketId::new(uuid_types::Uuid::nil()).as_str(),
        "ws_id00000000-0000-0000-0000-000000000000"
    );
    assert_eq!(
        WebSocketId::from_tags(&["ws_idlegacy".into(), "ignored".into()])
            .unwrap()
            .as_str(),
        "ws_idlegacy"
    );
    assert_eq!(
        WebSocketId::from_tags(&[]).unwrap_err().to_string(),
        "websocket should only have exactly one tag! tags = []"
    );
    assert_eq!(
        WebSocketId::from_tags(&["other".into()])
            .unwrap_err()
            .to_string(),
        "WebSocket tag has an unknown prefix: whole_tag = other expected prefix = ws_id"
    );
}
