//! Sub-routines a routine defines: written once with the routine and checked
//! with it, then scheduled by its runs as copies that differ only in their
//! trigger and the values of their inputs.

use std::fmt;

use bots::domain::models::AgentMcpServer;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::model::{RoutineProgram, Step};

#[cfg(test)]
mod test;

/// Characters in a text input's value.
pub const MAX_INPUT_TEXT_CHARS: usize = 2_000;

/// A routine a routine's runs schedule copies of. It is written once, with
/// the routine that defines it, and checked with it. A copy holds only its
/// trigger and the values of its inputs, and runs these steps as they are
/// when it runs, so an edit here reaches the copies that haven't run yet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = RoutineSubRoutine))]
#[serde(deny_unknown_fields)]
pub struct SubRoutineDefinition {
    /// How the routine's code schedules a copy:
    /// `macro.routines.schedule('<name>', { trigger, inputs })`.
    pub name: SubRoutineName,
    /// What a copy does, in a few words; copies are named after it.
    pub title: String,
    /// The values each copy is given when it is scheduled: its code reads
    /// them as `inputs.<name>`, and its Ask AI step sees them as data.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub inputs: Vec<Input>,
    /// What a copy does when it runs, in order.
    pub steps: Vec<Step>,
    /// Apps a copy's Ask AI step requires, as a routine's `mcp_servers`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub mcp_servers: Vec<AgentMcpServer>,
}

/// A value a sub-routine's copy is given when it is scheduled, which its
/// code reads as `inputs.<name>`. A definition declares it without a value;
/// a routine kept from a copy holds the value the copy was given.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = RoutineInput))]
#[serde(tag = "type", rename_all = "snake_case", deny_unknown_fields)]
pub enum Input {
    /// Text, such as an item's id or name.
    Text {
        /// How the code reads it: `inputs.<name>`.
        name: InputName,
        /// What it is, for the owner, e.g. "Task".
        label: String,
        /// The value a copy was given.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        value: Option<String>,
    },
    /// A number.
    Number {
        /// How the code reads it: `inputs.<name>`.
        name: InputName,
        /// What it is, for the owner.
        label: String,
        /// The value a copy was given.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        value: Option<f64>,
    },
    /// Yes or no.
    Boolean {
        /// How the code reads it: `inputs.<name>`.
        name: InputName,
        /// What it is, for the owner.
        label: String,
        /// The value a copy was given.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        value: Option<bool>,
    },
}

impl Input {
    /// How the code reads it.
    pub fn name(&self) -> &InputName {
        match self {
            Self::Text { name, .. } | Self::Number { name, .. } | Self::Boolean { name, .. } => {
                name
            }
        }
    }

    /// What it is, for the owner.
    pub fn label(&self) -> &str {
        match self {
            Self::Text { label, .. } | Self::Number { label, .. } | Self::Boolean { label, .. } => {
                label
            }
        }
    }

    /// Its value as the code receives it, when it has one.
    pub fn value(&self) -> Option<Value> {
        match self {
            Self::Text { value, .. } => value.clone().map(Value::String),
            Self::Number { value, .. } => value
                .and_then(serde_json::Number::from_f64)
                .map(Value::Number),
            Self::Boolean { value, .. } => value.map(Value::Bool),
        }
    }

    /// Its TypeScript type in the code's `inputs`.
    pub(crate) fn ts_type(&self) -> &'static str {
        match self {
            Self::Text { .. } => "string",
            Self::Number { .. } => "number",
            Self::Boolean { .. } => "boolean",
        }
    }

    /// This input with `value`, when the value fits its type.
    fn given(&self, value: &Value) -> Result<Self, InputError> {
        let name = self.name().clone();
        let label = self.label().to_owned();
        let wrong_type = || InputError::WrongType {
            name: name.to_string(),
            expected: self.ts_type(),
        };
        match self {
            Self::Text { .. } => {
                let text = value.as_str().ok_or_else(wrong_type)?;
                if text.chars().count() > MAX_INPUT_TEXT_CHARS {
                    return Err(InputError::TooLong(name.to_string()));
                }
                // Stored as JSONB, which can't hold one.
                if text.contains('\0') {
                    return Err(InputError::Nul(name.to_string()));
                }
                Ok(Self::Text {
                    name,
                    label,
                    value: Some(text.to_owned()),
                })
            }
            Self::Number { .. } => {
                let number = value
                    .as_f64()
                    .filter(|number| number.is_finite())
                    .ok_or_else(wrong_type)?;
                Ok(Self::Number {
                    name,
                    label,
                    value: Some(number),
                })
            }
            Self::Boolean { .. } => Ok(Self::Boolean {
                value: Some(value.as_bool().ok_or_else(wrong_type)?),
                name,
                label,
            }),
        }
    }
}

/// Names a sub-routine: a lowercase letter, then up to 31 lowercase
/// letters, digits or underscores, e.g. `remind_about_task`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(try_from = "String", into = "String")]
pub struct SubRoutineName(String);

impl SubRoutineName {
    /// The name as written.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for SubRoutineName {
    type Error = InvalidSubRoutineName;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        let mut chars = value.chars();
        let valid = value.len() <= 32
            && chars.next().is_some_and(|first| first.is_ascii_lowercase())
            && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
        if valid {
            Ok(Self(value))
        } else {
            Err(InvalidSubRoutineName(value))
        }
    }
}

impl From<SubRoutineName> for String {
    fn from(name: SubRoutineName) -> Self {
        name.0
    }
}

impl fmt::Display for SubRoutineName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// A sub-routine name that is not a lowercase identifier.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error(
    "sub-routine name `{0}` must be a lowercase letter followed by up to 31 lowercase letters, digits or underscores, e.g. `remind_about_task`"
)]
pub struct InvalidSubRoutineName(String);

