//! Current endpoint boundaries are stricter than legacy source-function replay.
use macro_document_composers::wire;
use serde_json::json;
#[test]
fn current_context_rejects_obsolete_fields_and_empty_required_strings() {
    assert!(
        wire::agent_context_from_json(&json!({"promptMarkdown":"","unknown":{"id":""}})).is_ok()
    );
    for field in [
        "parent",
        "anchor",
        "replyTarget",
        "promptMessageId",
        "thread",
        "channel",
    ] {
        let mut value = json!({"promptMarkdown":"body"});
        value[field] = json!(null);
        assert!(wire::agent_context_from_json(&value).is_err(), "{field}");
    }
    for value in [
        json!({"promptMarkdown":"body","owner":{"id":"","name":""}}),
        json!({"promptMarkdown":"body","currentTime":{"iso":"","local":"time"}}),
        json!({"promptMarkdown":"body","currentTime":{"iso":"iso","local":"time","timeZone":null}}),
        json!({"promptMarkdown":"body","instructions":null}),
        json!({"promptMarkdown":"body","trigger":{"kind":"requested","requested_by":{"id":"one","name":""},"requested_at":""}}),
    ] {
        assert!(wire::agent_context_from_json(&value).is_err(), "{value}");
    }
    assert!(
        wire::agent_context_from_json(&json!({"promptMarkdown":"","owner":{"id":"one","name":""}}))
            .is_ok()
    );
}
#[test]
fn image_validation_preserves_strings_and_bounds_positive_dimensions() {
    let valid = json!({"staticFileId":"ABCDEF00-0000-4000-8000-000000000001","url":" https://EXAMPLE.com/image ","width":1,"height":4294967295u64});
    let parsed = wire::image_from_json(&valid).expect("valid endpoint image");
    assert_eq!(parsed.static_file_id, valid["staticFileId"]);
    assert_eq!(parsed.url, valid["url"]);
    for (key, value) in [
        ("staticFileId", json!("not-a-uuid")),
        (
            "staticFileId",
            json!("00000000-0000-0000-8000-000000000001"),
        ),
        ("url", json!("relative/image")),
        ("width", json!(0)),
        ("width", json!(-1)),
        ("width", json!(1.5)),
        ("height", json!(4294967296u64)),
    ] {
        let mut input = valid.clone();
        input[key] = value;
        assert!(wire::image_from_json(&input).is_err(), "{input}");
    }
    for id in [
        "00000000-0000-0000-0000-000000000000",
        "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF",
    ] {
        let mut input = valid.clone();
        input["staticFileId"] = id.into();
        assert!(wire::image_from_json(&input).is_ok());
    }
}
