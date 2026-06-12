use rig_core::providers::anthropic::completion::{
    CLAUDE_HAIKU_4_5, CLAUDE_OPUS_4_7, CLAUDE_OPUS_4_8, CLAUDE_SONNET_4_6,
};
use rig_core::providers::openai::{GPT_5_5, GPT_5_MINI};
use serde::Serialize;
use utoipa::ToSchema;

pub mod types;
pub use types::*;
mod anthropic;
mod openai;
pub mod router;

/// API provider serving a model.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    /// Anthropic (Claude models)
    Anthropic,
    /// OpenAI (GPT models)
    OpenAi,
}

impl Provider {
    /// Lowercase provider name as exposed in the models schema.
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Anthropic => "anthropic",
            Self::OpenAi => "openai",
        }
    }
}

/// Model to use for completions.
///
/// This type is **serialize-only**: every variant's wire form is the
/// provider's **api id** — the exact string the API (and the model router)
/// expects. The two semantic tiers (`Smart` / `Fast`) are server-side
/// concepts that resolve to a concrete model, so they serialize to that
/// model's api id too — the router never sees a semantic name, only an id it
/// can dispatch. `Smart` and `Haiku4_5`/`Fast` may share a wire id; that's
/// fine because we never deserialize this enum.
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq, ToSchema, Default)]
pub enum AgentModel {
    /// Best available model (currently Claude Opus 4.8)
    #[default]
    #[serde(rename = "claude-opus-4-8")]
    Smart,
    /// Fastest available model (currently Claude Haiku 4.5)
    #[serde(rename = "claude-haiku-4-5")]
    Fast,
    /// Claude Opus 4.7
    #[serde(rename = "claude-opus-4-7")]
    Opus4_7,
    /// Claude Sonnet 4.6
    #[serde(rename = "claude-sonnet-4-6")]
    Sonnet4_6,
    /// Claude Haiku 4.5
    #[serde(rename = "claude-haiku-4-5")]
    Haiku4_5,
    /// OpenAI GPT-5.5
    #[serde(rename = "gpt-5.5")]
    Gpt5_5,
    /// OpenAI GPT-5 mini
    #[serde(rename = "gpt-5-mini")]
    Gpt5Mini,
    /// Retired or unrecognized model, routes to the default
    #[serde(rename = "claude-opus-4-8")]
    Retired,
}

/// `to_string()` yields the api id, so backend callers can pass an
/// `AgentModel` anywhere a `T: ToString` model is expected and get the exact
/// string the API/router needs.
impl std::fmt::Display for AgentModel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.api_id())
    }
}

impl AgentModel {
    /// Returns the provider API model identifier.
    pub fn api_id(&self) -> &'static str {
        match self {
            Self::Smart | Self::Retired => CLAUDE_OPUS_4_8,
            Self::Opus4_7 => CLAUDE_OPUS_4_7,
            Self::Sonnet4_6 => CLAUDE_SONNET_4_6,
            Self::Fast | Self::Haiku4_5 => CLAUDE_HAIKU_4_5,
            Self::Gpt5_5 => GPT_5_5,
            Self::Gpt5Mini => GPT_5_MINI,
        }
    }

    /// Returns `additional_params` JSON to enable extended thinking / reasoning.
    ///
    /// - Opus 4.8 / 4.7: `adaptive` (model chooses when to think)
    /// - Sonnet 4.6 / Haiku 4.5: `enabled` with `budget_tokens`
    /// - GPT-5.5 / GPT-5 mini: Responses API `reasoning` with effort
    ///   (no `temperature`; reasoning models reject it)
    pub fn thinking_params(&self) -> serde_json::Value {
        match self {
            Self::Smart | Self::Opus4_7 | Self::Retired => serde_json::json!({
                "thinking": { "type": "adaptive", "display": "summarized" },
                "temperature": 1
            }),
            Self::Sonnet4_6 | Self::Fast | Self::Haiku4_5 => serde_json::json!({
                "thinking": {
                    "type": "enabled",
                    "budget_tokens": 10_000,
                    "display": "summarized"
                },
                "temperature": 1
            }),
            Self::Gpt5_5 => serde_json::json!({
                "reasoning": { "effort": "medium", "summary": "auto" }
            }),
            Self::Gpt5Mini => serde_json::json!({
                "reasoning": { "effort": "low", "summary": "auto" }
            }),
        }
    }

    /// Context window size in tokens.
    pub fn context_window(&self) -> u64 {
        match self {
            Self::Smart | Self::Opus4_7 | Self::Sonnet4_6 | Self::Retired => 1_000_000,
            Self::Fast | Self::Haiku4_5 => 200_000,
            Self::Gpt5_5 | Self::Gpt5Mini => 400_000,
        }
    }

    /// API provider serving this model.
    pub fn provider(&self) -> Provider {
        match self {
            Self::Smart
            | Self::Fast
            | Self::Opus4_7
            | Self::Sonnet4_6
            | Self::Haiku4_5
            | Self::Retired => Provider::Anthropic,
            Self::Gpt5_5 | Self::Gpt5Mini => Provider::OpenAi,
        }
    }
}

#[cfg(test)]
mod test;
