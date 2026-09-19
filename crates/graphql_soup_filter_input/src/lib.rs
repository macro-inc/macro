//! Browser-compatible GraphQL Soup filter input materialization.
//!
//! This crate owns the GraphQL variables shape and conversion into the
//! authoritative `item_filters` AST without depending on Axum or a GraphQL
//! server adapter crate.
#![deny(missing_docs)]

use std::{str::FromStr, sync::Arc};

#[cfg(feature = "server")]
use async_graphql::ID;
#[cfg(feature = "server")]
use graphql_common::GraphqlPropertyEntityType;
#[cfg(not(feature = "server"))]
type ID = String;
use chrono::{DateTime, Utc};
use document_sub_type::DocumentSubType;
use filter_ast::Expr;
use item_filters::{
    CallStatus, SharedEmailFilter,
    ast::{
        CrmScope, EmailFilterAst, EntityFilterAst,
        calendar_event::CalendarEventLiteral,
        call::CallLiteral,
        channel::{ChannelLiteral, ChannelThreadLiteral, ChannelTypeFilter},
        chat::{ChatLiteral, ChatRole},
        crm_company::CrmCompanyLiteral,
        date::DateLiteral,
        document::DocumentLiteral,
        email::{Email, EmailLiteral},
        foreign_entity::ForeignEntityLiteral,
        project::ProjectLiteral,
        properties::{EntityRefId, PropertiesLiteral, PropertyEntityType, PropertyMatchValue},
        reminder::ReminderLiteral,
    },
};
use macro_user_id::{cowlike::CowLike, email::EmailStr, user_id::MacroUserIdStr};
use model_file_type::FileType;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Maximum accepted GraphQL filter expression depth.
pub const MAX_FILTER_DEPTH: usize = 64;
/// Maximum accepted JSON values in one GraphQL filter input.
pub const MAX_FILTER_NODES: usize = 2_048;
/// Maximum bytes accepted in one string value.
pub const MAX_FILTER_STRING_BYTES: usize = 16 * 1_024;
/// Maximum aggregate bytes across string values.
pub const MAX_FILTER_VALUE_BYTES: usize = 256 * 1_024;

/// Failure to validate, deserialize, or materialize a GraphQL Soup filter.
#[derive(Debug, Error)]
pub enum MaterializeError {
    /// The variables value exceeds a configured ingress bound.
    #[error("GraphQL Soup filter exceeds ingress bounds: {0}")]
    Bounds(String),
    /// The variables value does not have the generated GraphQL input shape.
    #[error("invalid GraphQL Soup filter input: {0}")]
    Shape(#[from] serde_json::Error),
    /// A typed value failed GraphQL-specific domain validation.
    #[error("invalid GraphQL Soup filter value: {0}")]
    Conversion(String),
}

/// Validate and materialize the exact generated GraphQL `filters` variables value.
pub fn materialize_graphql_filter(value: Value) -> Result<EntityFilterAst, MaterializeError> {
    validate_json_bounds(&value).map_err(MaterializeError::Bounds)?;
    serde_json::from_value::<GraphqlEntityFilterAst>(value)?
        .into_ast_unchecked()
        .map_err(|error| MaterializeError::Conversion(error.to_string()))
}

/// Enforce cheap structural bounds before recursive deserialization or compilation.
fn validate_json_bounds(value: &Value) -> Result<(), String> {
    let mut stack = vec![(value, 1usize)];
    let mut nodes = 0usize;
    let mut value_bytes = 0usize;

    while let Some((value, depth)) = stack.pop() {
        if depth > MAX_FILTER_DEPTH {
            return Err(format!("depth exceeds {MAX_FILTER_DEPTH}"));
        }
        nodes += 1;
        if nodes > MAX_FILTER_NODES {
            return Err(format!("node count exceeds {MAX_FILTER_NODES}"));
        }

        match value {
            Value::String(value) => {
                let len = value.len();
                if len > MAX_FILTER_STRING_BYTES {
                    return Err(format!("string bytes exceed {MAX_FILTER_STRING_BYTES}"));
                }
                value_bytes = value_bytes.saturating_add(len);
                if value_bytes > MAX_FILTER_VALUE_BYTES {
                    return Err(format!(
                        "aggregate string bytes exceed {MAX_FILTER_VALUE_BYTES}"
                    ));
                }
            }
            Value::Array(values) => {
                stack.extend(values.iter().map(|value| (value, depth + 1)));
            }
            Value::Object(values) => {
                stack.extend(values.values().map(|value| (value, depth + 1)));
            }
            Value::Null | Value::Bool(_) | Value::Number(_) => {}
        }
    }

    Ok(())
}

/// GraphQL-shape or materialization validation failure.
#[derive(Debug, Error)]
pub struct InputError(String);

impl InputError {
    fn new(message: impl Into<String>) -> Self {
        Self(message.into())
    }
}

impl std::fmt::Display for InputError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.0)
    }
}

type InputResult<T> = Result<T, InputError>;

/// Conversion from a GraphQL filter input tree into a domain filter expression.
trait IntoFilterExpr<T>: Sized {
    /// Convert the input into a filter expression.
    fn into_expr(self) -> InputResult<Expr<T>>;
}

/// Convert an optional GraphQL expression into the shared tree representation.
fn optional_tree<I, T>(input: Option<I>) -> InputResult<Option<Arc<Expr<T>>>>
where
    I: IntoFilterExpr<T>,
{
    input.map(|expr| expr.into_expr().map(Arc::new)).transpose()
}

