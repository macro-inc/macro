use std::{str::FromStr, sync::Arc};

use async_graphql::{Enum, ID};
use chrono::{DateTime, Utc};
use document_sub_type::DocumentSubType;
use filter_ast::Expr;
use item_filters::{
    CallStatus, SharedEmailFilter,
    ast::{
        CrmScope, EmailFilterAst, EntityFilterAst,
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
    },
};
use macro_user_id::{cowlike::CowLike, email::EmailStr, user_id::MacroUserIdStr};
use model_file_type::FileType;
use models_pagination::{Base64Str, CursorWithValAndFilter, SimpleSortMethod};
use soup::domain::models::{SoupQuery, SoupRequest, SoupType};
use uuid::Uuid;

use crate::request_context::GraphqlSoupRequestContext;

/// Input for `Query.soup`.
#[derive(async_graphql::InputObject)]
pub struct SoupInput {
    /// Maximum number of items to return. Defaults to 20, max 500.
    limit: Option<u16>,
    /// Whether to return expanded Soup items. Defaults to true.
    expand: Option<bool>,
    /// Simple timestamp sort. Defaults to VIEWED_AT. Frecency is intentionally
    /// not supported by this initial GraphQL adapter.
    sort_method: Option<GraphqlSimpleSortMethod>,
    /// Opaque cursor returned by a previous GraphQL Soup response.
    cursor: Option<String>,
    /// Email preview view used when hydrating email Soup items.
    email_view: Option<GraphqlEmailView>,
    /// AST-shaped filters applied to each Soup entity type.
    filters: Option<GraphqlEntityFilterAst>,
}

impl SoupInput {
    pub(crate) fn into_request(
        self,
        request_context: &GraphqlSoupRequestContext,
    ) -> async_graphql::Result<SoupRequest<EntityFilterAst>> {
        let filter = self
            .filters
            .map(GraphqlEntityFilterAst::into_ast)
            .transpose()?
            .unwrap_or_default();
        let sort = self
            .sort_method
            .map(SimpleSortMethod::from)
            .unwrap_or(SimpleSortMethod::ViewedAt);

        let cursor = match self.cursor {
            Some(cursor) => {
                let cursor = Base64Str::<
                    CursorWithValAndFilter<Uuid, SimpleSortMethod, EntityFilterAst>,
                >::new_from_string(cursor)
                .decode_json()
                .map_err(|err| async_graphql::Error::new(format!("invalid cursor: {err}")))?;
                SoupQuery::new_cursor_simple(cursor)
            }
            None => SoupQuery::new_sort_simple(sort, filter),
        };

        Ok(SoupRequest {
            soup_type: match self.expand {
                Some(false) => SoupType::UnExpanded,
                Some(true) | None => SoupType::Expanded,
            },
            limit: self.limit.unwrap_or(20).min(500),
            cursor,
            user: request_context.macro_user_id.clone(),
            email_preview_view: self
                .email_view
                .map(GraphqlEmailView::as_preview_view_str)
                .unwrap_or("inbox")
                .parse()
                .map_err(async_graphql::Error::new)?,
            link_ids: request_context.link_ids.clone(),
        })
    }
}

#[derive(Enum, Copy, Clone, Eq, PartialEq)]
enum GraphqlEmailView {
    Inbox,
    Drafts,
    Sent,
    All,
    Starred,
    Important,
    Other,
}

impl GraphqlEmailView {
    fn as_preview_view_str(self) -> &'static str {
        match self {
            Self::Inbox => "inbox",
            Self::Drafts => "drafts",
            Self::Sent => "sent",
            Self::All => "all",
            Self::Starred => "starred",
            Self::Important => "important",
            Self::Other => "other",
        }
    }
}

/// GraphQL input mirroring `item_filters::ast::EntityFilterAst`.
#[derive(async_graphql::InputObject)]
struct GraphqlEntityFilterAst {
    document_filter: Option<GraphqlDocumentExpr>,
    project_filter: Option<GraphqlProjectExpr>,
    chat_filter: Option<GraphqlChatExpr>,
    email_filter: Option<GraphqlEmailFilterAst>,
    channel_filter: Option<GraphqlChannelExpr>,
    channel_thread_filter: Option<GraphqlChannelThreadExpr>,
    call_filter: Option<GraphqlCallExpr>,
    crm_company_filter: Option<GraphqlCrmCompanyExpr>,
    foreign_entity_filter: Option<GraphqlForeignEntityExpr>,
    properties_filter: Option<GraphqlPropertiesExpr>,
}

