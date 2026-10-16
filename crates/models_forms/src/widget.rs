//! How a question asks for its column's kind of value. Presentation only:
//! the column's kind decides what the cell holds.

#[cfg(test)]
mod test;

use models_databases::ColumnKind;
use serde::{Deserialize, Serialize};

/// How a question is asked. Each column kind takes a few, the first its
/// default; kinds asked one way only (numbers, checkboxes, entity and row
/// pickers) take none.
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    utoipa::ToSchema,
    specta::Type,
    strum::EnumString,
    strum::IntoStaticStr,
)]
#[serde(rename_all = "camelCase")]
#[strum(serialize_all = "snake_case")]
pub enum Widget {
    /// A one-line text input.
    Short,
    /// A multi-line text area.
    Paragraph,
    /// A date and time picker.
    Datetime,
    /// A date picker.
    Date,
    /// A URL field.
    Url,
    /// A file upload storing the static file's permalink. Needs a signed-in
    /// respondent.
    File,
    /// A radio list of options.
    Choice,
    /// A dropdown of options.
    Dropdown,
    /// A checkbox list of options.
    Checkboxes,
}

impl Widget {
    /// The widgets a column of `kind` may be asked with, its default first;
    /// empty for a kind asked one way only.
    pub fn choices(kind: ColumnKind) -> &'static [Widget] {
        match kind {
            ColumnKind::Text => &[Widget::Short, Widget::Paragraph],
            ColumnKind::Date => &[Widget::Datetime, Widget::Date],
            ColumnKind::Link => &[Widget::Url, Widget::File],
            ColumnKind::Select { multi: false } => &[Widget::Choice, Widget::Dropdown],
            ColumnKind::Select { multi: true } | ColumnKind::Tag => &[Widget::Checkboxes],
            ColumnKind::SelectNumber { .. } => &[Widget::Dropdown],
            ColumnKind::Number
            | ColumnKind::Boolean
            | ColumnKind::Entity { .. }
            | ColumnKind::Relation { .. } => &[],
        }
    }

    /// The widget a column of `kind` is asked with when the question names
    /// none.
    pub fn default_for(kind: ColumnKind) -> Option<Widget> {
        Self::choices(kind).first().copied()
    }

    /// Whether a column of `kind` may be asked with this widget.
    pub fn fits(self, kind: ColumnKind) -> bool {
        Self::choices(kind).contains(&self)
    }

    /// The widget's stored spelling.
    pub fn name(self) -> &'static str {
        self.into()
    }
}
