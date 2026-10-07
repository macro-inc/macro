//! What a refused or failed forms request answers: a code the client
//! branches on, a message people read, and the question or layout problem
//! it is about.

use models_databases::ColumnId;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::ids::FormQuestionId;

/// Why a forms request was refused or failed.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FormErrorResponse {
    /// What went wrong.
    pub code: FormErrorCode,
    /// What went wrong, in words.
    pub message: String,
    /// The question it is about, if one.
    #[schema(value_type = Option<Uuid>, required = true)]
    pub question: Option<FormQuestionId>,
    /// What is wrong with a refused layout.
    #[schema(required = true)]
    pub problem: Option<LayoutProblem>,
}

/// What went wrong with a forms request.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema, specta::Type,
)]
#[serde(rename_all = "camelCase")]
pub enum FormErrorCode {
    /// The table already belongs to a form, including one in trash.
    TableAlreadyHasForm,
    /// The form, or something it names, does not exist or is not the
    /// caller's to see.
    NotFound,
    /// The caller lacks the level the request needs.
    Forbidden,
    /// Only the form's owner may change this.
    OwnerOnly,
    /// The form takes responses from signed-in members only.
    SignInRequired,
    /// The form is closed, or past its closing time.
    Closed,
    /// The form's database is in the trash.
    TableGone,
    /// The caller already responded; they edit their response instead.
    AlreadyResponded,
    /// The caller has no saved response to read or edit.
    NoResponse,
    /// An answer names a question the form does not ask.
    UnknownQuestion,
    /// A question is answered twice.
    RepeatedAnswer,
    /// A required question reached before any stop is unanswered.
    MissingAnswer,
    /// An answer does not fit its question's column.
    InvalidAnswer,
    /// A question's widget does not fit its column's type.
    WidgetMismatch,
    /// File upload needs a signed-in respondent, so a public form cannot
    /// ask for one.
    FileUploadNeedsSignIn,
    /// A layout was refused; `problem` says why.
    InvalidLayout,
    /// A name is empty or too long.
    InvalidName,
    /// A sharing change was refused.
    InvalidSharing,
    /// The form's owner keeps its tallies from respondents.
    TallyHidden,
    /// The table changed under the request; try again.
    Conflict,
    /// Something failed on the server.
    Internal,
}

/// Why a layout does not fit the form's table.
#[derive(
    Debug,
    Clone,
    PartialEq,
    Serialize,
    Deserialize,
    utoipa::ToSchema,
    specta::Type,
    thiserror::Error,
)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum LayoutProblem {
    /// A booking step must be unique and follow all questions and screeners.
    #[error("the booking step must be the final section of the form")]
    BookingMustBeLast,
    /// A question names a column the form's table does not have.
    #[error("the table has no column {column}")]
    UnknownColumn {
        /// The column.
        #[schema(value_type = Uuid)]
        column: ColumnId,
    },
    /// A question names a column the form writes itself.
    #[error("column {column} is written by the form itself and cannot be a question")]
    ManagedColumn {
        /// The column.
        #[schema(value_type = Uuid)]
        column: ColumnId,
    },
    /// Two questions name one column.
    #[error("column {column} is asked twice")]
    RepeatedColumn {
        /// The column.
        #[schema(value_type = Uuid)]
        column: ColumnId,
    },
    /// Two sections or questions share an id.
    #[error("the id {id} is used twice")]
    RepeatedId {
        /// The id.
        id: Uuid,
    },
    /// A gate tests a column no earlier section asks.
    #[error("a gate can only test questions of earlier sections; column {column} is not one")]
    GateNamesLaterColumn {
        /// The column.
        #[schema(value_type = Uuid)]
        column: ColumnId,
    },
    /// A gate's rule does not fit its column.
    #[error("a gate rule does not fit its column: {reason}")]
    GateRule {
        /// Why.
        reason: String,
    },
    /// A text is longer than allowed.
    #[error("a text is longer than {max} characters")]
    TextTooLong {
        /// The longest allowed.
        max: usize,
    },
}
