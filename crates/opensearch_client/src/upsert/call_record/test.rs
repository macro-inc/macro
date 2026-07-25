use super::*;

fn segment() -> UpsertCallRecordSegmentArgs {
    UpsertCallRecordSegmentArgs {
        call_id: "call1".to_string(),
        transcript_id: "seg1".to_string(),
        channel_id: "channel1".to_string(),
        participant_ids: vec!["macro|gab@macro.com".to_string()],
        channel_name: Some("Standup".to_string()),
        name: Some("Weekly standup".to_string()),
        speaker_id: "macro|gab@macro.com".to_string(),
        sequence_num: 0,
        content: "segment content".to_string(),
        started_at_millis: EpochMillis::new(1_700_000_000_123).unwrap(),
        ended_at_millis: Some(EpochMillis::new(1_700_000_100_456).unwrap()),
        properties: vec![],
    }
}

#[test]
fn parent_doc_body_has_metadata_and_name_no_child_fields() {
    let doc = parent_doc_body(&segment());

    assert_eq!(doc["entity_id"], "call1");
    assert_eq!(doc["channel_id"], "channel1");
    assert_eq!(doc["channel_name"], "Standup");
    assert_eq!(doc["name"], "Weekly standup");
    assert_eq!(doc["started_at_millis"], 1_700_000_000_123i64);
    assert_eq!(doc["call_relation"], "call");
    // Child-only fields must not be present on the parent.
    assert!(doc.get("content").is_none());
    assert!(doc.get("transcript_id").is_none());
    assert!(doc.get("speaker_id").is_none());
    // No properties key when the call has none.
    assert!(doc.get("properties").is_none());
}

#[test]
fn parent_doc_body_includes_properties_when_present() {
    let mut seg = segment();
    seg.properties = vec![IndexedProperty {
        definition_id: "tag-def".to_string(),
        values: vec!["option-1".to_string(), "option-2".to_string()],
        ..Default::default()
    }];

    let doc = parent_doc_body(&seg);
    let props = doc["properties"].as_array().expect("properties array");
    assert_eq!(props.len(), 1);
    assert_eq!(props[0]["definition_id"], "tag-def");
    assert_eq!(
        props[0]["values"],
        serde_json::json!(["option-1", "option-2"])
    );
}

#[test]
fn child_doc_body_has_no_properties_or_name() {
    let mut seg = segment();
    seg.properties = vec![IndexedProperty {
        definition_id: "tag-def".to_string(),
        values: vec!["option-1".to_string()],
        ..Default::default()
    }];

    let doc = child_doc_body(&seg);
    assert!(doc.get("properties").is_none());
    assert!(doc.get("name").is_none());
    assert_eq!(doc["call_relation"]["parent"], "call1");
}
