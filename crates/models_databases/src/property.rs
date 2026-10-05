//! A column's type and options in the terms the properties system stores
//! them, shared by the domain and the engine's catalog schema.

#[cfg(test)]
mod test;

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::cast::{CastKind, number_label};
use crate::ops::EntityKind;

/// The property types, spelled as the properties system spells them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum DataType {
    /// Free text.
    String,
    /// A number.
    Number,
    /// A checkbox.
    Boolean,
    /// A date-time.
    Date,
    /// A URL.
    Link,
    /// Text options.
    SelectString,
    /// Numeric options.
    SelectNumber,
    /// Colored labels.
    Tag,
    /// References to entities.
    Entity,
}

impl DataType {
    /// Whether the type's cells are drawn from an explicit set of options.
    pub fn takes_options(self) -> bool {
        matches!(
            self,
            DataType::SelectString | DataType::SelectNumber | DataType::Tag
        )
    }
}

/// An option's value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", content = "value", rename_all = "camelCase")]
pub enum OptionValue {
    /// A text option.
    String(String),
    /// A numeric option.
    Number(f64),
}

impl OptionValue {
    /// The label users write for the option.
    pub fn label(&self) -> String {
        match self {
            OptionValue::String(text) => text.clone(),
            OptionValue::Number(number) => number_label(*number),
        }
    }
}

/// The one rule from a stored type to the kind of values a column holds.
/// A relation holds rows whatever its stored type; an entity column with no
/// target points at people; a tag always holds several labels.
pub fn stored_cast_kind(
    data_type: DataType,
    multi: bool,
    target: Option<EntityKind>,
    relation: bool,
) -> CastKind {
    if relation {
        return CastKind::Relation;
    }
    match data_type {
        DataType::String => CastKind::Text,
        DataType::Number => CastKind::Number,
        DataType::Boolean => CastKind::Boolean,
        DataType::Date => CastKind::Date,
        DataType::Link => CastKind::Link,
        DataType::SelectString | DataType::SelectNumber => CastKind::Select { multi },
        DataType::Tag => CastKind::Select { multi: true },
        DataType::Entity => CastKind::Entity {
            target: target.unwrap_or(EntityKind::User),
            multi,
        },
    }
}
