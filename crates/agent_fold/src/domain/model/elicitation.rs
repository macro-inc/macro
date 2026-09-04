//! The elicitation vocabulary: what an agent asked the user, and how it
//! resolved.
//!
//! ACP's `elicitation/create` is mirrored here rather than carried raw so the
//! browser gets a typed union to render forms from. The mirror is lossy where
//! it should be - unknown modes and unknown property types keep their raw
//! payload and nothing else - and harness idioms (a select paired with a
//! free-text "Other" companion, see
//! [`HarnessReader::custom_answer_for`](crate::domain::harness::HarnessReader::custom_answer_for))
//! are collapsed before they reach these types, so a renderer sees one field
//! per question.

pub use agent_runtime_protocol::domain::action::ElicitationRequestId;
use serde::Serialize;
use specta::Type;

/// What the agent asked for.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ElicitationRequest {
    /// Structured data through a form the client renders.
    Form {
        /// The restricted schema describing the form.
        schema: ElicitationSchema,
    },
    /// An out-of-band interaction the user consents to open.
    Url {
        /// The agent's handle for this interaction; `elicitation/complete`
        /// names it.
        #[serde(rename = "elicitationId")]
        elicitation_id: String,
        /// Where the user is sent.
        url: String,
    },
    /// A Macro user tool (`SendEmail`, `CreateCalendarEvent`) paused for the
    /// user's review: the agent drafted the call and asks before it runs.
    ///
    /// Recognized from the call the form is scoped to - a tool this fold
    /// already knows as a user tool - or from `_meta.macro.userTool`, which
    /// Macro's own agent stamps. The draft is the call's arguments whole,
    /// so a client with the tool's own composer renders that and answers
    /// with the whole edited draft; `schema` is the flat form the agent also
    /// sent, for a client without one.
    UserTool {
        /// The tool, by Macro's name.
        tool: String,
        /// The call's arguments - the tool's own JSON.
        #[specta(type = specta_typescript::Unknown)]
        draft: Box<serde_json::Value>,
        /// The restricted form describing the draft's flat fields.
        schema: Box<ElicitationSchema>,
    },
    /// A mode this fold does not know. Kept raw so nothing is lost; a
    /// renderer must not treat it as form or url.
    Unrecognized {
        /// The wire mode.
        mode: String,
        /// The request params, verbatim.
        #[specta(type = specta_typescript::Unknown)]
        raw: serde_json::Value,
    },
}

/// ACP's restricted form schema: a flat object of primitive properties.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ElicitationSchema {
    /// Schema-level title, when the agent gave one.
    pub title: Option<String>,
    /// Schema-level description, when the agent gave one.
    pub description: Option<String>,
    /// The fields, in the order the agent declared them.
    pub properties: Vec<ElicitationProperty>,
    /// Property names the agent requires an answer for.
    pub required: Vec<String>,
}

/// One form field.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ElicitationProperty {
    /// The key the answer is sent back under.
    pub name: String,
    /// Label to show, when the agent gave one.
    pub title: Option<String>,
    /// Help text, when the agent gave one.
    pub description: Option<String>,
    /// The field's type and constraints.
    pub schema: ElicitationPropertySchema,
}

