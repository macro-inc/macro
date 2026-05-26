/// Supported models for the agent loop.
use rig_core::providers::anthropic;
use serde::{Deserialize, Serialize};
use strum::{Display, EnumIter, EnumString};
use utoipa::ToSchema;

/// Model to use for completions.
///
/// Unrecognized model strings (including retired Google/OpenAI variants
/// from older data) deserialize to `Retired` via the manual
/// `Deserialize` impl.
#[derive(
    Serialize, Debug, Clone, Copy, PartialEq, Eq, Display, EnumString, EnumIter, ToSchema, Default,
)]
#[serde(rename_all = "camelCase")]
pub enum AgentModel {
    /// Best available model
    #[default]
    Smart,
    /// Fastest available model
    Fast,
    /// Claude Opus 4.7
    Opus4_7,
    /// Claude Sonnet 4.6
    Sonnet4_6,
    /// Claude Haiku 4.5
    Haiku4_5,
    /// Retired or unrecognized model, routes to the default
    Retired,
}

impl<'de> Deserialize<'de> for AgentModel {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let s = String::deserialize(deserializer)?;
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        enum Known {
            Smart,
            Fast,
            Opus4_7,
            Sonnet4_6,
            Haiku4_5,
            Retired,
        }
        match serde_json::from_value::<Known>(serde_json::Value::String(s)) {
            Ok(Known::Smart) => Ok(Self::Smart),
            Ok(Known::Fast) => Ok(Self::Fast),
            Ok(Known::Opus4_7) => Ok(Self::Opus4_7),
            Ok(Known::Sonnet4_6) => Ok(Self::Sonnet4_6),
            Ok(Known::Haiku4_5) => Ok(Self::Haiku4_5),
            Ok(Known::Retired) => Ok(Self::Retired),
            Err(_) => Ok(Self::Retired),
        }
    }
}

impl AgentModel {
    /// Returns the Anthropic API model identifier.
    pub fn api_id(&self) -> &'static str {
        match self {
            Self::Smart | Self::Opus4_7 | Self::Retired => anthropic::completion::CLAUDE_OPUS_4_7,
            Self::Fast | Self::Haiku4_5 => anthropic::completion::CLAUDE_HAIKU_4_5,
            Self::Sonnet4_6 => anthropic::completion::CLAUDE_SONNET_4_6,
        }
    }

    /// Returns `additional_params` JSON to enable extended thinking.
    ///
    /// - Opus 4.7: `adaptive` (model chooses when to think)
    /// - Sonnet 4.6 / Haiku 4.5: `enabled` with `budget_tokens`
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
        }
    }

    /// Context window size in tokens.
    pub fn context_window(&self) -> u64 {
        match self {
            Self::Smart | Self::Opus4_7 | Self::Sonnet4_6 | Self::Retired => 1_000_000,
            Self::Fast | Self::Haiku4_5 => 200_000,
        }
    }

    /// API provider name.
    pub fn provider(&self) -> &'static str {
        "anthropic"
    }

    /// from json or Retired
    pub fn from_json_or_default(json: &str) -> Self {
        serde_json::from_str(json).unwrap_or(Self::Retired)
    }
}

#[cfg(test)]
mod test;
