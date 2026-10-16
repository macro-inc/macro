use super::*;
use serde_json::json;

fn request() -> GenerateObjectRequest {
    GenerateObjectRequest {
        prompt: "Extract the invoice total.".into(),
        system: None,
        model: None,
        schema: json!({ "type": "object", "properties": { "total": { "type": "number" } } }),
    }
}

#[test]
fn model_ids_are_provider_qualified_and_preserved() {
    for invalid in [
        "",
        "fast",
        "/model",
        "provider/",
        "provider/a b",
        " provider/model",
    ] {
        assert!(ModelId::try_from(invalid.to_owned()).is_err(), "{invalid}");
    }
    let value = "google/gemini-3.8-flash";
    let model = ModelId::try_from(value.to_owned()).unwrap();
    assert_eq!(model.as_str(), value);
    assert_eq!(serde_json::to_value(&model).unwrap(), json!(value));
    assert!(serde_json::from_value::<ModelId>(json!("fast")).is_err());
}

#[test]
fn generation_accepts_bounded_objects_and_rejects_invalid_inputs() {
    assert!(request().validate().is_ok());
    let mut input = request();
    input.prompt = " ".into();
    assert!(input.validate().is_err());
    input.prompt = "a".repeat(MAX_PROMPT_BYTES);
    assert!(input.validate().is_ok());
    input.system = Some("b".into());
    assert!(input.validate().is_err());
    input = request();
    for schema in [json!(true), json!({ "type": "array" }), json!({})] {
        input.schema = schema;
        assert!(input.validate().is_err());
    }
    input.schema = json!({ "type": "object", "description": "x".repeat(MAX_SCHEMA_BYTES) });
    assert!(input.validate().is_err());
}

#[test]
fn callers_cannot_choose_identity_or_tools() {
    let original = serde_json::to_value(request()).unwrap();
    for field in ["userId", "owner", "toolset", "endpoint", "apiKey"] {
        let mut input = original.clone();
        input[field] = json!("injected");
        assert!(serde_json::from_value::<GenerateObjectRequest>(input).is_err());
    }
}
