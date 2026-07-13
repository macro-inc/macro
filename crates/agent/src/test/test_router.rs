use crate::model::router::*;
use rig_core::providers::{anthropic, openai};

fn test_router() -> ModelRouter {
    let anthropic = anthropic::Client::builder()
        .api_key("test-anthropic-key")
        .build()
        .unwrap();
    let openai = openai::Client::builder()
        .api_key("test-openai-key")
        .build()
        .unwrap();
    let compatible = openai::CompletionsClient::builder()
        .api_key("test-compatible-key")
        .base_url("http://localhost:11434/v1")
        .build()
        .unwrap();

    ModelRouter::new(anthropic, openai).with_openai_client("local", compatible)
}

#[test]
fn openai_provider_routes_to_responses() {
    let router = test_router();

    assert!(matches!(
        router.route("openai/gpt-5.5").unwrap(),
        RoutedModel::OpenAiResponses(_)
    ));
}

#[test]
fn registered_openai_compatible_provider_routes_to_chat_completions() {
    let router = test_router();

    assert!(matches!(
        router.route("local/llama-3.3-70b").unwrap(),
        RoutedModel::OpenAiChatCompletions(_)
    ));
}
