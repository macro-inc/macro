//! Some predefined models backend convenience
//! Models are _not_ strictly verified. This is intentional so that we
//! can route to any <provider>/<model-id>
use crate::model::types::Model;
use rig_core::providers::anthropic::completion::{
    CLAUDE_HAIKU_4_5, CLAUDE_OPUS_4_7, CLAUDE_OPUS_4_8, CLAUDE_SONNET_4_6,
};
use rig_core::providers::openai::{GPT_5_5, GPT_5_MINI};
use serde::Serialize;
use utoipa::ToSchema;

static ANTHROPIC: &str = "anthropic";
static OPENAI: &str = "openai";
const CLAUDE_SONNET_5: &str = "claude-sonnet-5";

/// This type is **serialize-only**: every variant's wire form is the
/// provider's **api id** — the exact string the API (and the model router)
/// expects. The two semantic tiers (`Smart` / `Fast`) are server-side
/// concepts that resolve to a concrete model, so they serialize to that
/// model's api id too — the router never sees a semantic name, only an id it
/// can dispatch. `Smart` and `Haiku4_5`/`Fast` may share a wire id; that's
/// fine because we never deserialize this enum.
#[derive(Serialize, Debug, Clone, Copy, PartialEq, Eq, ToSchema, Default)]
pub enum PredefinedModel {
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
    /// Claude Sonnet 5
    #[serde(rename = "claude-sonnet-5")]
    Sonnet5,
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

impl From<PredefinedModel> for super::types::Model<'static> {
    fn from(model: PredefinedModel) -> Self {
        let (provider, name) = match model {
            PredefinedModel::Smart | PredefinedModel::Retired => (ANTHROPIC, CLAUDE_OPUS_4_8),
            PredefinedModel::Opus4_7 => (ANTHROPIC, CLAUDE_OPUS_4_7),
            PredefinedModel::Sonnet5 => (ANTHROPIC, CLAUDE_SONNET_5),
            PredefinedModel::Sonnet4_6 => (ANTHROPIC, CLAUDE_SONNET_4_6),
            PredefinedModel::Fast | PredefinedModel::Haiku4_5 => (ANTHROPIC, CLAUDE_HAIKU_4_5),
            PredefinedModel::Gpt5_5 => (OPENAI, GPT_5_5),
            PredefinedModel::Gpt5Mini => (OPENAI, GPT_5_MINI),
        };
        super::types::Model {
            provider: std::borrow::Cow::Borrowed(provider),
            name: std::borrow::Cow::Borrowed(name),
        }
    }
}

impl PredefinedModel {
    /// Returns `additional_params` JSON to enable extended thinking / reasoning.
    ///
    /// - Opus 4.8 / 4.7: `adaptive` (model chooses when to think)
    /// - Sonnet 5: `adaptive` (manual extended thinking is unsupported)
    /// - Sonnet 4.6 / Haiku 4.5: `enabled` with `budget_tokens`
    /// - GPT-5.5 / GPT-5 mini: Responses API `reasoning` with effort
    ///   (no `temperature`; reasoning models reject it)
    pub fn thinking_params(&self) -> serde_json::Value {
        match self {
            Self::Smart | Self::Opus4_7 | Self::Retired => serde_json::json!({
                "thinking": { "type": "adaptive", "display": "summarized" },
                "temperature": 1
            }),
            Self::Sonnet5 => serde_json::json!({
                "thinking": { "type": "adaptive", "display": "summarized" }
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
            Self::Smart | Self::Opus4_7 | Self::Sonnet5 | Self::Sonnet4_6 | Self::Retired => {
                1_000_000
            }
            Self::Fast | Self::Haiku4_5 => 200_000,
            Self::Gpt5_5 | Self::Gpt5Mini => 400_000,
        }
    }
}

impl std::fmt::Display for PredefinedModel {
    /// Displays the provider-qualified id (`provider/name`) the router routes on.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let model: Model = (*self).into();
        write!(f, "{}", model)
    }
}
