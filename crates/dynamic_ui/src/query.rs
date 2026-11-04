//! The filter a list widget fetches its items by: the web's Next Soup `Query`,
//! which the renderer compiles into a Soup AST. The web checks at compile time
//! that this type stays assignable to that one.

use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use specta::Type;

/// A Soup filter query: the items to include and exclude.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct Query {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = FieldFilters)]
    pub include: Option<FieldFilters>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = FieldFilters)]
    pub exclude: Option<FieldFilters>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = DocumentWhere)]
    pub document_where: Option<DocumentWhere>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = EmailView)]
    pub email_view: Option<EmailView>,
}

/// Several document filter expressions that all apply, or one. Several comes
/// first: serde reads a struct from an array too, so a clause would take one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(untagged)]
pub enum DocumentWhere {
    All(Vec<DocumentFilterExpression>),
    One(Box<DocumentFilterExpression>),
}

/// A document filter: a clause, or clauses combined with `op`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(untagged)]
pub enum DocumentFilterExpression {
    Combined(DocumentFilterCombination),
    Clause(Box<DocumentFilterClause>),
}

/// Document filter expressions combined.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum DocumentFilterCombination {
    And {
        clauses: Vec<DocumentFilterExpression>,
    },
    Or {
        clauses: Vec<DocumentFilterExpression>,
    },
    Not {
        // Gemini rejects a schema whose `$ref` loop runs only through required
        // fields, so the model's schema negates a single clause. Decoding still
        // takes any expression, as the web's query does.
        #[schemars(with = "DocumentFilterClause")]
        clause: Box<DocumentFilterExpression>,
    },
}

/// Documents to include and exclude.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema, Type)]
pub struct DocumentFilterClause {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = DocumentFieldFilters)]
    pub include: Option<DocumentFieldFilters>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = DocumentFieldFilters)]
    pub exclude: Option<DocumentFieldFilters>,
}

/// The filters that apply to documents.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct DocumentFieldFilters {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub document_id: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub file_type: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub file_assoc: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub sub_type: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub project_id: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub document_owner_id: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub document_seen: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub document_done: Option<bool>,
    /// For tasks, whether the current user is an assignee.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub document_importance: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub is_email_attachment: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = DateRangeFilter)]
    pub document_created_at: Option<DateRangeFilter>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = DateRangeFilter)]
    pub document_updated_at: Option<DateRangeFilter>,
}

/// Every filter, each over one field of one kind of item. Id lists match any
/// of their ids.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct FieldFilters {
    #[serde(flatten)]
    pub document: DocumentFieldFilters,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub calendar_event_id: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub thread_id: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub email_link_id: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub email_project_id: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub email_sender: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub channel_id: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub channel_type: Option<Vec<String>>,
    /// Membership states to match: `[true]` for channels the user is in,
    /// `[true, false]` to also match team channels they have not joined.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<bool>)]
    pub channel_is_participant: Option<Vec<bool>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub channel_sender_id: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub channel_message_thread_id: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub channel_thread_id: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub channel_thread_root_sender_id: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub channel_thread_participant_id: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub agent_session_id: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub agent_session_owner_id: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub chat_id: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub chat_owner_id: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub chat_project_id: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub folder_id: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub folder_owner_id: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub call_id: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub call_channel_id: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub call_speaker_id: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub foreign_entity_record_id: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub foreign_entity_source: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<String>)]
    pub crm_company_id: Option<Vec<String>>,
    /// Property values to match; distinct properties all apply.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<PropertyFilter>)]
    pub properties: Option<Vec<PropertyFilter>>,
    /// Selected tags, combined by `tagFilterMode`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = Vec<PropertyFilter>)]
    pub tag_filters: Option<Vec<PropertyFilter>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = TagFilterMode)]
    pub tag_filter_mode: Option<TagFilterMode>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub email_seen: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub email_done: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub email_importance: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = EmailShared)]
    pub email_shared: Option<EmailShared>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub email_calendar_only: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub channel_seen: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub channel_done: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub channel_importance: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub channel_thread_seen: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub channel_thread_done: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub chat_seen: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub chat_done: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub folder_seen: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub folder_done: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub initiative_seen: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub initiative_done: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub foreign_entity_seen: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub foreign_entity_done: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub foreign_entity_includes_me: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = CallStatus)]
    pub call_status: Option<CallStatus>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub call_attended: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub crm_company_hidden: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub crm_contact_hidden: Option<bool>,
    /// Literal text matched against a CRM contact's name or email.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub crm_contact_search: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub calendar_event_seen: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub calendar_event_done: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = bool)]
    pub include_agent_sessions: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = DateRangeFilter)]
    pub chat_created_at: Option<DateRangeFilter>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = DateRangeFilter)]
    pub chat_updated_at: Option<DateRangeFilter>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = DateRangeFilter)]
    pub folder_created_at: Option<DateRangeFilter>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = DateRangeFilter)]
    pub folder_updated_at: Option<DateRangeFilter>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = DateRangeFilter)]
    pub email_updated_at: Option<DateRangeFilter>,
}

/// Bounds on a timestamp, as ISO 8601 strings.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, JsonSchema, Type)]
pub struct DateRangeFilter {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub gt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub gte: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub lt: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[specta(optional, type = String)]
    pub lte: Option<String>,
}

/// One value of one property.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "camelCase")]
pub struct PropertyFilter {
    pub property_id: String,
    #[serde(rename = "type")]
    pub property_type: PropertyFilterType,
    pub value: String,
}

/// What a property filter's value is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "snake_case")]
pub enum PropertyFilterType {
    Select,
    Entity,
}

/// How selected tags combine: items with any of them, or with all of them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "snake_case")]
pub enum TagFilterMode {
    Any,
    All,
}

/// Which shared emails to match.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "snake_case")]
pub enum EmailShared {
    Exclude,
    Include,
    Only,
}

/// Whether a call was attended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum CallStatus {
    Attended,
    Missed,
    Unattended,
}

/// Which mailbox a query reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema, Type)]
#[serde(rename_all = "snake_case")]
pub enum EmailView {
    Inbox,
    Drafts,
    Sent,
    All,
}
