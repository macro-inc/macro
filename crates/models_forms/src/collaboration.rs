//! The editor's view of a collaborative draft's publication status.

use serde::{Deserialize, Serialize};

use crate::FormDetail;

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
    pub publication_error: Option<String>,
}
