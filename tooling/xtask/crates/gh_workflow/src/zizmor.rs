//! zizmor findings kept on purpose, written next to the step they are about.
//!
//! zizmor reads `# zizmor: ignore[<rule>] <reason>` on the line it reports a
//! finding on. A step carries its ignores as [`ZizmorIgnore`]s and the emitter
//! puts each on its rule's line, so an ignore covers one step, not every file
//! with the same name.

use serde::{Serialize, Serializer};

/// A zizmor audit a step may be exempt from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ZizmorRule {
    /// A checkout that keeps its token in `.git/config` for later steps.
    Artipacked,
    /// A `run` script that writes `$GITHUB_ENV` or `$GITHUB_PATH`.
    GithubEnv,
}

impl ZizmorRule {
    /// zizmor's id for the audit.
    pub fn id(self) -> &'static str {
        match self {
            Self::Artipacked => "artipacked",
            Self::GithubEnv => "github-env",
        }
    }

    /// The step key whose line zizmor reports the finding on; `None` is the
    /// step's first line.
    fn line(self) -> Option<&'static str> {
        match self {
            Self::Artipacked => None,
            Self::GithubEnv => Some("run"),
        }
    }
}

/// One kept finding on a step: the rule and why.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ZizmorIgnore {
    /// The audit.
    pub rule: ZizmorRule,
    /// Why the finding stays; one line.
    pub reason: String,
}

impl Serialize for ZizmorIgnore {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        crate::yaml::LineComment {
            key: self.rule.line().unwrap_or_default(),
            text: format!("zizmor: ignore[{}] {}", self.rule.id(), self.reason.trim()),
        }
        .serialize(serializer)
    }
}
