//! Models the in-memory Macro agent advertises over ACP.

use std::sync::OnceLock;

use chat::domain::models::CHAT_MODELS;

/// Fireworks-hosted open-weight models offered on the in-memory Macro agent.
///
/// Catalog ids are `fireworks/<slug>`. The router expands the slug to
/// Fireworks' `accounts/fireworks/models/<slug>` wire id.
pub const OPEN_WEIGHT_MODELS: &[&str] = &[
    "fireworks/kimi-k3",
    "fireworks/deepseek-v4-pro-0813",
    "fireworks/muse-glimmer-30b",
];

/// House name for an advertised id, or the id itself when the catalog has
/// none (closed chat models keep their frontend names).
#[must_use]
pub fn display_name(id: &str) -> &str {
    match id {
        "fireworks/kimi-k3" => "Kimi K3",
        "fireworks/deepseek-v4-pro-0813" => "DeepSeek V4 Pro",
        "fireworks/muse-glimmer-30b" => "Muse Glimmer",
        other => other,
    }
}

/// Closed chat models plus the in-memory open-weight set, in picker order.
#[must_use]
pub fn advertised_models() -> &'static [&'static str] {
    static MODELS: OnceLock<Vec<&'static str>> = OnceLock::new();
    MODELS
        .get_or_init(|| {
            let mut models = Vec::with_capacity(CHAT_MODELS.len() + OPEN_WEIGHT_MODELS.len());
            models.extend_from_slice(CHAT_MODELS);
            models.extend_from_slice(OPEN_WEIGHT_MODELS);
            models
        })
        .as_slice()
}

#[cfg(test)]
mod test {
    use super::{OPEN_WEIGHT_MODELS, advertised_models, display_name};
    use chat::domain::models::CHAT_MODELS;

    #[test]
    fn advertised_models_keep_chat_then_append_open_weight() {
        let models = advertised_models();
        assert_eq!(&models[..CHAT_MODELS.len()], CHAT_MODELS);
        assert_eq!(&models[CHAT_MODELS.len()..], OPEN_WEIGHT_MODELS);
    }

    #[test]
    fn open_weight_models_have_house_names() {
        assert_eq!(display_name("fireworks/kimi-k3"), "Kimi K3");
        assert_eq!(
            display_name("fireworks/deepseek-v4-pro-0813"),
            "DeepSeek V4 Pro"
        );
        assert_eq!(display_name("fireworks/muse-glimmer-30b"), "Muse Glimmer");
        assert_eq!(
            display_name("anthropic/claude-sonnet-5"),
            "anthropic/claude-sonnet-5"
        );
    }
}
