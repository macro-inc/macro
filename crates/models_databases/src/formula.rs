//! A derived column's formula: arithmetic over the other columns of the same
//! row. It names columns by id, so renaming one keeps the formula; the text
//! users read and type (`{Unit price} * Quantity`) is rendered and parsed by
//! the engine, against the table's current names.

use serde::{Deserialize, Serialize};

use crate::ids::ColumnId;

/// An expression over one row's cells.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Formula {
    /// The row's cell in another column of the table: a number, date or
    /// derived column.
    Column {
        /// The column placement.
        #[schema(value_type = Uuid)]
        column: ColumnId,
    },
    /// A constant. Added to or subtracted from a date, it counts days.
    Number {
        /// The value; finite.
        value: f64,
    },
    /// Two expressions combined.
    Binary {
        /// How.
        operator: Operator,
        /// The left operand.
        #[schema(no_recursion)]
        left: Box<Formula>,
        /// The right operand.
        #[schema(no_recursion)]
        right: Box<Formula>,
    },
    /// An expression's negation.
    Negate {
        /// The expression negated; a number.
        #[schema(no_recursion)]
        operand: Box<Formula>,
    },
}

/// An arithmetic operator.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema, specta::Type,
)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum Operator {
    /// `+`: numbers, or days onto a date.
    Add,
    /// `-`: numbers, days off a date, or the days between two dates.
    Subtract,
    /// `*`: numbers.
    Multiply,
    /// `/`: numbers; dividing by zero leaves the cell empty.
    Divide,
}

impl Operator {
    /// The symbol it is written with.
    pub fn symbol(self) -> char {
        match self {
            Operator::Add => '+',
            Operator::Subtract => '-',
            Operator::Multiply => '*',
            Operator::Divide => '/',
        }
    }
}

/// What a formula's cells hold.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema, specta::Type,
)]
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[serde(rename_all = "snake_case")]
pub enum FormulaType {
    /// A number.
    Number,
    /// A date-time.
    Date,
}

impl Formula {
    /// Every column the formula reads, first use first, each once.
    pub fn columns(&self) -> Vec<ColumnId> {
        let mut columns = Vec::new();
        self.visit_columns(&mut |column| {
            if !columns.contains(&column) {
                columns.push(column);
            }
        });
        columns
    }

    fn visit_columns(&self, visit: &mut impl FnMut(ColumnId)) {
        match self {
            Formula::Column { column } => visit(*column),
            Formula::Number { .. } => {}
            Formula::Binary { left, right, .. } => {
                left.visit_columns(visit);
                right.visit_columns(visit);
            }
            Formula::Negate { operand } => operand.visit_columns(visit),
        }
    }
}
