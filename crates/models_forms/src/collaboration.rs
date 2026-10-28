//! The editor's view of a collaborative draft's publication status.

use serde::{Deserialize, Serialize};

use crate::{FormDetail, FormQuestionId, LayoutProblem};

/// A ready collaborative form and the result of publishing its latest draft.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct FormCollaboration {
    /// The latest validated form. The form id also identifies its surface.
    pub detail: FormDetail,
    /// Why the current draft cannot yet replace the respondent layout.
    /// Only editors can request this result.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[schema(nullable = false)]
    #[specta(optional)]
    pub publication_error: Option<FormPublicationProblem>,
}

/// An editor's saved draft is not yet the version respondents can use.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, utoipa::ToSchema, specta::Type)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum FormPublicationProblem {
    /// The draft contains unsupported or malformed layout records. An explicit
    /// layout replacement can repair it without replacing its document history.
    InvalidDraft,
    /// The layout violates a form invariant.
    Layout {
        /// The invariant the editor needs to repair.
        problem: LayoutProblem,
    },
    /// A question's widget no longer fits its column.
    WidgetMismatch {
        /// The question to repair.
        #[schema(value_type = uuid::Uuid)]
        question: FormQuestionId,
    },
    /// File questions require a signed-in audience.
    FileUploadNeedsSignIn,
    /// The draft was saved, but publication could not finish. Reading the
    /// collaboration endpoint retries publication; do not repeat the write.
    Pending,
}