/// A field's type and constraints, mirroring ACP's restricted property
/// schemas.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ElicitationPropertySchema {
    /// Free text, or a single choice when `options` is non-empty.
    String {
        /// Minimum length, when constrained.
        #[serde(rename = "minLength")]
        min_length: Option<u32>,
        /// Maximum length, when constrained.
        #[serde(rename = "maxLength")]
        max_length: Option<u32>,
        /// A regular expression the value must match. Agent-supplied, so a
        /// renderer must bound its evaluation.
        pattern: Option<String>,
        /// ACP's format hint as its wire string (`email`, `uri`, `date`,
        /// `date-time`, or something this fold does not know).
        format: Option<String>,
        /// Pre-filled value.
        default: Option<String>,
        /// The choices, when this is a single select. Empty for free text.
        options: Vec<ElicitationOption>,
        /// The key a free-text answer is sent under when one is accepted
        /// alongside `options` - the user picks a choice *or* types their
        /// own. A harness idiom (Claude Code's and Codex's "Other" field),
        /// never ACP's own; `None` for a plain select.
        #[serde(rename = "customField")]
        custom_field: Option<String>,
    },
    /// A floating-point number.
    Number {
        /// Lower bound, when constrained.
        minimum: Option<f64>,
        /// Upper bound, when constrained.
        maximum: Option<f64>,
        /// Pre-filled value.
        default: Option<f64>,
    },
    /// A whole number.
    Integer {
        /// Lower bound, when constrained.
        #[specta(type = Option<f64>)]
        minimum: Option<i64>,
        /// Upper bound, when constrained.
        #[specta(type = Option<f64>)]
        maximum: Option<i64>,
        /// Pre-filled value.
        #[specta(type = Option<f64>)]
        default: Option<i64>,
    },
    /// A yes/no.
    Boolean {
        /// Pre-filled value.
        default: Option<bool>,
    },
    /// Several choices from a list.
    MultiSelect {
        /// Fewest selections allowed, when constrained.
        #[serde(rename = "minItems")]
        #[specta(type = Option<f64>)]
        min_items: Option<u64>,
        /// Most selections allowed, when constrained.
        #[serde(rename = "maxItems")]
        #[specta(type = Option<f64>)]
        max_items: Option<u64>,
        /// The choices.
        options: Vec<ElicitationOption>,
        /// Pre-selected values.
        default: Vec<String>,
        /// The key a free-text answer is sent under when one is accepted
        /// instead of the choices. Harness idiom, `None` for a plain
        /// multi-select. See the `String` variant.
        #[serde(rename = "customField")]
        custom_field: Option<String>,
    },
    /// A property type this fold does not know. A renderer shows that it
    /// cannot display the field; decline and cancel still work.
    Unrecognized {
        /// The wire `type`.
        #[serde(rename = "typeName")]
        type_name: String,
        /// The property schema, verbatim.
        #[specta(type = specta_typescript::Unknown)]
        raw: serde_json::Value,
    },
}

/// One choice in a select.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ElicitationOption {
    /// The value sent back when chosen.
    pub value: String,
    /// Label to show; absent for an untitled `enum`, where the value is the
    /// label.
    pub title: Option<String>,
    /// Help text, when the agent gave one.
    pub description: Option<String>,
}

/// How an elicitation has resolved so far.
///
/// [`Self::Pending`] is a legitimate final state on a dead session, like an
/// unanswered permission.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ElicitationOutcome {
    /// No response has gone out yet.
    Pending,
    /// The user submitted the form, or consented to open the URL.
    Accepted {
        /// The submitted values, absent for a URL consent.
        #[specta(type = specta_typescript::Unknown)]
        content: Option<serde_json::Value>,
    },
    /// The user explicitly said no.
    Declined,
    /// The user dismissed it, or a stop cancelled it.
    Cancelled,
    /// URL only: the agent reported the external interaction finished.
    Completed,
    /// The response was a JSON-RPC error - including this client's own
    /// refusal of a request it could not hold.
    Errored {
        /// The error's message, verbatim.
        message: String,
    },
    /// A result arrived that this fold could not read as an ACP action.
    Unrecognized,
}

/// The one elicitation the user can answer right now, surfaced on
/// [`SessionMetadata`](super::SessionMetadata) so a reader need not scan the
/// transcript for it.
#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PendingElicitation {
    /// The agent's request id; what an answer must name.
    pub request_id: ElicitationRequestId,
    /// The turn whose agent message holds the matching part.
    pub turn: u32,
    /// The tool call it was asked on behalf of, when any.
    pub tool_call: Option<super::ToolUseId>,
    /// What the agent is asking, in prose.
    pub message: String,
    /// The form or URL.
    pub request: ElicitationRequest,
}