/// Parse a GraphQL id as a UUID with a field-specific error.
fn parse_id(id: ID, field: &str) -> InputResult<Uuid> {
    let value = id.to_string();
    Uuid::parse_str(&value)
        .map_err(|err| InputError::new(format!("invalid {field} UUID `{value}`: {err}")))
}

/// Parse a Macro user id with a field-specific error.
fn parse_macro_user_id(value: String, field: &str) -> InputResult<MacroUserIdStr<'static>> {
    MacroUserIdStr::parse_from_str(&value)
        .map(CowLike::into_owned)
        .map_err(|err| InputError::new(format!("invalid {field} `{value}`: {err}")))
}

/// Define the recursive GraphQL and serde expression shape for one literal family.
macro_rules! filter_expr_input {
    ($name:ident, $binary_name:ident, $literal:ty, $target:ty, $type_name:literal) => {
        #[doc = concat!("The two operands of a recursive `", $type_name, "` binary expression.")]
        #[cfg_attr(feature = "server", derive(async_graphql::InputObject))]
        #[derive(Serialize, Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct $binary_name {
            /// Left expression.
            left: Box<$name>,
            /// Right expression.
            right: Box<$name>,
        }

        #[doc = concat!("A recursive `", $type_name, "` filter expression.")]
        #[cfg_attr(feature = "server", derive(async_graphql::OneofObject))]
        #[derive(Serialize, Deserialize)]
        #[serde(rename_all = "camelCase")]
        enum $name {
            /// Both expressions must match.
            And($binary_name),
            /// Either expression may match.
            Or($binary_name),
            /// Negate an expression.
            Not(Box<$name>),
            /// Match a literal.
            Literal($literal),
        }

        impl IntoFilterExpr<$target> for $name {
            fn into_expr(self) -> InputResult<Expr<$target>> {
                match self {
                    Self::And(exprs) => {
                        Ok(Expr::and(exprs.left.into_expr()?, exprs.right.into_expr()?))
                    }
                    Self::Or(exprs) => {
                        Ok(Expr::or(exprs.left.into_expr()?, exprs.right.into_expr()?))
                    }
                    Self::Not(expr) => expr.into_expr().map(Expr::is_not),
                    Self::Literal(literal) => literal.into_expr(),
                }
            }
        }
    };
}

filter_expr_input!(
    GraphqlFilterPropertiesExpr,
    GraphqlFilterPropertiesBinaryExpr,
    GraphqlFilterPropertiesLiteral,
    PropertiesLiteral,
    "PropertiesFilterExpr"
);

/// GraphQL input for matching a property value on an entity.
#[cfg_attr(feature = "server", derive(async_graphql::InputObject))]
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphqlFilterPropertiesLiteral {
    /// Property definition id to match.
    property_definition_id: ID,
    /// Optional entity type scope for the property match.
    entity_type: Option<GraphqlPropertyEntityType>,
    /// Value to compare against the property.
    value: GraphqlFilterPropertyMatchValue,
}

impl IntoFilterExpr<PropertiesLiteral> for GraphqlFilterPropertiesLiteral {
    fn into_expr(self) -> InputResult<Expr<PropertiesLiteral>> {
        Ok(Expr::val(PropertiesLiteral {
            property_definition_id: parse_id(self.property_definition_id, "propertyDefinitionId")?,
            entity_type: self
                .entity_type
                .map(PropertyEntityType::try_from)
                .transpose()
                .map_err(|entity_type| {
                    InputError::new(format!("unsupported entityType {entity_type:?}"))
                })?,
            value: self.value.into_ast()?,
        }))
    }
}

/// GraphQL input value used when matching a property.
#[cfg_attr(feature = "server", derive(async_graphql::OneofObject))]
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum GraphqlFilterPropertyMatchValue {
    /// Select option id to match.
    SelectOption(ID),
    /// Entity reference id to match.
    EntityRef(ID),
}

impl GraphqlFilterPropertyMatchValue {
    /// Convert this input into the domain representation.
    fn into_ast(self) -> InputResult<PropertyMatchValue> {
        Ok(match self {
            Self::SelectOption(id) => {
                PropertyMatchValue::SelectOption(parse_id(id, "selectOption")?)
            }
            Self::EntityRef(value) => PropertyMatchValue::EntityRef(
                EntityRefId::new(value.to_string())
                    .map_err(|err| InputError::new(format!("invalid entityRef: {err}")))?,
            ),
        })
    }
}

/// An entity type supported by property filters in browser-only materialization.
#[cfg(not(feature = "server"))]
#[derive(Debug, Copy, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum GraphqlPropertyEntityType {
    /// Calendar event entity.
    CalendarEvent,
    /// Call record entity.
    CallRecord,
    /// Channel entity.
    Channel,
    /// Chat entity.
    Chat,
    /// Company entity.
    Company,
    /// Document entity.
    Document,
    /// Project entity.
    Project,
    /// Task entity.
    Task,
    /// Thread entity.
    Thread,
    /// User entity.
    User,
}

#[cfg(not(feature = "server"))]
impl TryFrom<GraphqlPropertyEntityType> for PropertyEntityType {
    type Error = GraphqlPropertyEntityType;