impl GraphqlEntityFilterAst {
    fn into_ast(self) -> async_graphql::Result<EntityFilterAst> {
        Ok(EntityFilterAst {
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
            properties_filter: optional_tree(self.properties_filter)?,
        })
    }
}

trait IntoFilterExpr<T>: Sized {
    fn into_expr(self) -> async_graphql::Result<Expr<T>>;
}

fn optional_tree<I, T>(input: Option<I>) -> async_graphql::Result<Option<Arc<Expr<T>>>>
where
    I: IntoFilterExpr<T>,
{
    input.map(|expr| expr.into_expr().map(Arc::new)).transpose()
}

fn parse_uuid(value: String, field: &str) -> async_graphql::Result<Uuid> {
    Uuid::parse_str(&value)
        .map_err(|err| async_graphql::Error::new(format!("invalid {field} UUID `{value}`: {err}")))
}

fn parse_id(id: ID, field: &str) -> async_graphql::Result<Uuid> {
    parse_uuid(id.to_string(), field)
}

fn parse_macro_user_id(
    value: String,
    field: &str,
) -> async_graphql::Result<MacroUserIdStr<'static>> {
    MacroUserIdStr::parse_from_str(&value)
        .map(CowLike::into_owned)
        .map_err(|err| async_graphql::Error::new(format!("invalid {field} `{value}`: {err}")))
}

