use super::*;

fn args() -> UpsertChatMessageArgs {
    UpsertChatMessageArgs {
        chat_id: "chat1".to_string(),
        chat_message_id: "msg1".to_string(),
        user_id: "macro|gab@macro.com".to_string(),
        role: "user".to_string(),
        created_at_millis: EpochMillis::new(1_700_000_000_123).unwrap(),
        updated_at_millis: EpochMillis::new(1_700_000_000_123).unwrap(),
        title: "Chat title".to_string(),
        content: "message content".to_string(),
        properties: vec![],
    }
}

#[test]
fn parent_doc_body_has_metadata_no_child_fields() {
    let doc = parent_doc_body(&args());

    assert_eq!(doc["entity_id"], "chat1");
    assert_eq!(doc["title"], "Chat title");
    assert_eq!(doc["user_id"], "macro|gab@macro.com");
    assert_eq!(doc["updated_at_millis"], 1_700_000_000_123i64);
    assert_eq!(doc["chat_relation"], "chat");
    // Child-only fields must not be present on the parent.
    assert!(doc.get("content").is_none());
    assert!(doc.get("chat_message_id").is_none());
    assert!(doc.get("role").is_none());
    // No properties key when the chat has none.
    assert!(doc.get("properties").is_none());
}

#[test]
fn parent_doc_body_includes_properties_when_present() {
    let mut a = args();
    a.properties = vec![IndexedProperty {
        definition_id: "tag-def".to_string(),
        values: vec!["option-1".to_string(), "option-2".to_string()],
        ..Default::default()
    }];

    let doc = parent_doc_body(&a);
    let props = doc["properties"].as_array().expect("properties array");
    assert_eq!(props.len(), 1);
    assert_eq!(props[0]["definition_id"], "tag-def");
    assert_eq!(
        props[0]["values"],
        serde_json::json!(["option-1", "option-2"])
    );
}

#[test]
fn child_doc_body_has_no_properties() {
    let mut a = args();
    a.properties = vec![IndexedProperty {
        definition_id: "tag-def".to_string(),
        values: vec!["option-1".to_string()],
        ..Default::default()
    }];

    let doc = child_doc_body(&a);
    assert!(doc.get("properties").is_none());
    assert_eq!(doc["chat_relation"]["parent"], "chat1");
}
