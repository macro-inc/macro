//! Named compute tier for a managed coding-agent sandbox.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[cfg(test)]
mod test;

/// Named compute tier for a managed sandbox.
///
/// Disk is always 96 GiB; CPU and RAM vary. The API and database store the
/// name, never raw resource integers.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub enum SandboxSize {
    /// 2 vCPU / 4 GiB RAM / 96 GiB disk.
    Small,
    /// 8 vCPU / 16 GiB RAM / 96 GiB disk.
    #[default]
    Default,
    /// 16 vCPU / 32 GiB RAM / 96 GiB disk.
    Large,
}

impl SandboxSize {
    /// Wire and database form: `small`, `default`, or `large`.
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Small => "small",
            Self::Default => "default",
            Self::Large => "large",
        }
    }
}

impl std::fmt::Display for SandboxSize {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl std::str::FromStr for SandboxSize {
    type Err = SandboxSizeParseError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "small" => Ok(Self::Small),
            "default" => Ok(Self::Default),
            "large" => Ok(Self::Large),
            _ => Err(SandboxSizeParseError),
        }
    }
}

/// The string is not `small`, `default`, or `large`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SandboxSizeParseError;

impl std::fmt::Display for SandboxSizeParseError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("sandbox size must be small, default, or large")
    }
}

impl std::error::Error for SandboxSizeParseError {}
