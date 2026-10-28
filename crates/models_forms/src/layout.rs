//! A form's layout: which of its table's columns it asks, in what sections
//! and order, how, and where it stops a respondent. Replaced as one document.

use models_databases::ColumnId;
use models_databases::views::FilterGroup;
use serde::{Deserialize, Serialize};

use crate::ids::{BookingEventTypeId, BookingProfileId, FormQuestionId, FormSectionId};
use crate::widget::Widget;

/// Every section of a form, in order.
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FormLayout {
    /// The sections, first first.
    pub sections: Vec<FormSection>,
}

/// An existing native Macro scheduling event offered after an accepted response.
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct BookingTarget {
    /// The scheduling profile that owns the event.
    #[schema(value_type = Uuid)]
    pub profile_id: BookingProfileId,
    /// The event type to book.
    #[schema(value_type = Uuid)]
    pub event_type_id: BookingEventTypeId,
}

/// One section of a layout: questions on one screen, or a gate the answers
/// so far must pass.
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(
    Debug,
    Clone,
    PartialEq,
    Serialize,
    Deserialize,
    utoipa::ToSchema,
    specta::Type,
    strum::EnumDiscriminants,
)]
#[strum_discriminants(name(FormSectionKind))]
#[strum_discriminants(derive(strum::AsRefStr, strum::EnumString))]
#[strum_discriminants(strum(serialize_all = "camelCase"))]
#[strum_discriminants(doc = "The kind of a form section, including its stable storage name.")]
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
    /// The final step, revealed only after the server accepts the response.
    Booking {
        /// The section, under an id the client mints.
        #[schema(value_type = Uuid)]
        id: FormSectionId,
        /// Its title.
        title: String,
        /// What respondents read before choosing a time.
        description: String,
        /// The native booking event. Respondent layouts never include this target.
        target: BookingTarget,
    },
}

impl FormSection {
    /// The section's id.
    pub fn id(&self) -> FormSectionId {
        match self {
            FormSection::Questions { id, .. }
            | FormSection::Gate { id, .. }
            | FormSection::Booking { id, .. } => *id,
        }
    }
}

/// How one column of the table is asked.
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
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
