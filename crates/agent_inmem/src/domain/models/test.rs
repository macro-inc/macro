use super::{ROUTED_MODELS, advertised_models, display_name};
use chat::domain::models::CHAT_MODELS;

#[test]
fn advertised_models_keep_chat_then_append_routed() {
    let models = advertised_models();
    assert_eq!(&models[..CHAT_MODELS.len()], CHAT_MODELS);
    assert_eq!(
        &models[CHAT_MODELS.len()..],
        ROUTED_MODELS
            .iter()
            .map(|(model, _)| *model)
            .collect::<Vec<_>>()
            .as_slice()
    );
}

#[test]
fn routed_models_have_house_names() {
    assert_eq!(display_name("fireworks/kimi-k3"), "Kimi K3");
    assert_eq!(
        display_name("fireworks/deepseek-v4-pro-0813"),
        "DeepSeek V4 Pro"
    );
    assert_eq!(display_name("fireworks/muse-glimmer-30b"), "Muse Glimmer");
    assert_eq!(display_name("google/gemini-3.8-flash"), "Gemini 3.8 Flash");
    assert_eq!(
        display_name("anthropic/claude-sonnet-5"),
        "anthropic/claude-sonnet-5"
    );
}

/// Every advertised id must carry a provider segment the router registers,
/// or the picker would offer an id that silently falls back.
#[test]
fn routed_models_use_known_providers() {
    for (model, _) in ROUTED_MODELS {
        let provider = model.split('/').next().expect("a provider segment");
        assert!(
            matches!(provider, "fireworks" | "google"),
            "unregistered provider in {model}"
        );
    }
}
