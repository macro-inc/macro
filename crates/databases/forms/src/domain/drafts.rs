//! The durable collaborative layout and its validated relational projection.
//! Loro owns draft content; the repository stores the latest valid revision
//! respondents can use. Refreshing from the durable draft never requires an
//! editor's browser to remain open.

use chrono::{DateTime, Utc};

use super::models::{Audience, FormId, FormLayout, LayoutReplacement};

/// Whether a form has begun collaborating, and the last projected revision.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct LayoutDraftState {
    /// Once enabled, all layout writes go through the collaborative document.
    pub enabled: bool,
    /// The version vector whose validated layout is stored in the repository.
    pub revision: Option<Vec<u8>>,
}

/// The result of atomically projecting a validated draft.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LayoutProjection {
    /// The ordinary layout and audience checks determined the result.
    Written(LayoutReplacement),
    /// Another projection committed since the caller read its revision.
    RevisionChanged,
}

/// The draft and projection metadata, owned by the forms repository.
pub trait FormDraftRepository: Send + Sync + 'static {
    /// Persistence failure.
    type Error: std::error::Error + Send + Sync + 'static;

    /// The draft state of a live form; absent for deleted or trashed forms.
    fn draft_state(
        &self,
        id: FormId,
    ) -> impl Future<Output = Result<Option<LayoutDraftState>, Self::Error>> + Send;

    /// Mark an initialized draft as authoritative. Idempotent; false if gone.
    fn enable_draft(&self, id: FormId) -> impl Future<Output = Result<bool, Self::Error>> + Send;

    /// One section or question id already owned by another form, if any.
    /// SDK replacements check this before changing the durable document;
    /// projection repeats the check under its transaction to cover races.
    fn conflicting_layout_id(
        &self,
        id: FormId,
        layout: &FormLayout,
    ) -> impl Future<Output = Result<Option<uuid::Uuid>, Self::Error>> + Send;

    /// Replace layout and revision together, only if the prior revision and
    /// required audience still match. A failed check leaves both unchanged.
    fn project_layout(
        &self,
        id: FormId,
        layout: &FormLayout,
        expected_revision: Option<&[u8]>,
        revision: &[u8],
        updated_at: DateTime<Utc>,
        required_audience: Option<Audience>,
    ) -> impl Future<Output = Result<LayoutProjection, Self::Error>> + Send;
}

/// Failure to read or change a durable collaborative document.
#[derive(Debug, thiserror::Error)]
pub enum FormDraftError {
    /// Another editor changed the document before this replacement committed.
    #[error("the form changed; read it again before replacing its layout")]
    Conflict,
    /// The draft service is unavailable or returned invalid state.
    #[error("the collaborative form could not be read or saved: {0:?}")]
    Unavailable(rootcause::Report),
}

/// The existing collaboration service, expressed in forms' own terms.
pub trait FormDraftStore: Send + Sync + 'static {
    /// Initialize once. An existing document must never be reseeded.
    fn ensure(
        &self,
        id: FormId,
        snapshot: Vec<u8>,
    ) -> impl Future<Output = Result<(), FormDraftError>> + Send;

    /// Read the latest durable snapshot, including changes from closed tabs.
    fn snapshot(&self, id: FormId) -> impl Future<Output = Result<Vec<u8>, FormDraftError>> + Send;

    /// Apply a granular Loro update only at its expected version.
    fn update(
        &self,
        id: FormId,
        expected_revision: Vec<u8>,
        update: Vec<u8>,
    ) -> impl Future<Output = Result<(), FormDraftError>> + Send;

    /// Retire the owned surface when its form is permanently deleted.
    fn retire(&self, id: FormId) -> impl Future<Output = Result<(), FormDraftError>> + Send;
}
