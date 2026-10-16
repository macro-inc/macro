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
            for (model, _) in ROUTED_MODELS {
                if !models.contains(model) {
                    models.push(model);
                }
            }
            models
        })
        .as_slice()
}

/// Image input support for the models in Macro's catalog.
///
/// This is model-specific, not provider-specific. Sources (2026-10-08):
/// https://fireworks.ai/models (Vision versus LLM classification) and
/// https://huggingface.co/openai/gpt-oss-120b
/// Verified with image requests as well: Fireworks' list-models metadata
/// incorrectly marks MiniMax M3 as text-only, but it reads image colors and text.
/// Unknown models remain unknown rather than being advertised as text-only.
#[must_use]
pub fn supports_images(id: &str) -> Option<bool> {
    if CHAT_MODELS.contains(&id) {
        return Some(true);
    }
    match id {
        "fireworks/kimi-k3"
        | "fireworks/muse-glimmer-30b"
        | "fireworks/glm-5p3-flash"
        | "fireworks/qwen3p8-max"
        | "fireworks/minimax-m3" => Some(true),
        "fireworks/deepseek-v4-pro-0813"
        | "fireworks/glm-5p3"
        | "fireworks/nemotron-lightning-3p5-30b-a3b"
        | "cerebras/gpt-oss-120b" => Some(false),
        _ => None,
    }
}

/// How many tokens of context each model in Macro's catalog takes, as the
/// provider Macro routes it to serves it, which can be less than the model
/// itself reads: Fireworks serves MiniMax M3 at 512k of its native 1M.
///
/// Sources (2026-10-10): the model pages at https://developers.openai.com/api/docs/models
/// and https://fireworks.ai/models, Google's Gemini 3.8 Flash model card,
/// Anthropic's model overview, and Cerebras' gpt-oss-120b listing. Fireworks
/// lists no window for Qwen 3.8 Max; 262,144 is the model's own. Unknown
/// models stay unknown rather than being given a guess.
#[must_use]
pub fn context_window(id: &str) -> Option<u64> {
    Some(match id {
        "anthropic/claude-sonnet-5-5" | "anthropic/claude-opus-5-5" => 1_000_000,
        "anthropic/claude-haiku-4-5" => 200_000,
        "openai/gpt-6-astra" | "openai/gpt-6.1-sol" | "openai/gpt-5.6" | "openai/gpt-5.5" => {
            1_050_000
        }
        "openai/gpt-5.6-mini" | "openai/gpt-5-mini" => 400_000,
        "google/gemini-3.8-flash" => 1_048_576,
        "fireworks/kimi-k3"
        | "fireworks/deepseek-v4-pro-0813"
        | "fireworks/glm-5p3"
        | "fireworks/glm-5p3-flash" => 1_040_000,
        "fireworks/minimax-m3" => 512_000,
        "fireworks/qwen3p8-max" => 262_144,
        "fireworks/nemotron-lightning-3p5-30b-a3b" => 262_000,
        "fireworks/muse-glimmer-30b" => 131_000,
        "cerebras/gpt-oss-120b" => 131_072,
        _ => return None,
    })
}

#[cfg(test)]
mod test;
