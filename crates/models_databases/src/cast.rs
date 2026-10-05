//! Which column type changes keep a column's values: the one rule every
//! type change consults before touching data.

#[cfg(test)]
mod test;

use std::fmt;

use crate::ops::{ColumnKind, EntityKind};
use crate::views::ValueKind;

/// Whether a column has any values. Emptiness is a fact about the data, not
/// the type: an empty column can take any type.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Contents {
    /// No cell has a value.
    Empty,
    /// At least one cell has a value.
    Filled,
}

/// What changing a column from one type to another does to its values.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Cast {
    /// Every value converts.
    Safe,
    /// Some values may not convert; each must be checked first.
    Checked,
    /// No value converts; why, in one line.
    Never(&'static str),
}

/// A column's values as the cast rule reads them. Numeric selects and tags
/// are selects: their options convert the same way.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CastKind {
    /// Free text.
    Text,
    /// A number.
    Number,
    /// A checkbox.
    Boolean,
    /// A date-time.
    Date,
    /// A URL.
    Link,
    /// Options.
    Select {
        /// Whether a cell holds several options.
        multi: bool,
    },
    /// References to Macro entities.
    Entity {
        /// What the references point at.
        target: EntityKind,
        /// Whether a cell holds several references.
        multi: bool,
    },
    /// Rows of another table.
    Relation,
}

impl From<ColumnKind> for CastKind {
    fn from(kind: ColumnKind) -> Self {
        match kind {
            ColumnKind::Text => CastKind::Text,
            ColumnKind::Number => CastKind::Number,
            ColumnKind::Boolean => CastKind::Boolean,
            ColumnKind::Date => CastKind::Date,
            ColumnKind::Link => CastKind::Link,
            ColumnKind::Select { multi } | ColumnKind::SelectNumber { multi } => {
                CastKind::Select { multi }
            }
            ColumnKind::Tag => CastKind::Select { multi: true },
            ColumnKind::Entity { target, multi } => CastKind::Entity { target, multi },
            ColumnKind::Relation { .. } => CastKind::Relation,
        }
    }
}

/// The types a column is offered to change to, in menu order.
pub const TARGETS: [ColumnKind; 10] = [
    ColumnKind::Text,
    ColumnKind::Number,
    ColumnKind::Select { multi: false },
    ColumnKind::Select { multi: true },
    ColumnKind::Date,
    ColumnKind::Boolean,
    ColumnKind::Link,
    ColumnKind::Entity {
        target: EntityKind::User,
        multi: false,
    },
    ColumnKind::Entity {
        target: EntityKind::Document,
        multi: false,
    },
    ColumnKind::Entity {
        target: EntityKind::Task,
        multi: false,
    },
];

/// A column type's name as the type menu, the agent tools and `ALTER COLUMN`
/// spell it; `entity` is followed by its kind, `entity(USER)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::EnumString, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case", ascii_case_insensitive)]
pub enum ColumnTypeName {
    /// `text`.
    Text,
    /// `number`.
    Number,
    /// `boolean`.
    Boolean,
    /// `date`.
    Date,
    /// `link`.
    Link,
    /// `select`.
    Select,
    /// `select_number`.
    SelectNumber,
    /// `tag`.
    Tag,
    /// `entity(KIND)`.
    Entity,
    /// `relation`.
    Relation,
}

impl ColumnKind {
    /// The name of the column's type.
    pub fn type_name(&self) -> ColumnTypeName {
        match self {
            ColumnKind::Text => ColumnTypeName::Text,
            ColumnKind::Number => ColumnTypeName::Number,
            ColumnKind::Boolean => ColumnTypeName::Boolean,
            ColumnKind::Date => ColumnTypeName::Date,
            ColumnKind::Link => ColumnTypeName::Link,
            ColumnKind::Select { .. } => ColumnTypeName::Select,
            ColumnKind::SelectNumber { .. } => ColumnTypeName::SelectNumber,
            ColumnKind::Tag => ColumnTypeName::Tag,
            ColumnKind::Entity { .. } => ColumnTypeName::Entity,
            ColumnKind::Relation { .. } => ColumnTypeName::Relation,
        }
    }
}

/// A type as [`ColumnTypeName`] spells it, with `[]` when a select or
/// reference column holds several values: `text`, `select[]`, `entity(USER)`.
impl fmt::Display for ColumnKind {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let name: &'static str = self.type_name().into();
        f.write_str(name)?;
        let multi = match self {
            ColumnKind::Select { multi } | ColumnKind::SelectNumber { multi } => *multi,
            ColumnKind::Entity { target, multi } => {
                write!(f, "({})", target.name())?;
                *multi
            }
            _ => false,
        };
        if multi {
            f.write_str("[]")?;
        }
        Ok(())
    }
}