    fn try_from(value: GraphqlPropertyEntityType) -> Result<Self, Self::Error> {
        Ok(match value {
            GraphqlPropertyEntityType::CalendarEvent => Self::CalendarEvent,
            GraphqlPropertyEntityType::Channel => Self::Channel,
            GraphqlPropertyEntityType::Chat => Self::Chat,
            GraphqlPropertyEntityType::Company => Self::Company,
            GraphqlPropertyEntityType::Document => Self::Document,
            GraphqlPropertyEntityType::Project => Self::Project,
            GraphqlPropertyEntityType::Task => Self::Task,
            GraphqlPropertyEntityType::Thread => Self::Thread,
            GraphqlPropertyEntityType::User => Self::User,
            other @ GraphqlPropertyEntityType::CallRecord => return Err(other),
        })
    }
}

/// GraphQL input mirroring `item_filters::ast::EntityFilterAst`.
#[cfg_attr(feature = "server", derive(async_graphql::InputObject))]
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct GraphqlEntityFilterAst {
    /// The calendar event filter to apply.
    calendar_event_filter: Option<GraphqlCalendarEventExpr>,
    /// The document filter to apply.
    document_filter: Option<GraphqlDocumentExpr>,
    /// The project filter to apply.
    project_filter: Option<GraphqlProjectExpr>,
    /// The chat filter to apply.
    chat_filter: Option<GraphqlChatExpr>,
    /// The email filter to apply.
    email_filter: Option<GraphqlEmailFilterAst>,
    /// The channel filter to apply.
    channel_filter: Option<GraphqlChannelExpr>,
    /// The channel thread filter to apply.
    channel_thread_filter: Option<GraphqlChannelThreadExpr>,
    /// The call filter to apply.
    call_filter: Option<GraphqlCallExpr>,
    /// The crm company filter to apply.
    crm_company_filter: Option<GraphqlCrmCompanyExpr>,
    /// The foreign entity filter to apply.
    foreign_entity_filter: Option<GraphqlForeignEntityExpr>,
    /// The reminder filter to apply.
    reminder_filter: Option<GraphqlReminderExpr>,
    /// The properties filter to apply.
    properties_filter: Option<GraphqlFilterPropertiesExpr>,
}

impl GraphqlEntityFilterAst {
    /// Convert this value into the ast representation.
    pub fn into_ast(self) -> InputResult<EntityFilterAst> {
        let value = serde_json::to_value(&self).map_err(|error| {
            InputError::new(format!("failed to validate GraphQL filter input: {error}"))
        })?;
        validate_json_bounds(&value).map_err(InputError::new)?;
        self.into_ast_unchecked()
    }

    /// Convert an input whose serialized representation already passed ingress bounds.
    fn into_ast_unchecked(self) -> InputResult<EntityFilterAst> {
        Ok(EntityFilterAst {
            calendar_event_filter: optional_tree(self.calendar_event_filter)?,
            document_filter: optional_tree(self.document_filter)?,
            project_filter: optional_tree(self.project_filter)?,
            chat_filter: optional_tree(self.chat_filter)?,
            email_filter: self
                .email_filter
                .map(GraphqlEmailFilterAst::into_ast)
                .transpose()?
                .unwrap_or_default(),
            channel_filter: optional_tree(self.channel_filter)?,
            channel_thread_filter: optional_tree(self.channel_thread_filter)?,
            call_filter: optional_tree(self.call_filter)?,
            crm_company_filter: optional_tree(self.crm_company_filter)?,
            foreign_entity_filter: optional_tree(self.foreign_entity_filter)?,
            reminder_filter: optional_tree(self.reminder_filter)?,
            properties_filter: optional_tree(self.properties_filter)?,
        })
    }
}

filter_expr_input!(
    GraphqlCalendarEventExpr,
    GraphqlCalendarEventBinaryExpr,
    GraphqlCalendarEventLiteral,
    CalendarEventLiteral,
    "CalendarEventFilterExpr"
);
filter_expr_input!(
    GraphqlDocumentExpr,
    GraphqlDocumentBinaryExpr,
    GraphqlDocumentLiteral,
    DocumentLiteral,
    "DocumentFilterExpr"
);

/// GraphQL input representing a calendar event literal.
#[cfg_attr(feature = "server", derive(async_graphql::OneofObject))]
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum GraphqlCalendarEventLiteral {
    /// Canonical event id.
    Id(ID),
    /// Event status.
    Status(String),
    /// Master start must be before this RFC3339 instant.
    StartsBefore(String),
    /// Master end must be after this RFC3339 instant.
    EndsAfter(String),
    /// Attendee email.
    Attendee(String),
    /// Organizer email.
    Organizer(String),
    /// Notification done state for the requester.
    NotificationDone(bool),
    /// Notification seen state for the requester.
    NotificationSeen(bool),
}

