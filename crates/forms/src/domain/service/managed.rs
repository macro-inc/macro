//! The two columns a form writes itself on every response, and the types
//! that make them the form's: a date stamping the submission, and one person
//! naming a signed-in respondent.

use std::collections::HashMap;

use models_databases::{ColumnId, ColumnKind, EntityKind};

use super::layout::QuestionColumn;

/// The type of the column each submission stamps.
pub(super) fn submitted_kind() -> ColumnKind {
    ColumnKind::Date
}

/// The type of the column naming each signed-in respondent.
pub(super) fn respondent_kind() -> ColumnKind {
    ColumnKind::Entity {
        target: EntityKind::User,
        multi: false,
    }
}

/// The form's managed `column`, if the table's `columns` (as
/// `question_columns` reads them) still hold it with `kind`. A
/// managed column deleted or retyped in the grid is no longer the form's to
/// write: its value would not fit, and the respondent's answers still save.
pub(super) fn writable(
    columns: &HashMap<ColumnId, QuestionColumn>,
    column: Option<ColumnId>,
    kind: ColumnKind,
) -> Option<ColumnId> {
    let column = column?;
    columns
        .get(&column)
        .is_some_and(|held| held.kind == kind)
        .then_some(column)
}
