use super::{AUTO_MODEL, ROUTED_MODELS, advertised_models, display_name, resolve};
use chat::domain::models::CHAT_MODELS;

#[test]
fn advertised_models_lead_with_auto_then_chat_then_routed() {
    let models = advertised_models();
    assert_eq!(
        models
            .iter()
            .filter(|model| **model == "google/gemini-3.8-flash")
            .count(),
        1
    );
    assert_eq!(models[0], AUTO_MODEL);
    assert_eq!(&models[1..=CHAT_MODELS.len()], CHAT_MODELS);
    assert_eq!(
        &models[CHAT_MODELS.len() + 1..],
        ROUTED_MODELS
            .iter()
            .map(|(model, _)| *model)
            .filter(|model| *model != AUTO_MODEL && !CHAT_MODELS.contains(model))
            .collect::<Vec<_>>()
            .as_slice()
    );
}

#[test]
fn auto_defaults_to_gemini() {
    assert_eq!(resolve(AUTO_MODEL), "google/gemini-3.8-flash");
    assert_eq!(resolve("fireworks/glm-5p3"), "fireworks/glm-5p3");
    assert_eq!(display_name(AUTO_MODEL), "Auto");
    assert_eq!(super::supports_images(AUTO_MODEL), Some(true));
    assert_eq!(super::context_window(AUTO_MODEL), Some(1_048_576));
}

#[test]
fn routed_models_have_house_names() {
    assert_eq!(display_name("fireworks/kimi-k3"), "Kimi K3");
    assert_eq!(
        display_name("fireworks/deepseek-v4p1-flash-1017"),
        "DeepSeek V4.1 Flash"
    );
    assert_eq!(display_name("fireworks/muse-glimmer-30b"), "Muse Glimmer");
    assert_eq!(display_name("fireworks/glm-5p3"), "GLM 5.3");
    assert_eq!(display_name("fireworks/glm-5p3-flash"), "GLM 5.3 Flash");
    assert_eq!(display_name("fireworks/qwen3p8-max"), "Qwen 3.8 Max");
    assert_eq!(display_name("fireworks/minimax-m3"), "MiniMax M3");
    assert_eq!(display_name("cerebras/gpt-oss-120b"), "GPT OSS 120B");
    assert_eq!(
        display_name("fireworks/nemotron-lightning-3p5-30b-a3b"),
        "Nemotron Lightning 3.5 30B A3B"
    );
    assert_eq!(display_name("google/gemini-3.8-flash"), "Gemini 3.8 Flash");
    assert_eq!(
        display_name("anthropic/claude-sonnet-5-5"),
        "anthropic/claude-sonnet-5-5"
    );
}

/// Every advertised id must carry a provider segment the router registers,
/// or the picker would offer an id that silently falls back.
#[test]
fn routed_models_use_known_providers() {
    for (model, _) in ROUTED_MODELS {
        let model = resolve(model);
        let provider = model.split('/').next().expect("a provider segment");
        assert!(
            matches!(provider, "cerebras" | "fireworks" | "google"),
            "unregistered provider in {model}"
        );
    }
}

#[test]
fn every_advertised_model_has_an_explicit_image_capability() {
    for model in advertised_models() {
        assert!(
            super::supports_images(model).is_some(),
            "missing capability: {model}"
        );
    }
}

/// Summaries start at a share of the model's window, so a model without one
/// would be summarized against a guess.
#[test]
fn every_advertised_model_has_a_context_window() {
    for model in advertised_models() {
        assert!(
            super::context_window(model).is_some(),
            "missing context window: {model}"
        );
    }
}