impl IntoFilterExpr<CalendarEventLiteral> for GraphqlCalendarEventLiteral {
    fn into_expr(self) -> InputResult<Expr<CalendarEventLiteral>> {
        let parse_date = |value: String| {
            DateTime::parse_from_rfc3339(&value)
                .map(|date| date.with_timezone(&Utc))
                .map_err(|error| {
                    InputError::new(format!("invalid RFC3339 calendar date `{value}`: {error}"))
                })
        };
        Ok(Expr::val(match self {
            Self::Id(id) => CalendarEventLiteral::Id(parse_id(id, "id")?),
            Self::Status(status) => CalendarEventLiteral::Status(status.to_ascii_lowercase()),
            Self::StartsBefore(value) => CalendarEventLiteral::StartsBefore(parse_date(value)?),
            Self::EndsAfter(value) => CalendarEventLiteral::EndsAfter(parse_date(value)?),
            Self::Attendee(email) => CalendarEventLiteral::Attendee(email.to_ascii_lowercase()),
            Self::Organizer(email) => CalendarEventLiteral::Organizer(email.to_ascii_lowercase()),
            Self::NotificationDone(done) => CalendarEventLiteral::NotificationDone(done),
            Self::NotificationSeen(seen) => CalendarEventLiteral::NotificationSeen(seen),
        }))
    }
}
filter_expr_input!(
    GraphqlProjectExpr,
    GraphqlProjectBinaryExpr,
    GraphqlProjectLiteral,
    ProjectLiteral,
    "ProjectFilterExpr"
);
filter_expr_input!(
    GraphqlChatExpr,
    GraphqlChatBinaryExpr,
    GraphqlChatLiteral,
    ChatLiteral,
    "ChatFilterExpr"
);
filter_expr_input!(
    GraphqlEmailExpr,
    GraphqlEmailBinaryExpr,
    GraphqlEmailLiteral,
    EmailLiteral,
    "EmailFilterExpr"
);
filter_expr_input!(
    GraphqlChannelExpr,
    GraphqlChannelBinaryExpr,
    GraphqlChannelLiteral,
    ChannelLiteral,
    "ChannelFilterExpr"
);
filter_expr_input!(
    GraphqlChannelThreadExpr,
    GraphqlChannelThreadBinaryExpr,
    GraphqlChannelThreadLiteral,
    ChannelThreadLiteral,
    "ChannelThreadFilterExpr"
);
filter_expr_input!(
    GraphqlCallExpr,
    GraphqlCallBinaryExpr,
    GraphqlCallLiteral,
    CallLiteral,
    "CallFilterExpr"
);
filter_expr_input!(
    GraphqlCrmCompanyExpr,
    GraphqlCrmCompanyBinaryExpr,
    GraphqlCrmCompanyLiteral,
    CrmCompanyLiteral,
    "CrmCompanyFilterExpr"
);
filter_expr_input!(
    GraphqlForeignEntityExpr,
    GraphqlForeignEntityBinaryExpr,
    GraphqlForeignEntityLiteral,
    ForeignEntityLiteral,
    "ForeignEntityFilterExpr"
);
filter_expr_input!(
    GraphqlReminderExpr,
    GraphqlReminderBinaryExpr,
    GraphqlReminderLiteral,
    ReminderLiteral,
    "ReminderFilterExpr"
);
/// GraphQL input representing the email filter ast.
#[cfg_attr(feature = "server", derive(async_graphql::InputObject))]
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GraphqlEmailFilterAst {
    /// The tree.
    tree: Option<GraphqlEmailExpr>,
    /// The crm scope.
    crm_scope: Option<GraphqlCrmScope>,
}

impl GraphqlEmailFilterAst {
    /// Convert this value into the ast representation.
    fn into_ast(self) -> InputResult<EmailFilterAst> {
        Ok(EmailFilterAst {
            tree: optional_tree(self.tree)?,
            crm_scope: self.crm_scope.map(GraphqlCrmScope::into_ast).transpose()?,
        })
    }
}

/// GraphQL input representing the crm scope.
#[cfg_attr(feature = "server", derive(async_graphql::OneofObject))]
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum GraphqlCrmScope {
    /// The domains option.
    Domains(Vec<String>),
    /// The addresses option.
    Addresses(Vec<String>),
}

impl GraphqlCrmScope {
    /// Convert this value into the ast representation.
    fn into_ast(self) -> InputResult<CrmScope> {
        match self {
            Self::Domains(domains) if domains.is_empty() => {
                Err(InputError::new("CrmScope.domains cannot be empty"))
            }
            Self::Domains(domains) => Ok(CrmScope::Domains(domains)),
            Self::Addresses(addresses) if addresses.is_empty() => {
                Err(InputError::new("CrmScope.addresses cannot be empty"))
            }
            Self::Addresses(addresses) => Ok(CrmScope::Addresses(addresses)),
        }
    }
}

/// GraphQL input representing the date literal.
#[cfg_attr(feature = "server", derive(async_graphql::OneofObject))]
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum GraphqlDateLiteral {
    /// The gt option.
    Gt(String),
    /// The lt option.
    Lt(String),
    /// The gte option.
    Gte(String),
    /// The lte option.
    Lte(String),
}

impl GraphqlDateLiteral {
    /// Parse an email address from a GraphQL string value.
    fn parse(value: String) -> InputResult<DateTime<Utc>> {
        DateTime::parse_from_rfc3339(&value)
            .map(|dt| dt.with_timezone(&Utc))
            .map_err(|err| InputError::new(format!("invalid RFC3339 date `{value}`: {err}")))
    }

    /// Convert this value into the ast representation.
    fn into_ast(self) -> InputResult<DateLiteral> {
        Ok(match self {
            Self::Gt(value) => DateLiteral::GreaterThan(Self::parse(value)?),
            Self::Lt(value) => DateLiteral::LessThan(Self::parse(value)?),
            Self::Gte(value) => DateLiteral::GreaterThanOrEqual(Self::parse(value)?),
            Self::Lte(value) => DateLiteral::LessThanOrEqual(Self::parse(value)?),
        })
    }
}

