//! Provider-independent reasoning effort for agent-loop requests.

use std::str::FromStr;

/// How much reasoning and output work a model should spend on a request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ReasoningEffort {
    /// Prefer lower latency and token use.
    Low,
    /// Balance quality, latency, and token use.
    Medium,
    /// Prefer higher-quality, more thorough responses.
    #[default]
    High,
}

impl ReasoningEffort {
    /// Effort levels supported consistently by Macro's model providers.
    pub const ALL: [Self; 3] = [Self::Low, Self::Medium, Self::High];

    /// The provider and ACP wire value.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
        }
    }

    /// Human-readable ACP label.
    #[must_use]
    pub const fn display_name(self) -> &'static str {
        match self {
            Self::Low => "Low",
            Self::Medium => "Medium",
            Self::High => "High",
        }
    }
}

impl std::fmt::Display for ReasoningEffort {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// A value outside Macro's portable effort set.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("unknown reasoning effort `{0}`")]
pub struct ParseReasoningEffortError(String);

impl FromStr for ReasoningEffort {
    type Err = ParseReasoningEffortError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "low" => Ok(Self::Low),
            "medium" => Ok(Self::Medium),
            "high" => Ok(Self::High),
            _ => Err(ParseReasoningEffortError(value.to_owned())),
        }
    }
}
