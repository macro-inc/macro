//! Schema-2 fixture transport shared with the recorder.
use serde::Deserialize;
use serde_json::Value;
/// Recorded oracle case. Calls retain their tagged wire values verbatim.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Fixture {
    /// Wire schema version.
    pub schema: u32,
    /// Pinned upstream identity.
    pub source: Source,
    /// Recorder classification.
    pub tier: String,
    /// Partial traces are never accepted.
    pub partial: bool,
    /// Declared normalizations only.
    pub normalize: Vec<String>,
    /// Recorder's declared coverage.
    pub covers: Vec<String>,
    /// Production/development differences stay explicit.
    pub outcome_differs: Vec<Value>,
    /// Top-level editor configuration.
    pub config: Value,
    /// Initial state must be null in schema 2.
    pub initial: Value,
    /// Concrete operation tree.
    pub trace: Vec<Value>,
    /// Callback invocations in execution order.
    pub tapes: Vec<Tape>,
    /// Final committed snapshot.
    pub r#final: Value,
}
/// Upstream test identity.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Source {
    /// Source package repository.
    pub repo: String,
    /// Pinned version.
    pub version: String,
    /// Test source path.
    pub file: String,
    /// Full nested test name.
    pub test: Vec<String>,
    /// Recorder build identity.
    #[serde(rename = "recordedWith")]
    pub recorded_with: String,
}
/// A recorded callback, with exact argument and invocation checks.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Tape {
    /// Ordered invocations.
    pub invocations: Vec<Invocation>,
}
/// One callback result and its nested public calls.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Invocation {
    /// Expected callback arguments.
    pub args: Vec<Value>,
    /// Callback's recorded public calls.
    pub calls: Vec<Value>,
    /// Return value, including tagged undefined.
    pub ret: Option<Value>,
    /// Recorded exception.
    pub throws: Option<Value>,
}