/// GraphQL input representing the document literal.
#[cfg_attr(feature = "server", derive(async_graphql::OneofObject))]
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum GraphqlDocumentLiteral {
    /// The file type option.
    FileType(String),
    /// The id option.
    Id(ID),
    /// The project id option.
    ProjectId(ID),
    /// The owner option.
    Owner(String),
    /// The importance option.
    Importance(bool),
    /// The notification done option.
    NotificationDone(bool),
    /// The notification seen option.
    NotificationSeen(bool),
    /// The include cbm atm nc option.
    IncludeCbmAtmNc(bool),
    /// The sub type option.
    SubType(GraphqlDocumentSubType),
    /// The file assoc option.
    FileAssoc(String),
    /// The is email attachment option.
    IsEmailAttachment(bool),
    /// The created at option.
    CreatedAt(GraphqlDateLiteral),
    /// The updated at option.
    UpdatedAt(GraphqlDateLiteral),
}

impl IntoFilterExpr<DocumentLiteral> for GraphqlDocumentLiteral {
    /// Convert this value into the expr representation.
    fn into_expr(self) -> InputResult<Expr<DocumentLiteral>> {
        let literal = match self {
            Self::FileAssoc(value) => {
                let (_, file_types) = item_filters::ast::document::parse_to_file_types(&value)
                    .map_err(|err| InputError::new(err.to_string()))?;
                return file_types
                    .map(|file_type| Expr::val(DocumentLiteral::FileType(file_type)))
                    .reduce(Expr::or)
                    .ok_or_else(|| InputError::new("fileAssoc expansion cannot be empty"));
            }
            Self::FileType(value) => DocumentLiteral::FileType(
                FileType::from_str(&value)
                    .map_err(|err| InputError::new(format!("invalid fileType `{value}`: {err}")))?,
            ),
            Self::Id(id) => DocumentLiteral::Id(parse_id(id, "id")?),
            Self::ProjectId(id) => DocumentLiteral::ProjectId(parse_id(id, "projectId")?),
            Self::Owner(owner) => DocumentLiteral::Owner(parse_macro_user_id(owner, "owner")?),
            Self::Importance(importance) => DocumentLiteral::Importance(importance),
            Self::NotificationDone(done) => DocumentLiteral::NotificationDone(done),
            Self::NotificationSeen(seen) => DocumentLiteral::NotificationSeen(seen),
            Self::IncludeCbmAtmNc(include) => DocumentLiteral::IncludeCbmAtmNc(include),
            Self::SubType(sub_type) => DocumentLiteral::SubType(sub_type.into_model()),
            Self::IsEmailAttachment(value) => DocumentLiteral::IsEmailAttachment(value),
            Self::CreatedAt(date) => DocumentLiteral::CreatedAt(date.into_ast()?),
            Self::UpdatedAt(date) => DocumentLiteral::UpdatedAt(date.into_ast()?),
        };
        Ok(Expr::val(literal))
    }
}

/// GraphQL input representing the document sub type.
#[cfg_attr(feature = "server", derive(async_graphql::Enum))]
#[derive(Copy, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum GraphqlDocumentSubType {
    /// The task option.
    Task,
    /// The snippet option.
    Snippet,
    /// The skill option.
    Skill,
}

impl GraphqlDocumentSubType {
    /// Convert this GraphQL subtype into the document-filter model.
    fn into_model(self) -> DocumentSubType {
        match self {
            Self::Task => DocumentSubType::Task,
            Self::Snippet => DocumentSubType::Snippet,
            Self::Skill => DocumentSubType::Skill,
        }
    }
}

/// GraphQL input representing the project literal.
#[cfg_attr(feature = "server", derive(async_graphql::OneofObject))]
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum GraphqlProjectLiteral {
    /// The project id option.
    ProjectId(ID),
    /// The project id self option.
    ProjectIdSelf(ID),
    /// The owner option.
    Owner(String),
    /// The importance option.
    Importance(bool),
    /// The notification done option.
    NotificationDone(bool),
    /// The notification seen option.
    NotificationSeen(bool),
    /// The created at option.
    CreatedAt(GraphqlDateLiteral),
    /// The updated at option.
    UpdatedAt(GraphqlDateLiteral),
}

impl IntoFilterExpr<ProjectLiteral> for GraphqlProjectLiteral {
    /// Convert this value into the expr representation.
    fn into_expr(self) -> InputResult<Expr<ProjectLiteral>> {
        let literal = match self {
            Self::ProjectId(id) => ProjectLiteral::ProjectId(parse_id(id, "projectId")?),
            Self::ProjectIdSelf(id) => {
                ProjectLiteral::ProjectIdSelf(parse_id(id, "projectIdSelf")?)
            }
            Self::Owner(owner) => ProjectLiteral::Owner(parse_macro_user_id(owner, "owner")?),
            Self::Importance(importance) => ProjectLiteral::Importance(importance),
            Self::NotificationDone(done) => ProjectLiteral::NotificationDone(done),
            Self::NotificationSeen(seen) => ProjectLiteral::NotificationSeen(seen),
            Self::CreatedAt(date) => ProjectLiteral::CreatedAt(date.into_ast()?),
            Self::UpdatedAt(date) => ProjectLiteral::UpdatedAt(date.into_ast()?),
        };
        Ok(Expr::val(literal))
    }
}

/// GraphQL input representing the chat literal.
#[cfg_attr(feature = "server", derive(async_graphql::OneofObject))]
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum GraphqlChatLiteral {
    /// The project id option.
    ProjectId(ID),
    /// The role option.
    Role(GraphqlChatRole),
    /// The chat id option.
    ChatId(ID),
    /// The owner option.
    Owner(String),
    /// The importance option.
    Importance(bool),
    /// The notification done option.
    NotificationDone(bool),
    /// The notification seen option.
    NotificationSeen(bool),
    /// The created at option.
    CreatedAt(GraphqlDateLiteral),
    /// The updated at option.
    UpdatedAt(GraphqlDateLiteral),
}

