//!
//! Step-related structures and implementations for GitHub workflow steps.

use derive_setters::Setters;
use indexmap::IndexMap;
use merge::Merge;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{private, Env, Expression, ZizmorIgnore, ZizmorRule};

/// Represents a step in the workflow.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(transparent)]
pub struct Step<A> {
    /// The value of the step.
    pub value: StepValue,
    #[serde(skip)]
    pub marker: A,
}

impl From<Step<Run>> for StepValue {
    /// Converts a `Step<Run>` into a `StepValue`.
    fn from(step: Step<Run>) -> Self {
        step.value
    }
}

impl From<Step<Use>> for StepValue {
    /// Converts a `Step<Use>` into a `StepValue`.
    fn from(step: Step<Use>) -> Self {
        step.value
    }
}

/// Represents a step that uses an action.
#[derive(Debug, Default, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct Use;

/// Represents a step that runs a command.
#[derive(Debug, Default, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct Run;

/// A trait to convert `Step<Run>` and `Step<Use>` to `StepValue`.
pub trait StepType: Sized + private::Sealed {
    /// Converts a step to its value representation.
    fn to_value(s: Step<Self>) -> StepValue;
}

impl private::Sealed for Run {}
impl private::Sealed for Use {}

impl StepType for Run {
    /// Converts a `Step<Run>` to `StepValue`.
    fn to_value(s: Step<Self>) -> StepValue {
        s.into()
    }
}

impl StepType for Use {
    /// Converts a `Step<Use>` to `StepValue`.
    fn to_value(s: Step<Self>) -> StepValue {
        s.into()
    }
}

/// Represents input parameters for a step.
#[derive(Debug, Default, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(transparent)]
pub struct Input(#[serde(skip_serializing_if = "IndexMap::is_empty")] pub IndexMap<String, Value>);

impl From<IndexMap<String, Value>> for Input {
    /// Converts an `IndexMap` into an `Input`.
    fn from(value: IndexMap<String, Value>) -> Self {
        Self(value)
    }
}

impl Merge for Input {
    /// Merges another `Input` into this one.
    fn merge(&mut self, other: Self) {
        self.0.extend(other.0);
    }
}

impl Input {
    /// Adds a new input parameter to the `Input`.
    pub fn add<S: ToString, V: Into<Value>>(mut self, key: S, value: V) -> Self {
        self.0.insert(key.to_string(), value.into());
        self
    }

    /// Checks if the `Input` is empty.
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

/// Represents a step value in the workflow.
#[allow(clippy::duplicated_attributes)]
#[derive(Debug, Setters, Serialize, Deserialize, Clone, Default, PartialEq, Eq, Merge)]
#[serde(rename_all = "kebab-case")]
#[setters(
    strip_option,
    into,
    generate_delegates(ty = "Step<Run>", field = "value"),
    generate_delegates(ty = "Step<Use>", field = "value")
)]
pub struct StepValue {
    /// The ID of the step.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[merge(strategy = merge::option::overwrite_none)]
    pub id: Option<String>,

    /// The name of the step.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[merge(strategy = merge::option::overwrite_none)]
    pub name: Option<String>,

    /// The condition under which the step runs.
    #[serde(skip_serializing_if = "Option::is_none", rename = "if")]
    #[merge(strategy = merge::option::overwrite_none)]
    pub if_condition: Option<Expression>,

    /// The action to use in the step.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[setters(skip)]
    #[merge(strategy = merge::option::overwrite_none)]
    pub uses: Option<Uses>,

    /// Input parameters for the step.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[merge(strategy = merge::option::overwrite_none)]
    pub with: Option<Input>,

    /// The command to run in the step.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[setters(skip)]
    #[merge(strategy = merge::option::overwrite_none)]
    pub run: Option<String>,

    /// Shell to run with
    #[serde(skip_serializing_if = "Option::is_none")]
    #[merge(strategy = merge::option::overwrite_none)]
    pub shell: Option<String>,

    /// Environment variables for the step.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[merge(strategy = merge::option::overwrite_none)]
    pub env: Option<Env>,

    /// The timeout for the step in minutes.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[merge(strategy = merge::option::overwrite_none)]
    pub timeout_minutes: Option<u32>,

    /// Whether to continue on error.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[merge(strategy = merge::option::overwrite_none)]
    pub continue_on_error: Option<bool>,

    /// The working directory for the step.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[merge(strategy = merge::option::overwrite_none)]
    pub working_directory: Option<String>,

    /// zizmor findings kept on purpose, rendered as comments on the lines
    /// zizmor reports them on, not as a key.
    #[serde(
        rename = "\u{0}comments",
        default,
        skip_deserializing,
        skip_serializing_if = "Vec::is_empty"
    )]
    #[setters(skip)]
    #[merge(strategy = merge::vec::append)]
    pub zizmor_ignores: Vec<ZizmorIgnore>,
}

