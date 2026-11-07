//! Variables: values per mode (`VARIABLE` nodes) grouped in collections
//! (`VARIABLE_SET` nodes, which list the modes), and the modes frames pick.

use super::{Color, Guid};
use std::sync::Arc;

/// What a variable holds.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VariableType {
    Color,
    Float,
    String,
    Boolean,
    Other,
}

impl VariableType {
    pub fn parse(s: &str) -> VariableType {
        match s {
            "COLOR" => VariableType::Color,
            "FLOAT" => VariableType::Float,
            "STRING" => VariableType::String,
            "BOOLEAN" => VariableType::Boolean,
            _ => VariableType::Other,
        }
    }

    pub fn name(self) -> &'static str {
        match self {
            VariableType::Color => "COLOR",
            VariableType::Float => "FLOAT",
            VariableType::String => "STRING",
            VariableType::Boolean => "BOOLEAN",
            VariableType::Other => "OTHER",
        }
    }
}

/// A variable's value in one mode.
#[derive(Clone, Debug, PartialEq)]
pub enum VariableValue {
    Color(Color),
    Float(f32),
    Text(Arc<str>),
    Bool(bool),
    /// The value of another variable.
    Alias(Guid),
    Other,
}

/// A variable: its collection, kind, and value per mode.
#[derive(Clone, Debug, PartialEq)]
pub struct Variable {
    pub set: Option<Guid>,
    pub resolved_type: VariableType,
    pub values: Arc<[(Guid, VariableValue)]>,
}

/// A mode of a variable collection.
#[derive(Clone, Debug, PartialEq)]
pub struct VariableMode {
    pub id: Guid,
    pub name: Arc<str>,
}
