use super::*;
use crate::model::types::Model;

#[test]
fn thinking_params_ask_for_thought_summaries() {
    let model = Model::try_from("google/gemini-3.8-flash").expect("routable id");
    let client = gemini::Client::builder()
        .api_key("test-google-key")
        .build()
        .expect("gemini client");
    let gemini = GeminiModel::new(model, Arc::new(client));
    assert_eq!(
        gemini.thinking_params(),
        Some(serde_json::json!({
            "generation_config": {
                "thinking_config": {
                    "include_thoughts": true
                }
            }
        }))
    );
}
