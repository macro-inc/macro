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
