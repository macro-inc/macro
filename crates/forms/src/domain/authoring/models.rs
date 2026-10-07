//! Typed authoring intents and saved outcomes, shared by tools and domain services.
use models_databases::views::{Conjunction, FilterTest, SetOperator};
use models_databases::{ColumnId, ColumnKind, OptionId};
use models_forms::{
    BookingTarget, Form, FormAccess, FormLayout, FormQuestionId, FormSectionId, FormSource,
    QuestionOption, Widget,
};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A local create key or an existing stable identity. Labels are never identities.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(untagged, deny_unknown_fields)]
pub enum Reference<Identity> {
    /// A key declared in this draft.
    Key {
        /// Exact local key.
        key: String,
    },
    /// An existing question or option id from a read.
    Id {
        /// Stable UUID.
        id: Identity,
    },
}
/// One new option. Keys are unique within its question.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OptionDraft {
    /// Local identity, independent of label.
    pub key: String,
    /// Unique display label. Numeric selects require a finite number.
    pub label: String,
}
/// Bind an existing column without changing it, or provision a new column.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum ColumnDraft {
    /// Create a typed response column.
    New {
        /// Unique storage/display name; duplicate display labels are unsupported.
        name: String,
        /// Actual database kind. Entity/relation pickers are not supported by AI authoring yet.
        #[serde(rename = "type")]
        kind: ColumnKind,
        /// Choice definitions, empty for non-choice kinds.
        #[serde(default)]
        options: Vec<OptionDraft>,
    },
    /// Ask a selected column of the form's own table.
    Existing {
        /// Column from DescribeDatabase or ReadForm.
        column_id: ColumnId,
    },
}
/// A question placement. Requiredness is presence, not qualification.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Question {
    /// Unique key across this draft.
    pub key: String,
    /// The response column.
    pub column: ColumnDraft,
    /// Respondent help text; omitted means empty.
    #[serde(default)]
    pub help_text: String,
    /// Require an answer. False and zero count as answers.
    #[serde(default)]
    pub required: bool,
    /// Null/omitted uses the column's default widget.
    #[serde(default)]
    pub widget: Option<Widget>,
}
/// A typed predicate, with local option references for newly created choices.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Predicate {
    /// Existing database predicate; options here must use real saved UUIDs.
    Value {
        /// Typed comparison. Empty cells only pass presence/isEmpty.
        test: FilterTest,
    },
    /// Select/tag comparison with keys or saved option ids.
    Options {
        /// How selected values compare.
        operator: SetOperator,
        /// Options belonging to the referenced question.
        options: Vec<Reference<OptionId>>,
    },
}
/// One screening condition or nested nonempty group.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Rule {
    /// Compare an answer from an earlier section.
    Condition {
        /// Earlier question key or stable question id.
        question: Reference<FormQuestionId>,
        /// Typed comparison.
        test: Predicate,
    },
    /// Nested conjunction.
    Group(Rules),
}
/// Screeners support AND/OR, at most eight levels and 200 conditions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Rules {
    /// AND requires all children; OR requires one.
    pub conjunction: Conjunction,
    /// Must not be empty, including nested groups.
    pub conditions: Vec<Rule>,
}
/// The supported meaning of qualification at the booking step.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum Qualification {
    /// Screening reveals the link. Its independent URL remains usable.
    Advisory,
    /// Strict server-side restriction; refused before mutation until supported.
    Required,
}
/// A section of a complete authored draft.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Section {
    /// Questions shown together.
    Questions {
        /// Unique local section key.
        key: String,
        /// Section title.
        #[serde(default)]
        title: String,
        /// Respondent description.
        #[serde(default)]
        description: String,
        /// Ordered questions.
        questions: Vec<Question>,
    },
    /// Stop respondents whose previous answers fail.
    Gate {
        /// Unique section key.
        key: String,
        /// Editor title.
        #[serde(default)]
        title: String,
        /// Editor description.
        #[serde(default)]
        description: String,
        /// Earlier-question screening rules.
        rules: Rules,
        /// Message shown on failure.
        message: String,
    },
    /// One final existing booking target, never a new scheduling engine.
    Booking {
        /// Unique section key.
        key: String,
        /// Respondent title.
        #[serde(default)]
        title: String,
        /// Respondent description.
        #[serde(default)]
        description: String,
        /// Saved identities from booking discovery.
        target: BookingTarget,
        /// Explicit link-reveal intent; required is unavailable.
        qualification: Qualification,
    },
}
/// Complete ordered draft. Extra backing columns need not be questions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Draft {
    /// Introduction, omitted means empty.
    #[serde(default)]
    pub description: String,
    /// Accepted response message, omitted means default.
    #[serde(default)]
    pub confirmation_message: String,
    /// At most 100 ordered sections and 500 questions. Booking is last.
    pub sections: Vec<Section>,
}
/// Complete creation intent. Each invocation creates a new form.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Create {
    /// Form name, also the new database name for source/new.
    pub name: String,
    /// New database or explicitly selected table requiring database Owner.
    pub source: FormSource,
    /// Complete initial schema and questionnaire.
    pub draft: Draft,
}
/// A column's authoring facts, without response cells.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    /// Stable column identity.
    pub id: ColumnId,
    /// Storage and question title.
    pub name: String,
    /// Actual storage type.
    pub kind: ColumnKind,
    /// Saved option identities and labels.
    pub options: Vec<QuestionOption>,
}
/// Resolved identities for the caller's local keys.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct KeyMap {
    /// Section key to saved id.
    pub sections: std::collections::BTreeMap<String, FormSectionId>,
    /// Question key to saved question id.
    pub questions: std::collections::BTreeMap<String, FormQuestionId>,
    /// Question key to response column id.
    pub columns: std::collections::BTreeMap<String, ColumnId>,
    /// Question key to option-key/id map.
    pub options: std::collections::BTreeMap<String, std::collections::BTreeMap<String, OptionId>>,
}
/// A bounded, actionable refusal. No content is copied into tracing fields.
#[derive(Debug, thiserror::Error)]
#[error("{code}: {path}: {message}")]
pub struct AuthoringError {
    /// Stable diagnostic code.
    pub code: Code,
    /// Input or edited field path.
    pub path: String,
    /// Explanation and corrective action.
    pub message: String,
}
impl AuthoringError {
    /// Construct a domain refusal.
    pub fn new(code: Code, path: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code,
            path: path.into(),
            message: message.into(),
        }
    }
}
/// Current authorized form state, held only for this tool invocation.
#[derive(Debug, Clone)]
pub struct Snapshot {
    /// Form metadata at read time.
    pub form: Form,
    /// Actual durable content, including an invalid draft.
    pub layout: FormLayout,
    /// Durable Loro document used to produce a granular edit. Used only during the current edit.
    pub document: Vec<u8>,
    /// Loro version vector.
    pub revision: Vec<u8>,
    /// Relevant table schema.
    pub columns: Vec<Column>,
    /// Database table version, conservatively includes row traffic.
    pub table_version: i64,
    /// Whether this durable draft is projected and valid.
    pub projected: bool,
    /// Proven access level.
    pub access: FormAccess,
    /// Owner-only direct grants used by the sharing review.
    pub grants: Vec<Grant>,
}
/// Explicit widget edit; omission leaves the widget unchanged.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum WidgetChange {
    /// Restore the type's default.
    Default,
    /// Choose a compatible widget.
    Set {
        /// Desired widget.
        widget: Widget,
    },
}
/// Targeted layout operations. Removing placements always retains response columns.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Change {
    /// Edit only supplied question fields.
    SetQuestion {
        /// Stable question identity.
        question_id: FormQuestionId,
        /// New help; omission preserves it.
        help_text: Option<String>,
        /// New requiredness; omission preserves it.
        required: Option<bool>,
        /// Explicit reset or selection; omission preserves it.
        widget: Option<WidgetChange>,
    },
    /// Edit supplied section text fields.
    SetSectionText {
        /// Stable section identity.
        section_id: FormSectionId,
        /// New title.
        title: Option<String>,
        /// New description.
        description: Option<String>,
        /// New stop message, only for a gate.
        message: Option<String>,
    },
    /// Replace one gate expression, using saved column/option ids from ReadForm.
    SetGateRules {
        /// Existing gate.
        section_id: FormSectionId,
        /// Nonempty AND/OR tree referencing earlier questions' columns.
        rules: models_databases::views::FilterGroup,
    },
    /// Replace the final booking destination after authorized Scheduling validation.
    SetBookingTarget {
        /// Existing booking section.
        section_id: FormSectionId,
        /// Saved profile/event identities.
        target: BookingTarget,
        /// Must be advisory; required is unavailable.
        qualification: Qualification,
    },
    /// Add a section with fresh UUIDs. Existing ids cannot be reused.
    AddSection {
        /// Full typed section. Questions bind saved column ids.
        section: models_forms::FormSection,
        /// Insert after this section, or first when null.
        after: Option<FormSectionId>,
    },
    /// Move a section relative to a stable anchor; booking must remain last.
    MoveSection {
        /// Section to move.
        section_id: FormSectionId,
        /// Insert after this section, or first when null.
        after: Option<FormSectionId>,
    },
    /// Remove a section and its placements, retaining all backing data.
    RemoveSection {
        /// Section to remove.
        section_id: FormSectionId,
    },
    /// Add a question bound to an existing column. Use newColumns in EditForm to provision columns first.
    AddQuestion {
        /// Questions section to receive it.
        section_id: FormSectionId,
        /// Fresh question UUID and saved column identity.
        question: models_forms::QuestionLayout,
        /// Previous question or null for first.
        after: Option<FormQuestionId>,
    },
    /// Move a question within or between sections.
    MoveQuestion {
        /// Existing question.
        question_id: FormQuestionId,
        /// Destination questions section.
        section_id: FormSectionId,
        /// Previous question or null for first.
        after: Option<FormQuestionId>,
    },
    /// Remove only the placement, preserving response column and answers.
    RemoveQuestion {
        /// Existing question.
        question_id: FormQuestionId,
    },
}
/// Explicit schema addition. Ids are client-minted UUIDs used by the new question bindings.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NewColumnDraft {
    /// Fresh column id referenced by addQuestion in this request.
    pub id: ColumnId,
    /// Unique display/storage name.
    pub name: String,
    /// Supported database kind.
    pub kind: ColumnKind,
    /// Fresh saved option ids and labels. Color is currently unsupported.
    #[serde(default)]
    pub options: Vec<QuestionOption>,
}
/// Apply targeted changes to the live collaborative form.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Edit {
    /// Target form.
    pub form_id: models_forms::FormId,
    /// At most 100 targeted operations; omitted fields survive.
    pub changes: Vec<Change>,
    /// Additive schema operations, applied through DatabasesService. No column deletion/retyping.
    #[serde(default)]
    pub new_columns: Vec<NewColumnDraft>,
    /// Optional introduction change.
    pub description: Option<String>,
    /// Optional accepted-response message change.
    pub confirmation_message: Option<String>,
}