impl StepValue {
    /// Creates a new `StepValue` that runs the provided shell command.
    pub fn run<T: ToString>(cmd: T) -> Self {
        Self {
            run: Some(cmd.to_string()),
            ..Default::default()
        }
    }

    /// Creates a new `StepValue` that uses an action.
    pub fn uses(uses: Uses) -> Self {
        Self {
            uses: Some(uses),
            ..Default::default()
        }
    }
}

/// What a step's `uses:` points at.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Uses {
    /// A published action, `owner/repo[/path]@version`.
    Action {
        owner: String,
        repo: String,
        version: String,
    },
    /// An action in this repository, rendered `./<path>`.
    Local(String),
    /// A Docker Hub or registry image, rendered `docker://<image>`.
    Docker(String),
}

impl std::fmt::Display for Uses {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Action {
                owner,
                repo,
                version,
            } => write!(f, "{owner}/{repo}@{version}"),
            Self::Local(path) => write!(f, "./{path}"),
            Self::Docker(image) => write!(f, "docker://{image}"),
        }
    }
}

impl Serialize for Uses {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for Uses {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        if let Some(path) = text.strip_prefix("./") {
            return Ok(Self::Local(path.to_string()));
        }
        if let Some(image) = text.strip_prefix("docker://") {
            return Ok(Self::Docker(image.to_string()));
        }

        let (action, version) = text
            .split_once('@')
            .ok_or_else(|| serde::de::Error::custom(format!("`{text}` has no @version")))?;
        let (owner, repo) = action
            .split_once('/')
            .ok_or_else(|| serde::de::Error::custom(format!("`{text}` has no owner/repo")))?;
        Ok(Self::Action {
            owner: owner.to_string(),
            repo: repo.to_string(),
            version: version.to_string(),
        })
    }
}

/// Represents a step in the workflow.
impl<T> Step<T> {
    /// Drops the step's `name:`, so the job log labels it with what it runs.
    pub fn without_name(mut self) -> Self {
        self.value.name = None;
        self
    }

    /// Keeps the zizmor finding `rule` on this step, for `reason` (one line).
    pub fn zizmor_ignore(mut self, rule: ZizmorRule, reason: impl ToString) -> Self {
        self.value.zizmor_ignores.push(ZizmorIgnore {
            rule,
            reason: reason.to_string(),
        });
        self
    }

    /// Adds an environment variable to the step.
    pub fn add_env<R: Into<Env>>(mut self, new_env: R) -> Self {
        let mut env = self.value.env.take().unwrap_or_default();

        env.0.extend(new_env.into().0);
        self.value.env = Some(env);
        self
    }
}

impl Step<()> {
    pub fn new(name: impl ToString) -> Self {
        Self {
            value: StepValue::default().name(name.to_string()),
            marker: Default::default(),
        }
    }

    /// Uses the action `owner/repo[/path]@version`.
    pub fn uses<Owner: ToString, Repo: ToString, Version: ToString>(
        self,
        owner: Owner,
        repo: Repo,
        version: Version,
    ) -> Step<Use> {
        self.uses_ref(Uses::Action {
            owner: owner.to_string(),
            repo: repo.to_string(),
            version: version.to_string(),
        })
    }

    /// Uses the action defined in this repository at `path` (no leading `./`).
    pub fn uses_local(self, path: impl ToString) -> Step<Use> {
        self.uses_ref(Uses::Local(path.to_string()))
    }

    fn uses_ref(mut self, uses: Uses) -> Step<Use> {
        self.value.merge(StepValue::uses(uses));
        Step {
            value: self.value,
            marker: Default::default(),
        }
    }

    pub fn run(mut self, cmd: impl ToString) -> Step<Run> {
        self.value.merge(StepValue::run(cmd));
        Step {
            value: self.value,
            marker: Default::default(),
        }
    }
}

/// Represents a step that uses an action.
impl Step<Use> {
    /// Adds a new input to the step.
    pub fn add_with<I: Into<Input>>(mut self, new_with: I) -> Self {
        let mut with = self.value.with.take().unwrap_or_default();
        with.merge(new_with.into());
        if with.0.is_empty() {
            self.value.with = None;
        } else {
            self.value.with = Some(with);
        }

        self
    }
}

/// Represents a key-value pair for inputs.
impl<S1: ToString, S2: ToString> From<(S1, S2)> for Input {
    /// Converts a tuple into an `Input`.
    fn from(value: (S1, S2)) -> Self {
        let mut index_map: IndexMap<String, Value> = IndexMap::new();
        index_map.insert(value.0.to_string(), Value::String(value.1.to_string()));
        Self(index_map)
    }
}
