//! Provider speed selection, independent of model identity and reasoning effort.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

/// The requested inference speed. Standard is backward compatible with old clients.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ModelSpeed {
    /// Use the model's standard processing tier.
    #[default]
    Standard,
    /// Use Anthropic's faster Opus inference.
    Fast,
    /// Use OpenAI's fastest Responses processing tier.
    Ultrafast,
}

impl ModelSpeed {
    /// Whether this model supports the requested speed.
    pub fn supported(self, model: &str) -> bool {
        match self {
            Self::Standard => true,
            Self::Fast => model == "anthropic/claude-opus-5-5",
            Self::Ultrafast => matches!(model, "openai/gpt-6-astra" | "openai/gpt-6.1-sol"),
        }
    }

    /// Models whose usage must be priced per provider call, including long context.
    pub fn has_per_call_pricing(model: &str) -> bool {
        matches!(
            model,
            "openai/gpt-6-astra" | "openai/gpt-6.1-sol" | "anthropic/claude-opus-5-5"
        )
    }

    /// Stable serialized value used by native session configuration.
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Standard => "standard",
            Self::Fast => "fast",
            Self::Ultrafast => "ultrafast",
        }
    }

    /// Parse an advertised native session value.
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "standard" => Some(Self::Standard),
            "fast" => Some(Self::Fast),
            "ultrafast" => Some(Self::Ultrafast),
            _ => None,
        }
    }

    /// Add the provider-specific setting without changing reasoning parameters.
    pub(crate) fn apply(self, model: &str, params: &mut serde_json::Value) {
        match self {
            Self::Standard if model.starts_with("openai/") => {
                params["service_tier"] = "default".into()
            }
            Self::Standard => {}
            Self::Fast => params["speed"] = "fast".into(),
            Self::Ultrafast => params["service_tier"] = "ultrafast".into(),
        }
    }
}

#[cfg(test)]
mod test;
