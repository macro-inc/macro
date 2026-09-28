use std::sync::Arc;

use super::{OpenAiChatCompletionsModel, completion_model_id};
use crate::model::types::Model;
use rig_core::providers::openai;

#[test]
fn fireworks_short_name_becomes_the_account_path() {
    let model = Model::try_from("fireworks/kimi-k3").expect("routable id");
    assert_eq!(
        completion_model_id(&model),
        "accounts/fireworks/models/kimi-k3"
    );
}

#[test]
fn fireworks_account_path_is_sent_verbatim() {
    let model = Model::try_from("fireworks/accounts/fireworks/models/kimi-k3")
        .expect("full path is still one provider segment");
    assert_eq!(
        completion_model_id(&model),
        "accounts/fireworks/models/kimi-k3"
    );
}

#[test]
fn other_compatible_providers_keep_the_catalog_name() {
    let model = Model::try_from("cerebras/gpt-oss-120b").expect("routable id");
    assert_eq!(completion_model_id(&model), "gpt-oss-120b");

    let gemini = Model::try_from("google/gemini-3.8-flash").expect("routable id");
    assert_eq!(completion_model_id(&gemini), "gemini-3.8-flash");

    let grok = Model::try_from("xai/grok-4.7").expect("routable id");
    assert_eq!(completion_model_id(&grok), "grok-4.7");
    let grok_fast = Model::try_from("xai/grok-4.7-fast").expect("routable id");
    assert_eq!(completion_model_id(&grok_fast), "grok-4.7-fast");
}

fn chat_model(id: &str) -> OpenAiChatCompletionsModel<'_> {
    let client = openai::CompletionsClient::builder()
        .api_key("test-key")
        .base_url("https://api.x.ai/v1")
        .build()
        .expect("client");
    OpenAiChatCompletionsModel::new(Model::try_from(id).expect("routable id"), Arc::new(client))
}

#[test]
fn grok_asks_for_reasoning_effort_and_fast_stays_high() {
    assert_eq!(
        chat_model("xai/grok-4.7").thinking_params(),
        Some(serde_json::json!({ "reasoning_effort": "high" }))
    );
    assert_eq!(
        chat_model("xai/grok-4.7-fast").thinking_params(),
        Some(serde_json::json!({ "reasoning_effort": "high" }))
    );
    assert_eq!(chat_model("fireworks/kimi-k3").thinking_params(), None);
}
