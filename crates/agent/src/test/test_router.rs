use crate::model::router::*;
use crate::model::types::Model;
use crate::model::{PredefinedModel, ReasoningEffort};
use rig_core::providers::{anthropic, gemini, openai};

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
fn unroutable_ids_fall_back_to_the_smart_model() {
    let router = test_router();

    // Ids stored before dynamic model routing (bare api names, semantic tier
    // names) and ids naming an unregistered provider are all unroutable. Each
    // must fail to route, then fall back to the known Smart model — and the
    // fallback must put the *bare* api id on the wire: a provider-qualified
    // `anthropic/...` string 404s on the Anthropic API.
    let unroutable = [
        "claude-opus-4-6", // bare api id of a retired model
        "claude-opus-4-8", // bare api id of a current model
        "smart",           // semantic tier name
        "",                // empty
        "unregistered-provider/some-model",
    ];

    let smart = Model::from(PredefinedModel::Smart);
    for id in unroutable {
        assert!(router.route(id).is_err(), "`{id}` should not route");

        let RoutedModel::Anthropic(fallback) = router.route_or_default(id) else {
            panic!("`{id}` fallback should be native Anthropic");
        };
        let wire_id = fallback.completion().model;
        assert_eq!(
            wire_id,
            smart.name(),
            "`{id}` must fall back to the Smart model's bare api id, got `{wire_id}`"
        );
    }
}

#[test]
fn registered_openai_compatible_provider_routes_to_chat_completions() {
    let router = test_router();

    assert!(matches!(
        router.route("local/llama-3.3-70b").unwrap(),
        RoutedModel::OpenAiChatCompletions(_)
    ));
}

#[test]
fn fireworks_provider_routes_to_chat_completions() {
    let router = test_router().with_openai_client(
        "fireworks",
        openai::CompletionsClient::builder()
            .api_key("test-fireworks-key")
            .base_url("https://api.fireworks.ai/inference/v1")
            .build()
            .unwrap(),
    );

    let routed = router.route("fireworks/kimi-k3").unwrap();
    assert!(matches!(routed, RoutedModel::OpenAiChatCompletions(_)));
    assert_eq!(routed.provider(), "fireworks");
    assert_eq!(routed.model_name(), "kimi-k3");
}

#[test]
fn google_provider_routes_to_native_gemini() {
    let router = test_router().with_gemini_client(
        gemini::Client::builder()
            .api_key("test-google-key")
            .build()
            .unwrap(),
    );

    let routed = router.route("google/gemini-3.8-flash").unwrap();
    assert!(matches!(routed, RoutedModel::Gemini(_)));
    assert_eq!(routed.provider(), "google");
    assert_eq!(routed.model_name(), "gemini-3.8-flash");
}

#[test]
fn google_provider_without_a_client_is_unroutable() {
    assert!(test_router().route("google/gemini-3.8-flash").is_err());
}

#[test]
fn selected_effort_is_mapped_to_each_provider_request_shape() {
    let router = test_router();

    let RoutedModel::Anthropic(anthropic) = router.route("anthropic/claude-sonnet-5").unwrap()
    else {
        panic!("sonnet should use the native Anthropic client");
    };
    let params = anthropic
        .thinking_params(Some(ReasoningEffort::Low))
        .expect("sonnet supports thinking and effort");
    assert_eq!(params["thinking"]["type"], "adaptive");
    assert_eq!(params["output_config"]["effort"], "low");

    let RoutedModel::OpenAiResponses(openai) = router.route("openai/gpt-5.5").unwrap() else {
        panic!("GPT-5.5 should use OpenAI Responses");
    };
    let params = openai
        .thinking_params(Some(ReasoningEffort::Medium))
        .expect("GPT-5.5 supports reasoning effort");
    assert_eq!(params["reasoning"]["effort"], "medium");
}

#[test]
fn unsupported_anthropic_models_do_not_receive_effort() {
    let router = test_router();
    let RoutedModel::Anthropic(haiku) = router.route("anthropic/claude-haiku-4-5").unwrap() else {
        panic!("haiku should use the native Anthropic client");
    };

    let params = haiku
        .thinking_params(Some(ReasoningEffort::Low))
        .expect("haiku retains its thinking configuration");
    assert!(params.get("output_config").is_none());
}

#[test]
fn native_effort_profiles_preserve_defaults_and_provider_boundaries() {
    let router = test_router();
    let RoutedModel::OpenAiResponses(mini) = router.route("openai/gpt-5-mini").unwrap() else {
        panic!("Responses");
    };
    assert_eq!(
        mini.thinking_params(Some(ReasoningEffort::Default))
            .unwrap()["reasoning"]["effort"],
        "low"
    );
    assert_eq!(
        mini.thinking_params(Some(ReasoningEffort::Minimal))
            .unwrap()["reasoning"]["effort"],
        "minimal"
    );
    assert!(ReasoningEffort::supported("compatible/gpt-5-mini").is_empty());
    assert!(ReasoningEffort::supported("anthropic/claude-haiku-4-5").is_empty());
    assert!(ReasoningEffort::supported("openai/unknown").is_empty());
    for model in [
        "anthropic/claude-sonnet-5",
        "anthropic/claude-opus-5",
        "openai/gpt-5.5",
        "openai/gpt-5-mini",
    ] {
        for effort in ReasoningEffort::supported(model) {
            let params = match router.route(model).unwrap() {
                RoutedModel::Anthropic(model) => model.thinking_params(Some(*effort)).unwrap(),
                RoutedModel::OpenAiResponses(model) => {
                    model.thinking_params(Some(*effort)).unwrap()
                }
                _ => panic!("native model"),
            };
            if *effort != ReasoningEffort::Default {
                let actual = if model.starts_with("anthropic/") {
                    &params["output_config"]["effort"]
                } else {
                    &params["reasoning"]["effort"]
                };
                assert_eq!(actual, effort.as_str(), "{model}");
            } else if model.starts_with("anthropic/") {
                assert!(params.get("output_config").is_none());
            }
        }
    }
}