/// How code reads an input: a lowercase letter, then up to 31 letters or
/// digits, e.g. `taskId`.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(try_from = "String", into = "String")]
pub struct InputName(String);

impl InputName {
    /// The name as written.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for InputName {
    type Error = InvalidInputName;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        let mut chars = value.chars();
        let valid = value.len() <= 32
            && chars.next().is_some_and(|first| first.is_ascii_lowercase())
            && chars.all(|c| c.is_ascii_alphanumeric());
        if valid {
            Ok(Self(value))
        } else {
            Err(InvalidInputName(value))
        }
    }
}

impl From<InputName> for String {
    fn from(name: InputName) -> Self {
        name.0
    }
}

impl fmt::Display for InputName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

/// An input name that isn't a camelCase identifier.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error(
    "input name `{0}` must be a lowercase letter followed by up to 31 letters or digits, e.g. `taskId`"
)]
pub struct InvalidInputName(String);

/// The task of a routine scheduled from a sub-routine: which of its
/// parent's definitions it runs, and the values its inputs were given. It
/// holds no steps: it runs the definition as the parent holds it when it
/// runs.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "schema", schema(as = RoutineSubRoutineCopy))]
#[serde(deny_unknown_fields)]
pub struct SubRoutineCopy {
    /// The definition it runs, by name.
    pub sub_routine: SubRoutineName,
    /// Each input's value, by name.
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    #[cfg_attr(feature = "schema", schema(value_type = Object))]
    pub inputs: Map<String, Value>,
}

impl SubRoutineCopy {
    /// The copy a stored task is; `None` for a program or an agent task.
    pub fn from_task(task: &Value) -> Option<Self> {
        task.get("sub_routine")?;
        serde_json::from_value(task.clone()).ok()
    }

    /// The task it is stored as.
    pub fn task(&self) -> Value {
        serde_json::json!(self)
    }
}

/// Why a copy can't run its definition, for the owner.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum CopyError {
    /// The parent no longer defines it.
    #[error("the routine that scheduled this one no longer has a sub-routine named `{0}`")]
    UnknownSubRoutine(SubRoutineName),
    /// Its values don't fit the definition's inputs.
    #[error("{0}")]
    Inputs(#[from] InputError),
}

/// Values that don't fit a sub-routine's inputs.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum InputError {
    /// A declared input without a value.
    #[error("input `{0}` needs a value")]
    Missing(String),
    /// A value for an input the sub-routine doesn't declare.
    #[error("the sub-routine has no input `{0}`")]
    Unknown(String),
    /// A value under a key no input could have. The key isn't quoted: it
    /// is the caller's text, and could be anything.
    #[error(
        "a value was given under a key that isn't an input name: a lowercase letter followed by up to 31 letters or digits"
    )]
    NotAnInputName,
    /// A value of the wrong type.
    #[error("input `{name}` takes a {expected}")]
    WrongType {
        /// The input.
        name: String,
        /// Its TypeScript type.
        expected: &'static str,
    },
    /// A long text value.
    #[error("input `{0}` can be at most {MAX_INPUT_TEXT_CHARS} characters")]
    TooLong(String),
    /// A text value holding a NUL character.
    #[error("input `{0}` can't hold a NUL character")]
    Nul(String),
}

impl SubRoutineDefinition {
    /// Its inputs with `values`, by name: every input needs one that fits
    /// its type, and no other value is taken.
    pub fn given(&self, values: &Map<String, Value>) -> Result<Vec<Input>, InputError> {
        if let Some(unknown) = values.keys().find(|key| {
            !self
                .inputs
                .iter()
                .any(|input| input.name().as_str() == *key)
        }) {
            return Err(match InputName::try_from(unknown.clone()) {
                Ok(_) => InputError::Unknown(unknown.clone()),
                Err(_) => InputError::NotAnInputName,
            });
        }
        self.inputs
            .iter()
            .map(|input| {
                let value = values
                    .get(input.name().as_str())
                    .ok_or_else(|| InputError::Missing(input.name().to_string()))?;
                input.given(value)
            })
            .collect()
    }
}

impl RoutineProgram {
    /// The sub-routine it defines under `name`.
    pub fn sub_routine(&self, name: &SubRoutineName) -> Option<&SubRoutineDefinition> {
        self.sub_routines
            .iter()
            .find(|definition| &definition.name == name)
    }

    /// What `copy` runs: its definition's steps and apps with the values it
    /// was given, checked against the SDK this routine was. It never writes
    /// as the owner, whatever this routine does: a run chose its values, and
    /// no person reviewed them. It keeps this routine's sub-routines, so its
    /// code schedules the same ones.
    pub fn copy_program(&self, copy: &SubRoutineCopy) -> Result<RoutineProgram, CopyError> {
        let definition = self
            .sub_routine(&copy.sub_routine)
            .ok_or_else(|| CopyError::UnknownSubRoutine(copy.sub_routine.clone()))?;
        Ok(RoutineProgram {
            steps: definition.steps.clone(),
            mcp_servers: definition.mcp_servers.clone(),
            single_agent_task: false,
            sdk: self.sdk.clone(),
            dangerously_operate_as_user: false,
            inputs: definition.given(&copy.inputs)?,
            sub_routines: self.sub_routines.clone(),
        })
    }

    /// Each input's value by name: `main`'s `inputs`.
    pub fn input_values(&self) -> Map<String, Value> {
        self.inputs
            .iter()
            .filter_map(|input| Some((input.name().to_string(), input.value()?)))
            .collect()
    }
}