impl IntoFilterExpr<ChatLiteral> for GraphqlChatLiteral {
    /// Convert this value into the expr representation.
    fn into_expr(self) -> InputResult<Expr<ChatLiteral>> {
        let literal = match self {
            Self::ProjectId(id) => ChatLiteral::ProjectId(parse_id(id, "projectId")?),
            Self::Role(role) => ChatLiteral::Role(role.into_model()),
            Self::ChatId(id) => ChatLiteral::ChatId(parse_id(id, "chatId")?),
            Self::Owner(owner) => ChatLiteral::Owner(parse_macro_user_id(owner, "owner")?),
            Self::Importance(importance) => ChatLiteral::Importance(importance),
            Self::NotificationDone(done) => ChatLiteral::NotificationDone(done),
            Self::NotificationSeen(seen) => ChatLiteral::NotificationSeen(seen),
            Self::CreatedAt(date) => ChatLiteral::CreatedAt(date.into_ast()?),
            Self::UpdatedAt(date) => ChatLiteral::UpdatedAt(date.into_ast()?),
        };
        Ok(Expr::val(literal))
    }
}

/// GraphQL input representing the chat role.
#[cfg_attr(feature = "server", derive(async_graphql::Enum))]
#[derive(Copy, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum GraphqlChatRole {
    /// The user option.
    User,
    /// The system option.
    System,
    /// The assistant option.
    Assistant,
}

impl GraphqlChatRole {
    /// Convert this GraphQL role into the chat-filter model.
    fn into_model(self) -> ChatRole {
        match self {
            Self::User => ChatRole::User,
            Self::System => ChatRole::System,
            Self::Assistant => ChatRole::Assistant,
        }
    }
}

/// GraphQL input representing the email literal.
#[cfg_attr(feature = "server", derive(async_graphql::OneofObject))]
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum GraphqlEmailLiteral {
    /// The sender option.
    Sender(GraphqlEmailValue),
    /// The cc option.
    Cc(GraphqlEmailValue),
    /// The bcc option.
    Bcc(GraphqlEmailValue),
    /// The recipient option.
    Recipient(GraphqlEmailValue),
    /// The thread id option.
    ThreadId(ID),
    /// The owner option.
    Owner(ID),
    /// The project id option.
    ProjectId(String),
    /// The importance option.
    Importance(bool),
    /// The notification done option.
    NotificationDone(bool),
    /// The notification seen option.
    NotificationSeen(bool),
    /// The shared option.
    Shared(GraphqlSharedEmailFilter),
    /// The calendar only option.
    CalendarOnly(bool),
    /// The created at option.
    CreatedAt(GraphqlDateLiteral),
    /// The updated at option.
    UpdatedAt(GraphqlDateLiteral),
    /// The per-viewer viewed at option.
    ViewedAt(GraphqlDateLiteral),
}

impl IntoFilterExpr<EmailLiteral> for GraphqlEmailLiteral {
    /// Convert this value into the expr representation.
    fn into_expr(self) -> InputResult<Expr<EmailLiteral>> {
        let literal = match self {
            Self::Sender(value) => EmailLiteral::Sender(value.into_ast()?),
            Self::Cc(value) => EmailLiteral::Cc(value.into_ast()?),
            Self::Bcc(value) => EmailLiteral::Bcc(value.into_ast()?),
            Self::Recipient(value) => EmailLiteral::Recipient(value.into_ast()?),
            Self::ThreadId(id) => EmailLiteral::ThreadId(parse_id(id, "threadId")?),
            Self::Owner(id) => EmailLiteral::Owner(parse_id(id, "owner")?),
            Self::ProjectId(id) => EmailLiteral::ProjectId(id),
            Self::Importance(importance) => EmailLiteral::Importance(importance),
            Self::NotificationDone(done) => EmailLiteral::NotificationDone(done),
            Self::NotificationSeen(seen) => EmailLiteral::NotificationSeen(seen),
            Self::Shared(shared) => EmailLiteral::Shared(shared.into_model()),
            Self::CalendarOnly(calendar_only) => EmailLiteral::CalendarOnly(calendar_only),
            Self::CreatedAt(date) => EmailLiteral::CreatedAt(date.into_ast()?),
            Self::UpdatedAt(date) => EmailLiteral::UpdatedAt(date.into_ast()?),
            Self::ViewedAt(date) => EmailLiteral::ViewedAt(date.into_ast()?),
        };
        Ok(Expr::val(literal))
    }
}

/// GraphQL input representing the email value.
#[cfg_attr(feature = "server", derive(async_graphql::OneofObject))]
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum GraphqlEmailValue {
    /// The partial option.
    Partial(String),
    /// The complete option.
    Complete(String),
    /// The domain option.
    Domain(String),
}

impl GraphqlEmailValue {
    /// Convert this value into the ast representation.
    fn into_ast(self) -> InputResult<Email> {
        Ok(match self {
            Self::Partial(value) => Email::Partial(value),
            Self::Complete(value) => Email::Complete(
                EmailStr::parse_from_str(&value)
                    .map(CowLike::into_owned)
                    .map_err(|err| {
                        InputError::new(format!("invalid complete email `{value}`: {err}"))
                    })?,
            ),
            Self::Domain(value) => Email::Domain(value),
        })
    }
}

