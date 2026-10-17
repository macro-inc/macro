use ai_projections::domain::ai_projection_service::{
    FREE_TIER_MODELS, requires_professional_features,
};
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

// The web client sends the published free-tier model to both chat and AI
// projections, so projections must allow exactly that model for free users.
#[test]
fn projection_free_tier_matches_the_published_free_tier() {
    assert_eq!(FREE_TIER_MODELS, [FREE_MODEL]);
    assert!(!requires_professional_features(Some(FREE_MODEL)));
}
