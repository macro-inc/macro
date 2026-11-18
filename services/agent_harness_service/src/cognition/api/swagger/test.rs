use chat::domain::models::FREE_MODEL;
use utoipa::OpenApi;

#[test]
fn openapi_publishes_the_chat_free_tier_model() {
    let doc = serde_json::to_value(super::ApiDoc::openapi()).unwrap();
    assert_eq!(
        doc["components"]["schemas"]["FreeTierModel"]["enum"],
        serde_json::json!([FREE_MODEL])
    );
}
