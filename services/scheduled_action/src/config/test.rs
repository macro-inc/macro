use super::*;
use serde_json::{Value, json};

fn config_values() -> Value {
    json!({
        "ENVIRONMENT": "local",
        "DATABASE_URL": "postgres://localhost/macro",
        "DOCUMENT_STORAGE_SERVICE_AUTH_KEY": "test",
        "SYNC_SERVICE_AUTH_KEY": "test",
        "DOCUMENT_STORAGE_BUCKET": "test",
        "DOCX_DOCUMENT_UPLOAD_BUCKET": "test",
        "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_DISTRIBUTION_URL": "test",
        "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PUBLIC_KEY_ID": "test",
        "DOCUMENT_STORAGE_SERVICE_CLOUDFRONT_SIGNER_PRIVATE_KEY_SECRET_NAME": "test",
        "KAFKA_BROKERS": "existing-broker:9092",
        "INTERNAL_API_KEY": "test"
    })
}

#[test]
fn event_routines_default_off_and_reuse_existing_brokers() {
    let config: Config = serde_json::from_value(config_values()).unwrap();
    assert!(!config.event_routines_enabled);
    assert_eq!(config.kafka_brokers.to_string(), "existing-broker:9092");
}

#[test]
fn event_routines_require_an_explicit_boolean() {
    for enabled in [false, true] {
        let mut values = config_values();
        values["EVENT_ROUTINES_ENABLED"] = json!(enabled);
        let config: Config = serde_json::from_value(values).unwrap();
        assert_eq!(config.event_routines_enabled, enabled);
    }
    let mut values = config_values();
    values["EVENT_ROUTINES_ENABLED"] = json!("enabled");
    assert!(serde_json::from_value::<Config>(values).is_err());
}
