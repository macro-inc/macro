//! A composite action (`.github/actions/<name>/action.yml`): inputs, outputs,
//! and the steps it runs in the calling job.

use indexmap::IndexMap;
use serde::Serialize;

use crate::error::Result;
use crate::step::{Step, StepType, StepValue};

/// A composite action. Render it with [`CompositeAction::to_string`], which
/// runs the same expression checks as a workflow, against the contexts an
/// action's steps can read, and requires `shell` on every `run` step.
#[derive(Debug, Clone, Serialize)]
pub struct CompositeAction {
    name: String,
    description: String,
    #[serde(skip_serializing_if = "IndexMap::is_empty")]
    inputs: IndexMap<String, ActionInput>,
    #[serde(skip_serializing_if = "IndexMap::is_empty")]
    outputs: IndexMap<String, ActionOutput>,
    runs: CompositeRuns,
}

#[derive(Debug, Clone, Serialize)]
struct CompositeRuns {
    using: &'static str,
    steps: Vec<StepValue>,
}

/// An input of a composite action. Every input value is a string.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionInput {
    description: String,
    required: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    default: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    deprecation_message: Option<String>,
}

impl ActionInput {
    /// An input the caller must set.
    pub fn required(description: impl Into<String>) -> Self {
        Self {
            description: description.into(),
            required: true,
            default: None,
            deprecation_message: None,
        }
    }

    /// An input the caller may leave out, falling back to `default`.
    pub fn optional(description: impl Into<String>, default: impl Into<String>) -> Self {
        Self {
            description: description.into(),
            required: false,
            default: Some(default.into()),
            deprecation_message: None,
        }
    }

    /// An input the caller may leave out, which is then empty.
    pub fn optional_without_default(description: impl Into<String>) -> Self {
        Self {
            description: description.into(),
            required: false,
            default: None,
            deprecation_message: None,
        }
    }
}

/// An output of a composite action: `value` is an expression over its
/// steps.
#[derive(Debug, Clone, Serialize)]
pub struct ActionOutput {
    description: String,
    value: String,
}

impl CompositeAction {
    pub fn new(name: impl Into<String>, description: impl Into<String>) -> Self {
        Self {
            name: name.into(),
            description: description.into(),
            inputs: IndexMap::new(),
            outputs: IndexMap::new(),
            runs: CompositeRuns {
                using: "composite",
                steps: Vec::new(),
            },
        }
    }

    pub fn add_input(mut self, name: impl Into<String>, input: ActionInput) -> Self {
        self.inputs.insert(name.into(), input);
        self
    }

    /// Adds an output whose `value` is usually a step output, e.g.
    /// `STEP.outputs.name.read().to_string()`.
    pub fn add_output(
        mut self,
        name: impl Into<String>,
        description: impl Into<String>,
        value: impl ToString,
    ) -> Self {
        self.outputs.insert(
            name.into(),
            ActionOutput {
                description: description.into(),
                value: value.to_string(),
            },
        );
        self
    }

    pub fn add_step<S: Into<Step<T>>, T: StepType>(mut self, step: S) -> Self {
        self.runs.steps.push(T::to_value(step.into()));
        self
    }

    /// Render as `action.yml`.
    pub fn to_string(&self) -> Result<String> {
        crate::yaml::action_to_string(self)
    }
}

#[cfg(test)]
mod test;
