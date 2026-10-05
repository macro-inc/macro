//! A form's layout: which of its table's columns it asks, in what sections
//! and order, how, and where it stops a respondent. Replaced as one document.

use models_databases::ColumnId;
use models_databases::views::FilterGroup;
use serde::{Deserialize, Serialize};

use crate::ids::{FormQuestionId, FormSectionId};
use crate::widget::Widget;

/// Every section of a form, in order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FormLayout {
    /// The sections, first first.
    pub sections: Vec<FormSection>,
}

/// One section of a layout: questions on one screen, or a gate the answers
/// so far must pass.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum FormSection {
    /// Questions asked together.
    Questions {
        /// The section, under an id the client mints.
        #[schema(value_type = Uuid)]
        id: FormSectionId,
        /// Its title; may be empty.
        title: String,
        /// What respondents read under the title.
        description: String,
        /// Its questions, in order.
        questions: Vec<QuestionLayout>,
    },
    /// A check of earlier answers: a respondent whose answers fail the rules
    /// is stopped here with the message, and nothing is written.
    Gate {
        /// The section, under an id the client mints.
        #[schema(value_type = Uuid)]
        id: FormSectionId,
        /// Its title, for editors.
        title: String,
        /// Its description, for editors.
        description: String,
        /// The rules, naming only columns asked in earlier sections.
        rules: FilterGroup,
        /// What a stopped respondent reads.
        message: String,
    },
}

impl FormSection {
    /// The section's id.
    pub fn id(&self) -> FormSectionId {
        match self {
            FormSection::Questions { id, .. } | FormSection::Gate { id, .. } => *id,
        }
    }
}

/// How one column of the table is asked.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct QuestionLayout {
    /// The question, under an id the client mints; answers name it.
    #[schema(value_type = Uuid)]
    pub id: FormQuestionId,
    /// The column it writes; its title, type and options are the column's.
    #[schema(value_type = Uuid)]
    pub column: ColumnId,
    /// What respondents read under the title.
    pub help_text: String,
    /// Whether a response must answer it.
    pub required: bool,
    /// How it is asked; `null` for the column kind's default.
    #[schema(required = true)]
    pub widget: Option<Widget>,
}
