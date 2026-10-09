//! Public workflow results and read/access commands. These are the AI tool contract.
use super::models::*;
use chrono::{DateTime, Utc};
use models_databases::DatabaseId;
use models_forms::{
    Audience, Form, FormAccess, FormDetail, FormId, FormLayout, FormStatus, ResponseSummary,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Read actual editor content or the respondent-safe projection.
#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum ReadView {
    /// Requires Edit and returns the live collaborative layout.
    #[default]
    Authoring,
    /// Requires View; omits booking destinations, draft state and response data.
    Respondent,
}
/// Read one known form. This does not add a public form to discovery.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Read {
    /// Saved form identity.
    pub form_id: FormId,
    /// Defaults to authoring. Respondent reads omit the durable editor document.
    #[serde(default)]
    pub view: ReadView,
    /// Editor-only response counts; never raw response rows.
    #[serde(default)]
    pub include_summary: bool,
}
/// Bounded discovery across explicit grants, never every public form.
#[derive(Debug, Clone, Default, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct List {
    /// Case-insensitive name substring; omit to list recent forms.
    pub query: Option<String>,
    /// Filter by current open/closed setting.
    pub status: Option<FormStatus>,
    /// Minimum effective permission.
    pub access: Option<FormAccess>,
    /// Restrict to a known backing database.
    pub database_id: Option<DatabaseId>,
}
/// Form channel grants support View and Edit; Edit also grants backing-database Edit.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum GrantAccess {
    /// May respond; no database read grant.
    View,
    /// May edit the form and its entire backing database.
    Edit,
}
/// An explicit channel grant delta; omitted channels stay unchanged.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum GrantChange {
    /// Add or replace one channel grant.
    Upsert {
        /// Saved channel identity from discovery.
        channel_id: Uuid,
        /// Requested access.
        access: GrantAccess,
    },
    /// Remove this channel's direct grant.
    Remove {
        /// Saved channel identity.
        channel_id: Uuid,
    },
}
/// Complete access settings. Empty grant deltas are a no-op.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccessDraft {
    /// Public permits anonymous respondents; members requires a signed-in grant.
    pub audience: Audience,
    /// Open accepts responses only while the deadline and projection permit it.
    pub status: FormStatus,
    /// Absolute UTC deadline, or null to clear it.
    pub closes_at: Option<DateTime<Utc>>,
    /// Whether respondents can see aggregate choice tallies.
    pub tally_visible: bool,
    /// Direct channel changes only; this does not post messages or send invitations.
    #[serde(default)]
    pub channel_grants: Vec<GrantChange>,
}
/// Owner-only settings and sharing changes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SetAccess {
    /// Saved form to open, close or share.
    pub form_id: FormId,
    /// Complete desired settings and explicit channel deltas.
    pub draft: AccessDraft,
}
/// Actionable diagnostic without a success-shaped placeholder.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    /// Stable domain error classification.
    pub code: Code,
    /// Input/field path.
    pub path: String,
    /// Corrective action or recovery instruction.
    pub message: String,
}
impl From<AuthoringError> for Diagnostic {
    fn from(value: AuthoringError) -> Self {
        Self {
            code: value.code,
            path: value.path,
            message: value.message,
        }
    }
}
/// Explicit capability boundaries for the current authoring implementation.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    /// Separate presentation labels are not currently supported.
    pub presentation_labels: bool,
    /// Question removal keeps columns and response data.
    pub conditional_column_cleanup: bool,
    /// Retyping through AI is unavailable until its recovery guarantees exist.
    pub safe_linked_type_changes: bool,
    /// False: screeners reveal links, but independent booking URLs remain usable.
    pub required_booking_qualification: bool,
}
/// An authorized snapshot of the actual durable draft and current schema.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SavedForm {
    /// Form metadata, including source and actual audience/status.
    pub form: Form,
    /// Actual durable layout and stable question/section identities.
    pub layout: FormLayout,
    /// Backing columns and saved option identities, without any response cells.
    pub columns: Vec<Column>,
    /// Whether this exact draft is the valid respondent projection.
    pub projected: bool,
    /// Canonical editor URL.
    pub editor_url: String,
    /// Canonical respondent URL, also returned while closed.
    pub respondent_url: String,
    /// Actual response availability, not merely existence of a URL.
    pub accepting_responses: bool,
    /// Explicit unsupported authoring capabilities.
    pub capabilities: Capabilities,
}
/// Outcome describes actual completion, including uncertain interrupted work.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum MutationState {
    /// All requested phases completed.
    Completed,
    /// Durable content saved; read the form to retry projection.
    SavedPendingProjection,
    /// Some phases may have committed; inspect the existing form, never recreate blindly.
    PartiallyApplied,
}
/// Every mutation reports its result; no execution history is retained.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MutationResult {
    /// Completion versus partial work.
    pub state: MutationState,
    /// Target form identity, usable to inspect partial work.
    pub form_id: FormId,
    /// Actual authorized state when readable; absent is never a completion claim.
    pub saved: Option<SavedForm>,
    /// Create-local keys resolved to persistent identities.
    pub keys: KeyMap,
    /// Actionable refusals, partial-outcome recovery, or capability notices.
    pub diagnostics: Vec<Diagnostic>,
}
/// Read output preserves the boundary between editors and respondents.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "view",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ReadResult {
    /// Editor-only durable authoring state.
    Authoring {
        /// Actual saved state.
        saved: Box<SavedForm>,
        /// Optional ledger/table counts with labeled populations.
        summary: Option<ResponseSummary>,
    },
    /// Respondent-safe projection. No durable draft or hidden booking destinations.
    Respondent {
        /// Public/member page content under the caller's View grant.
        detail: Box<FormDetail>,
        /// Canonical URL.
        respondent_url: String,
        /// Actual response availability.
        accepting_responses: bool,
    },
}
/// One discoverable form, without response cells or hidden booking destinations.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListItem {
    /// Form metadata.
    pub form: Form,
    /// Effective grant.
    pub access: FormAccess,
    /// Canonical editor URL.
    pub editor_url: String,
    /// Canonical respondent URL.
    pub respondent_url: String,
}
/// At most 50 matches, with a count and explicit truncation guidance.
#[derive(Debug, Clone, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListResult {
    /// Most recent matching forms.
    pub forms: Vec<ListItem>,
    /// Total matches before the limit.
    pub total: usize,
    /// Narrow query/status/access/databaseId when true.
    pub truncated: bool,
}