/// GraphQL input representing the shared email filter.
#[cfg_attr(feature = "server", derive(async_graphql::Enum))]
#[derive(Copy, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum GraphqlSharedEmailFilter {
    /// The exclude option.
    Exclude,
    /// The include option.
    Include,
    /// The only option.
    Only,
}

impl GraphqlSharedEmailFilter {
    /// Convert this GraphQL option into the shared-email filter model.
    fn into_model(self) -> SharedEmailFilter {
        match self {
            Self::Exclude => SharedEmailFilter::Exclude,
            Self::Include => SharedEmailFilter::Include,
            Self::Only => SharedEmailFilter::Only,
        }
    }
}

/// GraphQL input representing the channel literal.
#[cfg_attr(feature = "server", derive(async_graphql::OneofObject))]
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum GraphqlChannelLiteral {
    /// The thread id option.
    ThreadId(ID),
    /// The mention option.
    Mention(String),
    /// The organization id option.
    OrganizationId(i64),
    /// The team id option.
    TeamId(ID),
    /// The channel id option.
    ChannelId(ID),
    /// The sender option.
    Sender(String),
    /// The channel type option.
    ChannelType(GraphqlChannelTypeFilter),
    /// The importance option.
    Importance(bool),
    /// The is participant option. Filters by whether the requesting user is an
    /// active participant; its presence widens the candidate set to team channels
    /// of the user's teams they have not joined.
    IsParticipant(bool),
    /// The notification done option.
    NotificationDone(bool),
    /// The notification seen option.
    NotificationSeen(bool),
}

impl IntoFilterExpr<ChannelLiteral> for GraphqlChannelLiteral {
    /// Convert this value into the expr representation.
    fn into_expr(self) -> InputResult<Expr<ChannelLiteral>> {
        let literal = match self {
            Self::ThreadId(id) => ChannelLiteral::ThreadId(parse_id(id, "threadId")?),
            Self::Mention(mention) => {
                ChannelLiteral::Mention(parse_macro_user_id(mention, "mention")?)
            }
            Self::OrganizationId(id) => ChannelLiteral::OrganizationId(id),
            Self::TeamId(id) => ChannelLiteral::TeamId(parse_id(id, "teamId")?),
            Self::ChannelId(id) => ChannelLiteral::ChannelId(parse_id(id, "channelId")?),
            Self::Sender(sender) => ChannelLiteral::Sender(parse_macro_user_id(sender, "sender")?),
            Self::ChannelType(channel_type) => {
                ChannelLiteral::ChannelType(channel_type.into_model())
            }
            Self::Importance(importance) => ChannelLiteral::Importance(importance),
            Self::IsParticipant(is_participant) => ChannelLiteral::IsParticipant(is_participant),
            Self::NotificationDone(done) => ChannelLiteral::NotificationDone(done),
            Self::NotificationSeen(seen) => ChannelLiteral::NotificationSeen(seen),
        };
        Ok(Expr::val(literal))
    }
}

/// GraphQL input representing the channel type filter.
#[cfg_attr(feature = "server", derive(async_graphql::Enum))]
#[derive(Copy, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum GraphqlChannelTypeFilter {
    /// The public option.
    Public,
    /// The private option.
    Private,
    /// The direct message option.
    DirectMessage,
    /// The team option.
    Team,
}

impl GraphqlChannelTypeFilter {
    /// Convert this GraphQL option into the channel-filter model.
    fn into_model(self) -> ChannelTypeFilter {
        match self {
            Self::Public => ChannelTypeFilter::Public,
            Self::Private => ChannelTypeFilter::Private,
            Self::DirectMessage => ChannelTypeFilter::DirectMessage,
            Self::Team => ChannelTypeFilter::Team,
        }
    }
}

/// GraphQL input representing the channel thread literal.
#[cfg_attr(feature = "server", derive(async_graphql::OneofObject))]
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum GraphqlChannelThreadLiteral {
    /// The thread id option.
    ThreadId(ID),
    /// The channel id option.
    ChannelId(ID),
    /// The root sender option.
    RootSender(String),
    /// The participant option.
    Participant(String),
    /// The notification done option.
    NotificationDone(bool),
    /// The notification seen option.
    NotificationSeen(bool),
}

impl IntoFilterExpr<ChannelThreadLiteral> for GraphqlChannelThreadLiteral {
    /// Convert this value into the expr representation.
    fn into_expr(self) -> InputResult<Expr<ChannelThreadLiteral>> {
        let literal = match self {
            Self::ThreadId(id) => ChannelThreadLiteral::ThreadId(parse_id(id, "threadId")?),
            Self::ChannelId(id) => ChannelThreadLiteral::ChannelId(parse_id(id, "channelId")?),
            Self::RootSender(sender) => {
                ChannelThreadLiteral::RootSender(parse_macro_user_id(sender, "rootSender")?)
            }
            Self::Participant(participant) => {
                ChannelThreadLiteral::Participant(parse_macro_user_id(participant, "participant")?)
            }
            Self::NotificationDone(done) => ChannelThreadLiteral::NotificationDone(done),
            Self::NotificationSeen(seen) => ChannelThreadLiteral::NotificationSeen(seen),
        };
        Ok(Expr::val(literal))
    }
}

/// GraphQL input representing the call literal.
#[cfg_attr(feature = "server", derive(async_graphql::OneofObject))]
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum GraphqlCallLiteral {
    /// The call id option.
    CallId(ID),
    /// The channel id option.
    ChannelId(ID),
    /// The speaker option.
    Speaker(String),
    /// The status option.
    Status(GraphqlCallStatus),
    /// The attended option.
    Attended(bool),
}

