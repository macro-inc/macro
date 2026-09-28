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
    ("fireworks/glm-5p3", "GLM 5.3"),
    ("fireworks/glm-5p3-flash", "GLM 5.3 Flash"),
    ("fireworks/qwen3p8-max", "Qwen 3.8 Max"),
    ("fireworks/minimax-m3", "MiniMax M3"),
    ("cerebras/gpt-oss-120b", "GPT OSS 120B"),
    (
        "fireworks/nemotron-lightning-3p5-30b-a3b",
        "Nemotron Lightning 3.5 30B A3B",
    ),
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
mod test;
