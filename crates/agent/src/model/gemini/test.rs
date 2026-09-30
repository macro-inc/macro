use super::*;
use crate::model::types::Model;
use rig_core::providers::gemini::completion::gemini_api_types::AdditionalParameters;

#[test]
fn thinking_params_ask_for_thought_summaries() {
    let model = Model::try_from("google/gemini-3.8-flash").expect("routable id");
    let client = gemini::Client::builder()
        .api_key("test-google-key")
        .build()
        .expect("gemini client");
    let gemini = GeminiModel::new(model, Arc::new(client));
    let params = gemini.thinking_params().expect("thinking params");

    // Rig parses this JSON into AdditionalParameters before it builds the
    // GenerateContent body. Snake_case keys do not land in generationConfig,
    // so includeThoughts and the max-token copy both disappear.
    let parsed: AdditionalParameters =
        serde_json::from_value(params).expect("thinking params are gemini additional params");
    let config = parsed
        .generation_config
        .expect("generationConfig is recognized");
    let thinking = config
        .thinking_config
        .expect("thinkingConfig is recognized");
    assert_eq!(thinking.include_thoughts, Some(true));
    let leftover = parsed.additional_params.unwrap_or(serde_json::json!({}));
    assert_eq!(
        leftover,
        serde_json::json!({}),
        "unparsed keys would be sent as unknown Gemini fields"
    );
}
