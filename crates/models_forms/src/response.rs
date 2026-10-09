//! Responding: answers, what a submission came to, a respondent's own
//! response, and the counts editors and poll voters read.

use chrono::{DateTime, Utc};
use models_databases::{CellValue, OptionId, RowId};
use serde::{Deserialize, Serialize};

use crate::ids::{FormId, FormQuestionId, FormResponseId, FormSectionId};
use crate::layout::BookingTarget;

/// A whole set of answers, sent at once.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Submission {
    /// One answer per answered question; a question left out is unanswered.
    pub answers: Vec<Answer>,
}

/// One question's answer: a value for its column, typed as the column's
/// cells are.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    /// The question.
    #[schema(value_type = Uuid)]
    pub question: FormQuestionId,
    /// The value; `clear` for no answer.
    pub value: CellValue,
}

/// What a submission came to.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(
    tag = "outcome",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum SubmissionOutcome {
    /// The answers are saved as a row of the form's table.
    Submitted {
        /// The ledger entry.
        #[schema(value_type = Uuid)]
        response: FormResponseId,
        /// The row holding the answers.
        #[schema(value_type = Uuid)]
        row: RowId,
        /// The form's booking step, unlocked by this accepted response.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[schema(nullable = false)]
        #[specta(optional)]
        booking: Option<UnlockedBooking>,
    },
    /// A gate stopped the response; nothing was written to the table.
    Stopped {
        /// The gate.
        #[schema(value_type = Uuid)]
        section: FormSectionId,
        /// The gate's message.
        message: String,
    },
}

/// Whether a ledger entry is a saved response or a stop at a gate.
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
pub enum ResponseStatus {
    /// The answers were saved.
    Submitted,
    /// A gate stopped the respondent.
    Stopped,
}

/// One entry of a form's submission ledger: who answered, when, and where
/// the answers went.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FormResponse {
    /// The entry.
    #[schema(value_type = Uuid)]
    pub id: FormResponseId,
    /// The form.
    #[schema(value_type = Uuid)]
    pub form_id: FormId,
    /// Saved, or stopped at a gate.
    pub status: ResponseStatus,
    /// The gate that stopped it.
    #[schema(value_type = Option<Uuid>, required = true)]
    pub stopped_at_section: Option<FormSectionId>,
    /// The row holding the answers; `null` when stopped, or once the row was
    /// deleted from the table.
    #[schema(value_type = Option<Uuid>, required = true)]
    pub row: Option<RowId>,
    /// When it was first submitted.
    pub submitted_at: DateTime<Utc>,
    /// When it last changed.
    pub updated_at: DateTime<Utc>,
}

/// A signed-in respondent's own response, with its answers as the row
/// holds them now.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct MyResponse {
    /// The ledger entry.
    pub response: FormResponse,
    /// The row's cells for the form's current questions, the empty ones
    /// left out; none when the row is gone.
    pub answers: Vec<Answer>,
    /// The form's booking step, while the saved row still passes the form's
    /// current required questions and gates.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    #[specta(optional)]
    pub booking: Option<UnlockedBooking>,
}

/// A booking step a passing response has unlocked, with its destination.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct UnlockedBooking {
    /// The booking section.
    #[schema(value_type = Uuid)]
    pub section: FormSectionId,
    /// Its title.
    pub title: String,
    /// What respondents read before choosing a time.
    pub description: String,
    /// The native booking event to open.
    pub target: BookingTarget,
}

/// A form's response counts, for its editors.
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct ResponseSummary {
    /// Responses saved.
    pub submitted: u64,
    /// Respondents stopped at a gate.
    pub stopped: u64,
    /// The stops, by gate.
    pub stopped_by_section: Vec<SectionCount>,
    /// Rows of the form's table, whoever wrote them.
    pub rows: u64,
}

/// How many responses one gate stopped.
#[cfg_attr(feature = "schema", derive(schemars::JsonSchema))]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SectionCount {
    /// The gate.
    #[schema(value_type = Uuid)]
    pub section: FormSectionId,
    /// How many it stopped.
    pub count: u64,
}

/// How the table's rows answer each choice question.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FormTally {
    /// One tally per select, numeric select, tag or checkbox question, in
    /// layout order.
    pub questions: Vec<QuestionTally>,
}

/// One question's counts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct QuestionTally {
    /// The question.
    #[schema(value_type = Uuid)]
    pub question: FormQuestionId,
    /// Rows with a value in its column.
    pub responses: u64,
    /// A count per option in the column's order, zeros included; for a
    /// checkbox, checked then unchecked.
    pub buckets: Vec<TallyBucket>,
}

/// How many rows hold one value.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TallyBucket {
    /// The value.
    pub value: TallyValue,
    /// How many rows hold it.
    pub count: u64,
}

/// A value a tally counts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum TallyValue {
    /// One option of the column.
    Option {
        /// The option.
        #[schema(value_type = Uuid)]
        option: OptionId,
    },
    /// A checkbox state.
    Checkbox {
        /// Checked, or not.
        checked: bool,
    },
}