macro_rules! filter_expr_input {
    ($name:ident, $binary_name:ident, $literal:ty, $target:ty, $type_name:literal) => {
        #[derive(async_graphql::InputObject)]
        struct $binary_name {
            left: Box<$name>,
            right: Box<$name>,
        }

        #[derive(async_graphql::OneofObject)]
        enum $name {
            And($binary_name),
            Or($binary_name),
            Not(Box<$name>),
            Literal($literal),
        }

        impl IntoFilterExpr<$target> for $name {
            fn into_expr(self) -> async_graphql::Result<Expr<$target>> {
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
    GraphqlDocumentExpr,
    GraphqlDocumentBinaryExpr,
    GraphqlDocumentLiteral,
    DocumentLiteral,
    "DocumentFilterExpr"
);
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
    GraphqlPropertiesExpr,
    GraphqlPropertiesBinaryExpr,
    GraphqlPropertiesLiteral,
    PropertiesLiteral,
    "PropertiesFilterExpr"
);

#[derive(async_graphql::InputObject)]
struct GraphqlEmailFilterAst {
    tree: Option<GraphqlEmailExpr>,
    crm_scope: Option<GraphqlCrmScope>,
}

impl GraphqlEmailFilterAst {
    fn into_ast(self) -> async_graphql::Result<EmailFilterAst> {
        Ok(EmailFilterAst {
            tree: optional_tree(self.tree)?,
            crm_scope: self.crm_scope.map(GraphqlCrmScope::into_ast).transpose()?,
        })
    }
}

#[derive(async_graphql::OneofObject)]
enum GraphqlCrmScope {
    Domains(Vec<String>),
    Addresses(Vec<String>),
}

impl GraphqlCrmScope {
    fn into_ast(self) -> async_graphql::Result<CrmScope> {
        match self {
            Self::Domains(domains) if domains.is_empty() => Err(async_graphql::Error::new(
                "CrmScope.domains cannot be empty",
            )),
            Self::Domains(domains) => Ok(CrmScope::Domains(domains)),
            Self::Addresses(addresses) if addresses.is_empty() => Err(async_graphql::Error::new(
                "CrmScope.addresses cannot be empty",
            )),
            Self::Addresses(addresses) => Ok(CrmScope::Addresses(addresses)),
        }
    }
}

#[derive(async_graphql::OneofObject)]
enum GraphqlDateLiteral {
    Gt(String),
    Lt(String),
    Gte(String),
    Lte(String),
}

impl GraphqlDateLiteral {
    fn parse(value: String) -> async_graphql::Result<DateTime<Utc>> {
        DateTime::parse_from_rfc3339(&value)
            .map(|dt| dt.with_timezone(&Utc))
            .map_err(|err| {
                async_graphql::Error::new(format!("invalid RFC3339 date `{value}`: {err}"))
            })
    }

    fn into_ast(self) -> async_graphql::Result<DateLiteral> {
        Ok(match self {
            Self::Gt(value) => DateLiteral::GreaterThan(Self::parse(value)?),
            Self::Lt(value) => DateLiteral::LessThan(Self::parse(value)?),
            Self::Gte(value) => DateLiteral::GreaterThanOrEqual(Self::parse(value)?),
            Self::Lte(value) => DateLiteral::LessThanOrEqual(Self::parse(value)?),
        })
    }
}

#[derive(async_graphql::OneofObject)]
enum GraphqlDocumentLiteral {
    FileType(String),
    Id(ID),
    ProjectId(ID),
    Owner(String),
    Importance(bool),
    NotificationDone(bool),
    NotificationSeen(bool),
    IncludeCbmAtmNc(bool),
    SubType(GraphqlDocumentSubType),
    FileAssoc(String),
    IsEmailAttachment(bool),
    CreatedAt(GraphqlDateLiteral),
    UpdatedAt(GraphqlDateLiteral),
}

impl IntoFilterExpr<DocumentLiteral> for GraphqlDocumentLiteral {
    fn into_expr(self) -> async_graphql::Result<Expr<DocumentLiteral>> {
        let literal = match self {
            Self::FileAssoc(value) => {
                let (_, file_types) = item_filters::ast::document::parse_to_file_types(&value)
                    .map_err(|err| async_graphql::Error::new(err.to_string()))?;
                return file_types
                    .map(|file_type| Expr::val(DocumentLiteral::FileType(file_type)))
                    .reduce(Expr::or)
                    .ok_or_else(|| {
                        async_graphql::Error::new("fileAssoc expansion cannot be empty")
                    });
            }
            Self::FileType(value) => {
                DocumentLiteral::FileType(FileType::from_str(&value).map_err(|err| {
                    async_graphql::Error::new(format!("invalid fileType `{value}`: {err}"))
                })?)
            }
            Self::Id(id) => DocumentLiteral::Id(parse_id(id, "id")?),
            Self::ProjectId(id) => DocumentLiteral::ProjectId(parse_id(id, "projectId")?),
            Self::Owner(owner) => DocumentLiteral::Owner(parse_macro_user_id(owner, "owner")?),
            Self::Importance(importance) => DocumentLiteral::Importance(importance),
            Self::NotificationDone(done) => DocumentLiteral::NotificationDone(done),
            Self::NotificationSeen(seen) => DocumentLiteral::NotificationSeen(seen),
            Self::IncludeCbmAtmNc(include) => DocumentLiteral::IncludeCbmAtmNc(include),
            Self::SubType(sub_type) => DocumentLiteral::SubType(sub_type.into()),
            Self::IsEmailAttachment(value) => DocumentLiteral::IsEmailAttachment(value),
            Self::CreatedAt(date) => DocumentLiteral::CreatedAt(date.into_ast()?),
            Self::UpdatedAt(date) => DocumentLiteral::UpdatedAt(date.into_ast()?),
        };
        Ok(Expr::val(literal))
    }
}

#[derive(Enum, Copy, Clone, Eq, PartialEq)]
enum GraphqlDocumentSubType {
    Task,
    Snippet,
}

impl From<GraphqlDocumentSubType> for DocumentSubType {
    fn from(value: GraphqlDocumentSubType) -> Self {
        match value {
            GraphqlDocumentSubType::Task => Self::Task,
            GraphqlDocumentSubType::Snippet => Self::Snippet,
        }
    }
}

#[derive(async_graphql::OneofObject)]
enum GraphqlProjectLiteral {
    ProjectId(ID),
    ProjectIdSelf(ID),
    Owner(String),
    Importance(bool),
    NotificationDone(bool),
    NotificationSeen(bool),
    CreatedAt(GraphqlDateLiteral),
    UpdatedAt(GraphqlDateLiteral),
}

impl IntoFilterExpr<ProjectLiteral> for GraphqlProjectLiteral {
    fn into_expr(self) -> async_graphql::Result<Expr<ProjectLiteral>> {
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

#[derive(async_graphql::OneofObject)]
enum GraphqlChatLiteral {
    ProjectId(ID),
    Role(GraphqlChatRole),
    ChatId(ID),
    Owner(String),
    Importance(bool),
    NotificationDone(bool),
    NotificationSeen(bool),
    CreatedAt(GraphqlDateLiteral),
    UpdatedAt(GraphqlDateLiteral),
}

impl IntoFilterExpr<ChatLiteral> for GraphqlChatLiteral {
    fn into_expr(self) -> async_graphql::Result<Expr<ChatLiteral>> {
        let literal = match self {
            Self::ProjectId(id) => ChatLiteral::ProjectId(parse_id(id, "projectId")?),
            Self::Role(role) => ChatLiteral::Role(role.into()),
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

#[derive(Enum, Copy, Clone, Eq, PartialEq)]
enum GraphqlChatRole {
    User,
    System,
    Assistant,
}

impl From<GraphqlChatRole> for ChatRole {
    fn from(value: GraphqlChatRole) -> Self {
        match value {
            GraphqlChatRole::User => Self::User,
            GraphqlChatRole::System => Self::System,
            GraphqlChatRole::Assistant => Self::Assistant,
        }
    }
}

#[derive(async_graphql::OneofObject)]
enum GraphqlEmailLiteral {
    Sender(GraphqlEmailValue),
    Cc(GraphqlEmailValue),
    Bcc(GraphqlEmailValue),
    Recipient(GraphqlEmailValue),
    ThreadId(ID),
    Owner(ID),
    ProjectId(String),
    Importance(bool),
    NotificationDone(bool),
    NotificationSeen(bool),
    Shared(GraphqlSharedEmailFilter),
    CalendarOnly(bool),
    CreatedAt(GraphqlDateLiteral),
    UpdatedAt(GraphqlDateLiteral),
}

impl IntoFilterExpr<EmailLiteral> for GraphqlEmailLiteral {
    fn into_expr(self) -> async_graphql::Result<Expr<EmailLiteral>> {
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
            Self::Shared(shared) => EmailLiteral::Shared(shared.into()),
            Self::CalendarOnly(calendar_only) => EmailLiteral::CalendarOnly(calendar_only),
            Self::CreatedAt(date) => EmailLiteral::CreatedAt(date.into_ast()?),
            Self::UpdatedAt(date) => EmailLiteral::UpdatedAt(date.into_ast()?),
        };
        Ok(Expr::val(literal))
    }
}

#[derive(async_graphql::OneofObject)]
enum GraphqlEmailValue {
    Partial(String),
    Complete(String),
    Domain(String),
}

impl GraphqlEmailValue {
    fn into_ast(self) -> async_graphql::Result<Email> {
        Ok(match self {
            Self::Partial(value) => Email::Partial(value),
            Self::Complete(value) => Email::Complete(
                EmailStr::parse_from_str(&value)
                    .map(CowLike::into_owned)
                    .map_err(|err| {
                        async_graphql::Error::new(format!(
                            "invalid complete email `{value}`: {err}"
                        ))
                    })?,
            ),
            Self::Domain(value) => Email::Domain(value),
        })
    }
}

#[derive(Enum, Copy, Clone, Eq, PartialEq)]
enum GraphqlSharedEmailFilter {
    Exclude,
    Include,
    Only,
}

impl From<GraphqlSharedEmailFilter> for SharedEmailFilter {
    fn from(value: GraphqlSharedEmailFilter) -> Self {
        match value {
            GraphqlSharedEmailFilter::Exclude => Self::Exclude,
            GraphqlSharedEmailFilter::Include => Self::Include,
            GraphqlSharedEmailFilter::Only => Self::Only,
        }
    }
}

#[derive(async_graphql::OneofObject)]
enum GraphqlChannelLiteral {
    ThreadId(ID),
    Mention(String),
    OrganizationId(i64),
    TeamId(ID),
    ChannelId(ID),
    Sender(String),
    ChannelType(GraphqlChannelTypeFilter),
    Importance(bool),
    NotificationDone(bool),
    NotificationSeen(bool),
}

impl IntoFilterExpr<ChannelLiteral> for GraphqlChannelLiteral {
    fn into_expr(self) -> async_graphql::Result<Expr<ChannelLiteral>> {
        let literal = match self {
            Self::ThreadId(id) => ChannelLiteral::ThreadId(parse_id(id, "threadId")?),
            Self::Mention(mention) => {
                ChannelLiteral::Mention(parse_macro_user_id(mention, "mention")?)
            }
            Self::OrganizationId(id) => ChannelLiteral::OrganizationId(id),
            Self::TeamId(id) => ChannelLiteral::TeamId(parse_id(id, "teamId")?),
            Self::ChannelId(id) => ChannelLiteral::ChannelId(parse_id(id, "channelId")?),
            Self::Sender(sender) => ChannelLiteral::Sender(parse_macro_user_id(sender, "sender")?),
            Self::ChannelType(channel_type) => ChannelLiteral::ChannelType(channel_type.into()),
            Self::Importance(importance) => ChannelLiteral::Importance(importance),
            Self::NotificationDone(done) => ChannelLiteral::NotificationDone(done),
            Self::NotificationSeen(seen) => ChannelLiteral::NotificationSeen(seen),
        };
        Ok(Expr::val(literal))
    }
}

#[derive(Enum, Copy, Clone, Eq, PartialEq)]
enum GraphqlChannelTypeFilter {
    Public,
    Private,
    DirectMessage,
    Team,
}

impl From<GraphqlChannelTypeFilter> for ChannelTypeFilter {
    fn from(value: GraphqlChannelTypeFilter) -> Self {
        match value {
            GraphqlChannelTypeFilter::Public => Self::Public,
            GraphqlChannelTypeFilter::Private => Self::Private,
            GraphqlChannelTypeFilter::DirectMessage => Self::DirectMessage,
            GraphqlChannelTypeFilter::Team => Self::Team,
        }
    }
}

#[derive(async_graphql::OneofObject)]
enum GraphqlChannelThreadLiteral {
    ThreadId(ID),
    ChannelId(ID),
    RootSender(String),
    Participant(String),
    NotificationDone(bool),
    NotificationSeen(bool),
}

impl IntoFilterExpr<ChannelThreadLiteral> for GraphqlChannelThreadLiteral {
    fn into_expr(self) -> async_graphql::Result<Expr<ChannelThreadLiteral>> {
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

#[derive(async_graphql::OneofObject)]
enum GraphqlCallLiteral {
    CallId(ID),
    ChannelId(ID),
    Speaker(String),
    Status(GraphqlCallStatus),
    Attended(bool),
}

impl IntoFilterExpr<CallLiteral> for GraphqlCallLiteral {
    fn into_expr(self) -> async_graphql::Result<Expr<CallLiteral>> {
        let literal = match self {
            Self::CallId(id) => CallLiteral::CallId(parse_id(id, "callId")?),
            Self::ChannelId(id) => CallLiteral::ChannelId(parse_id(id, "channelId")?),
            Self::Speaker(speaker) => {
                CallLiteral::Speaker(parse_macro_user_id(speaker, "speaker")?)
            }
            Self::Status(status) => CallLiteral::Status(status.into()),
            Self::Attended(attended) => CallLiteral::Attended(attended),
        };
        Ok(Expr::val(literal))
    }
}

#[derive(Enum, Copy, Clone, Eq, PartialEq)]
enum GraphqlCallStatus {
    Attended,
    Missed,
    Unattended,
}

impl From<GraphqlCallStatus> for CallStatus {
    fn from(value: GraphqlCallStatus) -> Self {
        match value {
            GraphqlCallStatus::Attended => Self::Attended,
            GraphqlCallStatus::Missed => Self::Missed,
            GraphqlCallStatus::Unattended => Self::Unattended,
        }
    }
}

#[derive(async_graphql::OneofObject)]
enum GraphqlCrmCompanyLiteral {
    Id(ID),
    Hidden(bool),
}

impl IntoFilterExpr<CrmCompanyLiteral> for GraphqlCrmCompanyLiteral {
    fn into_expr(self) -> async_graphql::Result<Expr<CrmCompanyLiteral>> {
        let literal = match self {
            Self::Id(id) => CrmCompanyLiteral::Id(parse_id(id, "id")?),
            Self::Hidden(hidden) => CrmCompanyLiteral::Hidden(hidden),
        };
        Ok(Expr::val(literal))
    }
}

#[derive(async_graphql::OneofObject)]
enum GraphqlForeignEntityLiteral {
    Id(ID),
    ForeignEntityId(String),
    ForeignEntitySource(String),
    IncludesMe(bool),
    NotificationDone(bool),
    NotificationSeen(bool),
}

impl IntoFilterExpr<ForeignEntityLiteral> for GraphqlForeignEntityLiteral {
    fn into_expr(self) -> async_graphql::Result<Expr<ForeignEntityLiteral>> {
        let literal = match self {
            Self::Id(id) => ForeignEntityLiteral::Id(parse_id(id, "id")?),
            Self::ForeignEntityId(id) => ForeignEntityLiteral::ForeignEntityId(id),
            Self::ForeignEntitySource(source) => ForeignEntityLiteral::ForeignEntitySource(source),
            Self::IncludesMe(true) => ForeignEntityLiteral::IncludesMe,
            Self::IncludesMe(false) => {
                return Err(async_graphql::Error::new(
                    "ForeignEntityLiteral.includesMe must be true",
                ));
            }
            Self::NotificationDone(done) => ForeignEntityLiteral::NotificationDone(done),
            Self::NotificationSeen(seen) => ForeignEntityLiteral::NotificationSeen(seen),
        };
        Ok(Expr::val(literal))
    }
}

#[derive(async_graphql::InputObject)]
struct GraphqlPropertiesLiteral {
    property_definition_id: ID,
    entity_type: Option<GraphqlPropertyEntityType>,
    value: GraphqlPropertyMatchValue,
}

impl IntoFilterExpr<PropertiesLiteral> for GraphqlPropertiesLiteral {
    fn into_expr(self) -> async_graphql::Result<Expr<PropertiesLiteral>> {
        Ok(Expr::val(PropertiesLiteral {
            property_definition_id: parse_id(self.property_definition_id, "propertyDefinitionId")?,
            entity_type: self.entity_type.map(Into::into),
            value: self.value.into_ast()?,
        }))
    }
}

#[derive(async_graphql::OneofObject)]
enum GraphqlPropertyMatchValue {
    SelectOption(ID),
    EntityRef(String),
}

impl GraphqlPropertyMatchValue {
    fn into_ast(self) -> async_graphql::Result<PropertyMatchValue> {
        Ok(match self {
            Self::SelectOption(id) => {
                PropertyMatchValue::SelectOption(parse_id(id, "selectOption")?)
            }
            Self::EntityRef(value) => {
                PropertyMatchValue::EntityRef(EntityRefId::new(value).map_err(|err| {
                    async_graphql::Error::new(format!("invalid entityRef: {err}"))
                })?)
            }
        })
    }
}

#[derive(Enum, Copy, Clone, Eq, PartialEq)]
enum GraphqlPropertyEntityType {
    Channel,
    Chat,
    Company,
    Document,
    Project,
    Task,
    Thread,
    User,
}

impl From<GraphqlPropertyEntityType> for PropertyEntityType {
    fn from(value: GraphqlPropertyEntityType) -> Self {
        match value {
            GraphqlPropertyEntityType::Channel => Self::Channel,
            GraphqlPropertyEntityType::Chat => Self::Chat,
            GraphqlPropertyEntityType::Company => Self::Company,
            GraphqlPropertyEntityType::Document => Self::Document,
            GraphqlPropertyEntityType::Project => Self::Project,
            GraphqlPropertyEntityType::Task => Self::Task,
            GraphqlPropertyEntityType::Thread => Self::Thread,
            GraphqlPropertyEntityType::User => Self::User,
        }
    }
}

/// GraphQL representation of supported simple Soup sorts.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
pub enum GraphqlSimpleSortMethod {
    /// Sort by most recently viewed.
    ViewedAt,
    /// Sort by creation timestamp.
    CreatedAt,
    /// Sort by update timestamp.
    UpdatedAt,
    /// Sort by viewed timestamp, falling back to updated timestamp.
    ViewedUpdated,
}

impl From<GraphqlSimpleSortMethod> for SimpleSortMethod {
    fn from(value: GraphqlSimpleSortMethod) -> Self {
        match value {
            GraphqlSimpleSortMethod::ViewedAt => SimpleSortMethod::ViewedAt,
            GraphqlSimpleSortMethod::CreatedAt => SimpleSortMethod::CreatedAt,
            GraphqlSimpleSortMethod::UpdatedAt => SimpleSortMethod::UpdatedAt,
            GraphqlSimpleSortMethod::ViewedUpdated => SimpleSortMethod::ViewedUpdated,
        }
    }
}

#[cfg(test)]
mod tests;
