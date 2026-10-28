use super::*;
use serde_json::json;

fn schema(value: serde_json::Value) -> DynamicSchema {
    DynamicSchema {
        name: "Answer".into(),
        schema: value,
        description: None,
    }
}

#[test]
fn validates_types_required_properties_nested_refs_and_formats() {
    let validator = validate_schema(&schema(json!({
        "type": "object",
        "properties": {"answer": {"$ref": "#/$defs/Answer"}},
        "required": ["answer"],
        "additionalProperties": false,
        "$defs": {"Answer": {
            "type": "object",
            "properties": {
                "count": {"type": "integer", "minimum": 0},
                "date": {"type": "string", "format": "date"}
            },
            "required": ["count", "date"],
            "additionalProperties": false
        }}
    })))
    .unwrap();
    assert!(
        parse_and_validate(r#"{"answer":{"count":3,"date":"2026-10-14"}}"#, &validator).is_ok()
    );
    for value in [
        json!({}),
        json!({"answer": {"count": "3", "date": "2026-10-14"}}),
        json!({"answer": {"count": -1, "date": "2026-10-14"}}),
        json!({"answer": {"count": 3, "date": "tomorrow"}}),
        json!({"answer": {"count": 3, "date": "2026-10-14", "extra": true}}),
    ] {
        assert!(
            parse_and_validate(&value.to_string(), &validator).is_err(),
            "{value}"
        );
    }
}

#[test]
fn permits_schema_conforming_arrays_primitives_and_fenced_json() {
    let validator = validate_schema(&schema(
        json!({"type": "array", "items": {"enum": ["a", "b"]}}),
    ))
    .unwrap();
    assert_eq!(
        parse_and_validate("```json\n[\"a\",\"b\"]\n```", &validator).unwrap(),
        json!(["a", "b"])
    );
    assert!(parse_and_validate(r#"["c"]"#, &validator).is_err());
    let validator = validate_schema(&schema(json!({"type": "boolean"}))).unwrap();
    assert_eq!(parse_and_validate("true", &validator).unwrap(), json!(true));
    assert!(parse_and_validate("not JSON", &validator).is_err());
}

#[test]
fn invalid_schemas_and_external_references_are_rejected_offline() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let remote = format!("http://{}/schema", listener.local_addr().unwrap());
    for value in [
        json!({"type": "not-a-json-type"}),
        json!({"required": "not-an-array"}),
        json!({"$ref": remote}),
        json!({"$ref": "file:///tmp/nonexistent-structured-completion-schema.json"}),
        json!({"$ref": "#/$defs/Absent"}),
    ] {
        assert!(validate_schema(&schema(value)).is_err());
    }
    assert_eq!(
        listener.accept().unwrap_err().kind(),
        std::io::ErrorKind::WouldBlock
    );
    assert!(
        validate_schema(&schema(
            json!({"description": "x".repeat(MAX_SCHEMA_BYTES)})
        ))
        .is_err()
    );
}

#[tokio::test]
async fn invalid_schema_fails_before_model_routing_or_paid_work() {
    let error = dynamic_structured_completion(
        "invalid/model",
        "system",
        vec![Message::user("hello")],
        schema(json!({"type": "not-a-json-type"})),
        &ai_usage::NoOpUsageRecorder,
        ai_usage::UsageContext::system(ai_usage::AiFeature::DynamicCompletionsApi),
    )
    .await
    .unwrap_err();
    assert!(error.to_string().starts_with("output schema is invalid"));
}
