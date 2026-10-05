//! A form as its page reads it: its facts and layout, each question joined
//! with its column's title, kind and options. Never any rows.

use models_databases::views::FilterGroup;
use models_databases::{ColumnId, ColumnKind, OptionId};
use serde::{Deserialize, Serialize};

use crate::form::{Form, FormAccess};
use crate::ids::{FormQuestionId, FormSectionId};
use crate::widget::Widget;

/// A form with its layout, as the caller may see it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FormDetail {
    /// The form's facts.
    pub form: Form,
    /// The caller's level on it.
    pub access: FormAccess,
    /// Whether its database is in the trash, so it has no table to show or
    /// write: its sections keep no questions and it takes no responses.
    pub table_gone: bool,
    /// Its sections, in order.
    pub sections: Vec<FormSectionDetail>,
}

/// One section of a form as it reads.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum FormSectionDetail {
    /// Questions asked together.
    Questions {
        /// The section.
        #[schema(value_type = Uuid)]
        id: FormSectionId,
        /// Its title.
        title: String,
        /// Its description.
        description: String,
        /// Its questions, in order.
        questions: Vec<FormQuestionDetail>,
    },
    /// A check of earlier answers. The rules are sent to every caller so a
    /// respondent's page can stop them before submitting; respondents are
    /// never shown them.
    Gate {
        /// The section.
        #[schema(value_type = Uuid)]
        id: FormSectionId,
        /// Its title.
        title: String,
        /// Its description.
        description: String,
        /// The rules.
        rules: FilterGroup,
        /// What a stopped respondent reads.
        message: String,
    },
}

impl FormSectionDetail {
    /// The section's id.
    pub fn id(&self) -> FormSectionId {
        match self {
            FormSectionDetail::Questions { id, .. } | FormSectionDetail::Gate { id, .. } => *id,
        }
    }
}

/// A question with its column's facts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FormQuestionDetail {
    /// The question.
    #[schema(value_type = Uuid)]
    pub id: FormQuestionId,
    /// The column it writes.
    #[schema(value_type = Uuid)]
    pub column: ColumnId,
    /// The column's name.
    pub title: String,
    /// The column's type.
    pub kind: ColumnKind,
    /// The column's options, in order, for a select or tag column.
    pub options: Vec<QuestionOption>,
    /// What respondents read under the title.
    pub help_text: String,
    /// Whether a response must answer it.
    pub required: bool,
    /// How it is asked: the question's widget or the kind's default; `null`
    /// for a kind asked one way only.
    #[schema(required = true)]
    pub widget: Option<Widget>,
}

/// One option of a question's column.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct QuestionOption {
    /// The option.
    #[schema(value_type = Uuid)]
    pub id: OptionId,
    /// Its label.
    pub label: String,
    /// Its colour, a hex string, if it has one.
    #[schema(required = true)]
    pub color: Option<String>,
}
