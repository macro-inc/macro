//! Native effort values. External harness settings remain opaque ACP values.

use std::str::FromStr;

/// A session override; Default preserves the model adapter's existing default.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum ReasoningEffort {
    /// Do not override the model's configured effort.
    #[default]
    Default,
    /// Disable reasoning where supported.
    None,
    /// Minimal reasoning.
    Minimal,
    /// Lower latency and token use.
    Low,
    /// Balanced reasoning.
    Medium,
    /// Thorough reasoning.
    High,
    /// Extended reasoning.
    XHigh,
    /// Maximum reasoning.
    Max,
}

impl ReasoningEffort {
    /// Explicit native capabilities, keyed by routed provider and model.
    /// Unknown models deliberately have no advertised effort control.
    #[must_use]
    pub fn supported(model: &str) -> &'static [Self] {
        use ReasoningEffort::*;
        match model {
            "anthropic/claude-sonnet-5" | "anthropic/claude-opus-5" => {
                &[Default, Low, Medium, High, XHigh, Max]
            }
            "openai/gpt-5.5" => &[Default, None, Low, Medium, High, XHigh],
            "openai/gpt-5-mini" => &[Default, Minimal, Low, Medium, High],
            _ => &[],
        }
    }

    /// Validate an explicit override without inferring capabilities from names.
    #[must_use]
    pub fn explicit_for(self, model: &str) -> Option<Self> {
        (self != Self::Default && Self::supported(model).contains(&self)).then_some(self)
    }

    /// ACP value (Default is never serialized into a provider request).
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::None => "none",
            Self::Minimal => "minimal",
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
            Self::XHigh => "xhigh",
            Self::Max => "max",
        }
    }

    /// Human-readable ACP label.
    #[must_use]
    pub const fn display_name(self) -> &'static str {
        match self {
            Self::Default => "Default",
            Self::None => "None",
            Self::Minimal => "Minimal",
            Self::Low => "Low",
            Self::Medium => "Medium",
            Self::High => "High",
            Self::XHigh => "Extra high",
            Self::Max => "Max",
        }
    }
}

impl std::fmt::Display for ReasoningEffort {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// An unrecognized native effort value.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("unknown reasoning effort `{0}`")]
pub struct ParseReasoningEffortError(String);

impl FromStr for ReasoningEffort {
    type Err = ParseReasoningEffortError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "default" => Ok(Self::Default),
            "none" => Ok(Self::None),
            "minimal" => Ok(Self::Minimal),
            "low" => Ok(Self::Low),
            "medium" => Ok(Self::Medium),
            "high" => Ok(Self::High),
            "xhigh" => Ok(Self::XHigh),
            "max" => Ok(Self::Max),
            _ => Err(ParseReasoningEffortError(value.to_owned())),
        }
    }
}
