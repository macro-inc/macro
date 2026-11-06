use super::*;

#[test]
fn secret_names_are_validated_on_input_without_changing_json() {
    for raw in ["", "../token", "GitHub Token", "token/other", "token\n"] {
        assert!(SecretName::parse(raw).is_err());
        assert!(serde_json::from_value::<SecretName>(serde_json::json!(raw)).is_err());
    }
    let name: SecretName = serde_json::from_str("\"github-token\"").unwrap();
    assert_eq!(name.as_str(), "github-token");
    assert_eq!(
        serde_json::to_value(name).unwrap(),
        serde_json::json!("github-token")
    );
}

#[test]
fn secret_value_serde_enforces_the_plaintext_limit_and_redacts_debug() {
    for raw in [String::new(), "x".repeat(MAX_SECRET_BYTES + 1)] {
        assert!(serde_json::from_value::<SecretValue>(serde_json::json!(raw)).is_err());
    }
    let value: SecretValue = serde_json::from_str("\"test-secret\"").expect("valid secret");
    assert_eq!(format!("{value:?}"), "SecretValue(redacted)");
    assert_eq!(
        serde_json::to_value(value).expect("serialize"),
        serde_json::json!("test-secret")
    );
}

#[cfg(feature = "inbound")]
#[test]
fn secret_schema_keeps_inline_string_fields() {
    use utoipa::PartialSchema;

    let schema = serde_json::to_value(AgentSecret::schema()).expect("schema");
    assert_eq!(schema["properties"]["name"]["type"], "string");
    assert_eq!(schema["properties"]["value"]["type"], "string");
    let summary = serde_json::to_value(AgentSecretSummary::schema()).expect("schema");
    assert_eq!(summary["properties"]["name"]["type"], "string");
}

#[test]
fn kms_identifiers_accept_key_alias_and_arn_shapes_but_reject_header_characters() {
    for raw in [
        "key-1",
        "alias/local-key",
        "arn:aws:kms:us-east-1:000000000000:key/key-1",
    ] {
        assert!(KmsKeyId::parse(raw.to_string()).is_ok());
    }
    for raw in ["", "key\nother", "alias/key?", "key with spaces"] {
        assert!(KmsKeyId::parse(raw.to_string()).is_err());
        assert!(serde_json::from_value::<KmsKeyId>(serde_json::json!(raw)).is_err());
    }
    assert!(KmsKeyId::parse("k".repeat(2049)).is_err());
}