/// A [`ColumnKind`] that serializes as its SQL spelling (`select[]`,
/// `entity(USER)`), for responses that list types to change to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SpelledColumnType(pub ColumnKind);

impl serde::Serialize for SpelledColumnType {
    fn serialize<Serializer: serde::Serializer>(
        &self,
        serializer: Serializer,
    ) -> Result<Serializer::Ok, Serializer::Error> {
        serializer.collect_str(&self.0)
    }
}

#[cfg(feature = "schema")]
impl schemars::JsonSchema for SpelledColumnType {
    fn schema_name() -> std::borrow::Cow<'static, str> {
        "SpelledColumnType".into()
    }

    fn json_schema(_generator: &mut schemars::SchemaGenerator) -> schemars::Schema {
        schemars::json_schema!({
            "type": "string",
            "description": "A column type as SQL spells it: text, number, boolean, date, link, \
        select, select_number, tag, entity(KIND) or relation, with [] when a select or reference \
        column holds several values (select[], entity(USER)).",
        })
    }
}

impl CastKind {
    /// The kind of value the column holds, as a view's filters test it.
    pub fn value_kind(self) -> ValueKind {
        match self {
            CastKind::Text | CastKind::Link => ValueKind::Text,
            CastKind::Number => ValueKind::Number,
            CastKind::Date => ValueKind::Date,
            CastKind::Boolean => ValueKind::Checkbox,
            CastKind::Select { .. } => ValueKind::Options,
            CastKind::Entity { .. } | CastKind::Relation => ValueKind::Entities,
        }
    }
}

const TO_REFERENCES: &str = "Only an empty column can become a reference column.";
const TO_RELATION: &str =
    "Only an empty column can become a relation: existing values aren't rows.";
const FROM_RELATION: &str = "A relation's linked rows can't be converted; remove them first.";
const ACROSS_ENTITIES: &str = "References can't change what they point at.";
const ENTITY_TO_VALUE: &str = "References can't become plain values.";
const NUMBER_TO_DATE: &str = "Numbers aren't dates.";
const NUMBER_TO_CHECKBOX: &str = "Numbers aren't checkboxes.";
const NUMBER_TO_URL: &str = "Numbers aren't URLs.";
const FROM_CHECKBOX: &str = "A checkbox can only become text.";
const FROM_DATE: &str = "A date can only become text.";
const FROM_URL: &str = "A URL can only become text or a single select.";

/// What changing a column of kind `from` to kind `to` does to its values.
pub fn cast(from: CastKind, to: CastKind, contents: Contents) -> Cast {
    use Cast::{Checked, Never, Safe};
    use CastKind::{Boolean, Date, Entity, Link, Number, Relation, Select, Text};

    match (from, to) {
        _ if contents == Contents::Empty => Safe,

        (Relation, _) => Never(FROM_RELATION),
        (_, Relation) => Never(TO_RELATION),
        (Entity { target: from, .. }, Entity { target: to, .. }) if from != to => {
            Never(ACROSS_ENTITIES)
        }
        (Entity { multi: true, .. }, Entity { multi: false, .. }) => Checked,
        (Entity { .. }, Entity { .. }) => Safe,
        (Entity { .. }, _) => Never(ENTITY_TO_VALUE),
        (_, Entity { .. }) => Never(TO_REFERENCES),

        (Text, Text) => Safe,
        (Text, Number | Date | Boolean | Link | Select { .. }) => Checked,

        (Number, Text | Number | Select { .. }) => Safe,
        (Number, Date) => Never(NUMBER_TO_DATE),
        (Number, Boolean) => Never(NUMBER_TO_CHECKBOX),
        (Number, Link) => Never(NUMBER_TO_URL),

        (Boolean, Text | Boolean) => Safe,
        (Boolean, _) => Never(FROM_CHECKBOX),

        (Date, Text | Date) => Safe,
        (Date, _) => Never(FROM_DATE),

        (Select { multi: false }, Text | Select { .. }) => Safe,
        (Select { multi: false }, Number | Link | Date | Boolean) => Checked,

        (Select { multi: true }, Select { multi: true }) => Safe,
        (Select { multi: true }, Text | Select { .. } | Number | Link | Date | Boolean) => Checked,

        (Link, Text | Link) => Safe,
        (Link, Select { multi: false }) => Checked,
        (Link, _) => Never(FROM_URL),
    }
}

/// A number the way an option's label shows it: no trailing `.0` on whole
/// numbers.
pub fn number_label(number: f64) -> String {
    if number.fract() == 0.0 && number.abs() < 1e15 {
        format!("{}", number as i64)
    } else {
        number.to_string()
    }
}
