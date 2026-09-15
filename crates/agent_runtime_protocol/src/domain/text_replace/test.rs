use super::*;

#[test]
fn reads_wire_metadata_only_for_nonempty_text_keys() {
    let chunk: ContentChunk = serde_json::from_value(json!({
        "content": {"type":"text", "text":""},
        "_meta": text_replace_meta("item-1")
    }))
    .unwrap();
    assert_eq!(text_replace_id(&chunk), Some("item-1"));
    for meta in [
        json!({}),
        json!({TEXT_REPLACE_META_KEY:true}),
        text_replace_meta("").into(),
        json!({TEXT_REPLACE_META_KEY:{"id":1}}),
    ] {
        let chunk: ContentChunk = serde_json::from_value(json!({
            "content": {"type":"text", "text":"plain"}, "_meta": meta
        }))
        .unwrap();
        assert_eq!(text_replace_id(&chunk), None);
    }
    let image: ContentChunk = serde_json::from_value(json!({
        "content": {"type":"image", "data":"", "mimeType":"image/png"},
        "_meta": text_replace_meta("item-1")
    }))
    .unwrap();
    assert_eq!(text_replace_id(&image), None);
}