impl IntoFilterExpr<CallLiteral> for GraphqlCallLiteral {
    /// Convert this value into the expr representation.
    fn into_expr(self) -> InputResult<Expr<CallLiteral>> {
        let literal = match self {
            Self::CallId(id) => CallLiteral::CallId(parse_id(id, "callId")?),
            Self::ChannelId(id) => CallLiteral::ChannelId(parse_id(id, "channelId")?),
            Self::Speaker(speaker) => {
                CallLiteral::Speaker(parse_macro_user_id(speaker, "speaker")?)
            }
            Self::Status(status) => CallLiteral::Status(status.into_model()),
            Self::Attended(attended) => CallLiteral::Attended(attended),
        };
        Ok(Expr::val(literal))
    }
}

/// GraphQL input representing the call status.
#[cfg_attr(feature = "server", derive(async_graphql::Enum))]
#[derive(Copy, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum GraphqlCallStatus {
    /// The attended option.
    Attended,
    /// The missed option.
    Missed,
    /// The unattended option.
    Unattended,
}

impl GraphqlCallStatus {
    /// Convert this GraphQL status into the call-filter model.
    fn into_model(self) -> CallStatus {
        match self {
            Self::Attended => CallStatus::Attended,
            Self::Missed => CallStatus::Missed,
            Self::Unattended => CallStatus::Unattended,
        }
    }
}

/// GraphQL input representing the reminder literal.
#[cfg_attr(feature = "server", derive(async_graphql::OneofObject))]
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum GraphqlReminderLiteral {
    /// Opt this query into reminders at all. Reminders are off by default, so
    /// without this (or an `id`/`entity`) Soup omits them entirely — a filter
    /// of only `completed` would otherwise silently match nothing. Must be
    /// `true`; there is no literal for excluding reminders, that is the default.
    Include(bool),
    /// The id option.
    Id(ID),
    /// The referenced entity, as `"{type}:{id}"`.
    Entity(String),
    /// Whether the owner has marked the reminder done.
    Completed(bool),
    /// Whether the reminder has come due and is awaiting its owner.
    Fired(bool),
}

impl IntoFilterExpr<ReminderLiteral> for GraphqlReminderLiteral {
    /// Convert this value into the expr representation.
    fn into_expr(self) -> InputResult<Expr<ReminderLiteral>> {
        let literal = match self {
            // `include: false` is the default, not a literal — accepting it
            // would opt the query in, the opposite of what was asked.
            Self::Include(false) => {
                return Err(InputError::new(
                    "reminder `include` must be true; omit the filter to exclude reminders",
                ));
            }
            Self::Include(true) => ReminderLiteral::Include,
            Self::Id(id) => ReminderLiteral::Id(parse_id(id, "id")?),
            Self::Entity(entity) => ReminderLiteral::Entity(entity),
            Self::Completed(completed) => ReminderLiteral::Completed(completed),
            Self::Fired(fired) => ReminderLiteral::Fired(fired),
        };
        Ok(Expr::val(literal))
    }
}

/// GraphQL input representing the crm company literal.
#[cfg_attr(feature = "server", derive(async_graphql::OneofObject))]
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum GraphqlCrmCompanyLiteral {
    /// The id option.
    Id(ID),
    /// The hidden option.
    Hidden(bool),
}

impl IntoFilterExpr<CrmCompanyLiteral> for GraphqlCrmCompanyLiteral {
    /// Convert this value into the expr representation.
    fn into_expr(self) -> InputResult<Expr<CrmCompanyLiteral>> {
        let literal = match self {
            Self::Id(id) => CrmCompanyLiteral::Id(parse_id(id, "id")?),
            Self::Hidden(hidden) => CrmCompanyLiteral::Hidden(hidden),
        };
        Ok(Expr::val(literal))
    }
}

/// GraphQL input representing the foreign entity literal.
#[cfg_attr(feature = "server", derive(async_graphql::OneofObject))]
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
enum GraphqlForeignEntityLiteral {
    /// The id option.
    Id(ID),
    /// The foreign entity id option.
    ForeignEntityId(String),
    /// The foreign entity source option.
    ForeignEntitySource(String),
    /// The includes me option.
    IncludesMe(bool),
    /// The notification done option.
    NotificationDone(bool),
    /// The notification seen option.
    NotificationSeen(bool),
}

impl IntoFilterExpr<ForeignEntityLiteral> for GraphqlForeignEntityLiteral {
    /// Convert this value into the expr representation.
    fn into_expr(self) -> InputResult<Expr<ForeignEntityLiteral>> {
        let literal = match self {
            Self::Id(id) => ForeignEntityLiteral::Id(parse_id(id, "id")?),
            Self::ForeignEntityId(id) => ForeignEntityLiteral::ForeignEntityId(id),
            Self::ForeignEntitySource(source) => ForeignEntityLiteral::ForeignEntitySource(source),
            Self::IncludesMe(true) => ForeignEntityLiteral::IncludesMe,
            Self::IncludesMe(false) => {
                return Err(InputError::new(
                    "ForeignEntityLiteral.includesMe must be true",
                ));
            }
            Self::NotificationDone(done) => ForeignEntityLiteral::NotificationDone(done),
            Self::NotificationSeen(seen) => ForeignEntityLiteral::NotificationSeen(seen),
        };
        Ok(Expr::val(literal))
    }
}
