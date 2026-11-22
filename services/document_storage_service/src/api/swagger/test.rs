use super::ApiDoc;
use slack_integration::inbound::axum_router::SlackApiDoc;
use utoipa::OpenApi;

/// The whole DSS spec as JSON. Unoptimized, building it takes more stack than
/// a test thread's 2 MiB, so it runs on a thread with the main thread's 8 MiB.
fn dss_spec() -> serde_json::Value {
    std::thread::Builder::new()
        .stack_size(8 * 1024 * 1024)
        .spawn(|| serde_json::to_value(ApiDoc::openapi()).unwrap())
        .unwrap()
        .join()
        .unwrap()
}

#[test]
fn dss_registers_all_slack_operations_and_schemas() {
    let dss = dss_spec();
    let slack = serde_json::to_value(SlackApiDoc::openapi()).unwrap();
    for (path, operations) in slack["paths"].as_object().unwrap() {
        assert_eq!(&dss["paths"][path], operations, "{path}");
    }
    for (name, schema) in slack["components"]["schemas"].as_object().unwrap() {
        assert_eq!(&dss["components"]["schemas"][name], schema, "{name}");
    }
}

#[test]
fn dss_registers_all_forms_operations_and_schemas() {
    let dss = dss_spec();
    let forms = serde_json::to_value(forms::inbound::axum_router::FormsApi::openapi()).unwrap();
    for (path, operations) in forms["paths"].as_object().unwrap() {
        assert_eq!(&dss["paths"][path], operations, "{path}");
    }
    for (name, schema) in forms["components"]["schemas"].as_object().unwrap() {
        assert_eq!(&dss["components"]["schemas"][name], schema, "{name}");
    }
}

#[test]
fn dss_registers_all_database_webhook_operations_and_schemas() {
    let dss = dss_spec();
    let webhooks = serde_json::to_value(
        database_webhooks::inbound::axum_router::DatabaseWebhooksApi::openapi(),
    )
    .unwrap();
    for (path, operations) in webhooks["paths"].as_object().unwrap() {
        assert_eq!(&dss["paths"][path], operations, "{path}");
    }
    for (name, schema) in webhooks["components"]["schemas"].as_object().unwrap() {
        assert_eq!(&dss["components"]["schemas"][name], schema, "{name}");
    }
}

#[test]
fn email_policy_schemas_reject_unknown_fields_like_the_handlers() {
    use crm::domain::email_policy_api::{EmailPolicyChange, EmailPolicyToken};
    use crm::domain::email_rules::EmailInclusionRule;
    use serde_json::json;

    for value in [
        json!({"kind": "thread", "thread_id": uuid::Uuid::nil(), "unexpected": true}),
        json!({"kind": "address", "address": "member@example.com", "unexpected": true}),
        json!({"kind": "contact", "contact_id": uuid::Uuid::nil(), "unexpected": true}),
        json!({"kind": "domain", "domain": "example.com", "unexpected": true}),
        json!({"kind": "company", "company_id": uuid::Uuid::nil(), "unexpected": true}),
    ] {
        assert!(serde_json::from_value::<EmailInclusionRule>(value).is_err());
    }
    for value in [
        json!({"action": "replace_rules", "rules": {"schema_version": 1, "include": []}, "unexpected": true}),
        json!({"action": "enable_all", "unexpected": true}),
        json!({"action": "withdraw", "unexpected": true}),
    ] {
        assert!(serde_json::from_value::<EmailPolicyChange>(value).is_err());
    }
    for value in [
        json!({"kind": "legacy", "fingerprint": "observation", "unexpected": true}),
        json!({"kind": "policy", "consent_incarnation": uuid::Uuid::nil(), "policy_version": 1, "authority_fingerprint": "observation", "unexpected": true}),
    ] {
        assert!(serde_json::from_value::<EmailPolicyToken>(value).is_err());
    }

    let spec = dss_spec();
    for (name, variant_count) in [
        ("EmailInclusionRule", 5),
        ("EmailPolicyChange", 3),
        ("EmailPolicyToken", 2),
    ] {
        let variants = spec["components"]["schemas"][name]["oneOf"]
            .as_array()
            .unwrap();
        assert_eq!(variants.len(), variant_count, "{name}");
        for variant in variants {
            assert_eq!(variant["additionalProperties"], false, "{name}: {variant}");
        }
    }
}
