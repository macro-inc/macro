use super::ApiDoc;
use slack_integration::inbound::axum_router::SlackApiDoc;
use utoipa::OpenApi;

#[test]
fn dss_registers_all_slack_operations_and_schemas() {
    let dss = serde_json::to_value(ApiDoc::openapi()).unwrap();
    let slack = serde_json::to_value(SlackApiDoc::openapi()).unwrap();
    for (path, operations) in slack["paths"].as_object().unwrap() {
        assert_eq!(&dss["paths"][path], operations, "{path}");
    }
    for (name, schema) in slack["components"]["schemas"].as_object().unwrap() {
        assert_eq!(&dss["components"]["schemas"][name], schema, "{name}");
    }
}