macro_rules! authoring_id {
    ($(#[$doc:meta])* $name:ident) => {
        $(#[$doc])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, JsonSchema)]
        #[serde(transparent)]
        pub struct $name(Uuid);
        impl $name {
            /// Fresh UUIDv7 identity.
            pub fn new() -> Self { Self(Uuid::now_v7()) }
            /// Stored UUID identity.
            pub const fn from_uuid(value: Uuid) -> Self { Self(value) }
            /// UUID for persistence adapters.
            pub const fn into_uuid(self) -> Uuid { self.0 }
        }
        impl Default for $name { fn default() -> Self { Self::new() } }
        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { self.0.fmt(f) }
        }
    }
}
authoring_id!(/// Content fingerprint for sharing review, scoped to actor and form.
    AuthoringRevisionId);

/// Closed set of actionable authoring refusals.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, strum::Display)]
pub enum Code {
    /// TextTooLong: see the accompanying path and corrective message.
    TextTooLong,
    /// TooManySections: see the accompanying path and corrective message.
    TooManySections,
    /// DuplicateSectionKey: see the accompanying path and corrective message.
    DuplicateSectionKey,
    /// DuplicateQuestionKey: see the accompanying path and corrective message.
    DuplicateQuestionKey,
    /// TooManyQuestions: see the accompanying path and corrective message.
    TooManyQuestions,
    /// UnknownColumn: see the accompanying path and corrective message.
    UnknownColumn,
    /// DuplicateDisplayLabel: see the accompanying path and corrective message.
    DuplicateDisplayLabel,
    /// TooManyOptions: see the accompanying path and corrective message.
    TooManyOptions,
    /// UnexpectedOptions: see the accompanying path and corrective message.
    UnexpectedOptions,
    /// DuplicateOptionKey: see the accompanying path and corrective message.
    DuplicateOptionKey,
    /// DuplicateOptionLabel: see the accompanying path and corrective message.
    DuplicateOptionLabel,
    /// InvalidNumericOption: see the accompanying path and corrective message.
    InvalidNumericOption,
    /// ReferencePickerUnavailable: see the accompanying path and corrective message.
    ReferencePickerUnavailable,
    /// UnsupportedWidget: see the accompanying path and corrective message.
    UnsupportedWidget,
    /// RepeatedColumn: see the accompanying path and corrective message.
    RepeatedColumn,
    /// QualificationEnforcementUnavailable: see the accompanying path and corrective message.
    QualificationEnforcementUnavailable,
    /// BookingMustBeLast: see the accompanying path and corrective message.
    BookingMustBeLast,
    /// EmptyScreeningGroup: see the accompanying path and corrective message.
    EmptyScreeningGroup,
    /// ScreeningTooDeep: see the accompanying path and corrective message.
    ScreeningTooDeep,
    /// TooManyConditions: see the accompanying path and corrective message.
    TooManyConditions,
    /// GateReferencesLaterQuestion: see the accompanying path and corrective message.
    GateReferencesLaterQuestion,
    /// UnknownOption: see the accompanying path and corrective message.
    UnknownOption,
    /// InvalidGateRule: see the accompanying path and corrective message.
    InvalidGateRule,
    /// ConcurrentFieldChange: see the accompanying path and corrective message.
    ConcurrentFieldChange,
    /// InvalidEdit: see the accompanying path and corrective message.
    InvalidEdit,
    /// Forbidden: see the accompanying path and corrective message.
    Forbidden,
    /// Unavailable: see the accompanying path and corrective message.
    Unavailable,
    /// InvalidDraft: see the accompanying path and corrective message.
    InvalidDraft,
    /// InvalidAccess: see the accompanying path and corrective message.
    InvalidAccess,
    /// InvalidName: see the accompanying path and corrective message.
    InvalidName,
    /// The form or backing table no longer exists or is not accessible.
    FormNotFound,
    /// A live or trashed form already reserves the selected table.
    TableAlreadyHasForm,
    /// BookingTargetUnavailable: see the accompanying path and corrective message.
    BookingTargetUnavailable,
}

/// A direct channel recipient retained for owner review comparisons.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct Grant {
    /// Channel identity.
    pub channel_id: Uuid,
    /// Direct role.
    pub access: super::contracts::GrantAccess,
}

impl From<crate::domain::models::FormError> for AuthoringError {
    fn from(error: crate::domain::models::FormError) -> Self {
        use crate::domain::models::FormError;
        let code = match &error {
            FormError::Conflict => Code::ConcurrentFieldChange,
            FormError::NotFound | FormError::TableGone => Code::FormNotFound,
            FormError::TableAlreadyHasForm => Code::TableAlreadyHasForm,
            FormError::OwnerOnly | FormError::SignInRequired => Code::Forbidden,
            FormError::InvalidName(_) => Code::InvalidName,
            FormError::InvalidLayout(_) | FormError::WidgetMismatch { .. } => Code::InvalidDraft,
            FormError::FileUploadNeedsSignIn | FormError::InvalidSharing(_) => Code::InvalidAccess,
            _ => Code::Unavailable,
        };
        AuthoringError::new(code, "form", error.to_string())
    }
}
