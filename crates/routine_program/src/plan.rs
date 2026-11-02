//! What each step of a run did.

use std::fmt;

use serde::{Deserialize, Serialize};

#[cfg(test)]
mod test;

/// Where a step sits in its program: `1` is the second step. A string, so
/// run history keeps one shape.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
pub struct StepPath(String);

impl StepPath {
    /// The step at `index`.
    pub fn root(index: usize) -> Self {
        Self(index.to_string())
    }

    /// The path as written.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for StepPath {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// What a run did at one step, in the order it happened.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StepRecord {
    /// The step's place in the program when it ran.
    pub path: StepPath,
    /// Its result.
    #[serde(flatten)]
    pub result: StepResult,
}

/// The result of one step. Steps without an error succeeded.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum StepResult {
    /// A model or agent ran.
    Agent {
        /// Why it failed.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
    /// Code ran.
    Code {
        /// Its SDK calls, in the order they started.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        calls: Vec<CallRecord>,
        /// More calls ran than are recorded.
        #[serde(default, skip_serializing_if = "std::ops::Not::not")]
        calls_truncated: bool,
        /// What `main` returned.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        output: Option<serde_json::Value>,
        /// Why it failed.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<String>,
    },
}

/// One SDK call a code step made. Records no arguments or results.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct CallRecord {
    /// The SDK operation, e.g. `email.archiveThread`.
    pub operation: String,
    /// Its generic label, e.g. "Archive Thread".
    pub label: String,
    /// Whether it changes anything.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub write: bool,
    /// How it ended.
    pub status: CallStatus,
    /// When it started, in milliseconds after the step started.
    pub started_ms: u32,
    /// How long it took, once it finished.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u32>,
}

/// How one SDK call ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CallStatus {
    /// The API answered.
    Completed,
    /// The API refused or failed it.
    Failed,
    /// A dry run answered it without sending it.
    Skipped,
    /// The step may not make this change, so it wasn't sent.
    Refused,
    /// The step ended before an answer arrived; it may or may not have happened.
    Unknown,
}
