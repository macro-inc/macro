//! Models the in-memory Macro agent advertises over ACP.

use std::sync::OnceLock;

use chat::domain::models::CHAT_MODELS;

/// Models the in-memory agent offers beyond the closed chat catalog, paired
/// with the house name the picker shows.
///
/// Catalog ids are `<provider>/<slug>`, matching the router's provider
/// registry. The router expands a Fireworks slug to its
/// `accounts/fireworks/models/<slug>` wire id; other providers send the slug
/// verbatim.
pub const ROUTED_MODELS: &[(&str, &str)] = &[
    ("fireworks/kimi-k3", "Kimi K3"),
    ("fireworks/deepseek-v4-pro-0813", "DeepSeek V4 Pro"),
    ("fireworks/muse-glimmer-30b", "Muse Glimmer"),
    ("google/gemini-3.8-flash", "Gemini 3.8 Flash"),
];

/// House name for an advertised id, or the id itself when the catalog has
/// none (closed chat models keep their frontend names).
#[must_use]
pub fn display_name(id: &str) -> &str {
    ROUTED_MODELS
        .iter()
        .find_map(|(model, name)| (*model == id).then_some(*name))
        .unwrap_or(id)
}

/// Closed chat models plus the routed extras, in picker order.
#[must_use]
pub fn advertised_models() -> &'static [&'static str] {
    static MODELS: OnceLock<Vec<&'static str>> = OnceLock::new();
    MODELS
        .get_or_init(|| {
            let mut models = Vec::with_capacity(CHAT_MODELS.len() + ROUTED_MODELS.len());
            models.extend_from_slice(CHAT_MODELS);
            models.extend(ROUTED_MODELS.iter().map(|(model, _)| *model));
            models
        })
        .as_slice()
}

#[cfg(test)]
mod test {
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
}
