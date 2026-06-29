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
            email_preview_view: Default::default(),
            link_ids: request_context.link_ids.clone(),
        })
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

fn exactly_one<'a>(type_name: &str, present: &[(&'a str, bool)]) -> async_graphql::Result<&'a str> {
    let selected: Vec<&'a str> = present
        .iter()
        .filter_map(|(name, is_present)| is_present.then_some(*name))
        .collect();
    match selected.as_slice() {
        [name] => Ok(name),
        [] => Err(async_graphql::Error::new(format!(
            "{type_name} must set exactly one field"
        ))),
        fields => Err(async_graphql::Error::new(format!(
            "{type_name} must set exactly one field, got {}",
            fields.join(", ")
        ))),
    }
}

fn fold_exprs<T>(
    type_name: &str,
    op_name: &str,
    exprs: Vec<impl IntoFilterExpr<T>>,
    fold: fn(Expr<T>, Expr<T>) -> Expr<T>,
) -> async_graphql::Result<Expr<T>> {
    exprs
        .into_iter()
        .map(IntoFilterExpr::into_expr)
        .collect::<async_graphql::Result<Vec<_>>>()?
        .into_iter()
        .reduce(fold)
        .ok_or_else(|| async_graphql::Error::new(format!("{type_name}.{op_name} cannot be empty")))
}

macro_rules! filter_expr_input {
    ($name:ident, $literal:ty, $target:ty, $type_name:literal) => {
        #[derive(async_graphql::InputObject)]
        struct $name {
            and: Option<Vec<$name>>,
            or: Option<Vec<$name>>,
            not: Option<Box<$name>>,
            literal: Option<$literal>,
        }

        impl IntoFilterExpr<$target> for $name {
            fn into_expr(self) -> async_graphql::Result<Expr<$target>> {
                let has_and = self.and.as_ref().is_some_and(|v| !v.is_empty());
                let has_or = self.or.as_ref().is_some_and(|v| !v.is_empty());
                exactly_one(
                    $type_name,
                    &[
                        ("and", has_and),
                        ("or", has_or),
                        ("not", self.not.is_some()),
                        ("literal", self.literal.is_some()),
                    ],
                )?;

                if has_and {
                    return fold_exprs($type_name, "and", self.and.unwrap_or_default(), Expr::and);
                }
                if has_or {
                    return fold_exprs($type_name, "or", self.or.unwrap_or_default(), Expr::or);
                }
                if let Some(not) = self.not {
                    return not.into_expr().map(Expr::is_not);
                }
                self.literal
                    .expect("literal presence checked above")
                    .into_expr()
            }
        }
    };
}

filter_expr_input!(
    GraphqlDocumentExpr,
    GraphqlDocumentLiteral,
    DocumentLiteral,
    "DocumentFilterExpr"
);
filter_expr_input!(
    GraphqlProjectExpr,
    GraphqlProjectLiteral,
    ProjectLiteral,
    "ProjectFilterExpr"
);
filter_expr_input!(
    GraphqlChatExpr,
    GraphqlChatLiteral,
    ChatLiteral,
    "ChatFilterExpr"
);
filter_expr_input!(
    GraphqlEmailExpr,
    GraphqlEmailLiteral,
    EmailLiteral,
    "EmailFilterExpr"
);
filter_expr_input!(
    GraphqlChannelExpr,
    GraphqlChannelLiteral,
    ChannelLiteral,
    "ChannelFilterExpr"
);
filter_expr_input!(
    GraphqlChannelThreadExpr,
    GraphqlChannelThreadLiteral,
    ChannelThreadLiteral,
    "ChannelThreadFilterExpr"
);
filter_expr_input!(
    GraphqlCallExpr,
    GraphqlCallLiteral,
    CallLiteral,
    "CallFilterExpr"
);
filter_expr_input!(
    GraphqlCrmCompanyExpr,
    GraphqlCrmCompanyLiteral,
    CrmCompanyLiteral,
    "CrmCompanyFilterExpr"
);
filter_expr_input!(
    GraphqlForeignEntityExpr,
    GraphqlForeignEntityLiteral,
    ForeignEntityLiteral,
    "ForeignEntityFilterExpr"
);
filter_expr_input!(
    GraphqlPropertiesExpr,
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

#[derive(async_graphql::InputObject)]
struct GraphqlCrmScope {
    domains: Option<Vec<String>>,
    addresses: Option<Vec<String>>,
}

impl GraphqlCrmScope {
    fn into_ast(self) -> async_graphql::Result<CrmScope> {
        let domains = self.domains.unwrap_or_default();
        let addresses = self.addresses.unwrap_or_default();
        match (domains.is_empty(), addresses.is_empty()) {
            (false, true) => Ok(CrmScope::Domains(domains)),
            (true, false) => Ok(CrmScope::Addresses(addresses)),
            (true, true) => Err(async_graphql::Error::new(
                "CrmScope requires non-empty domains or addresses",
            )),
            (false, false) => Err(async_graphql::Error::new(
                "CrmScope domains and addresses are mutually exclusive",
            )),
        }
    }
}

#[derive(async_graphql::InputObject)]
struct GraphqlDateLiteral {
    gt: Option<String>,
    lt: Option<String>,
    gte: Option<String>,
    lte: Option<String>,
}

impl GraphqlDateLiteral {
    fn into_ast(self) -> async_graphql::Result<DateLiteral> {
        let field = exactly_one(
            "DateLiteral",
            &[
                ("gt", self.gt.is_some()),
                ("lt", self.lt.is_some()),
                ("gte", self.gte.is_some()),
                ("lte", self.lte.is_some()),
            ],
        )?;
        let value = match field {
            "gt" => self.gt,
            "lt" => self.lt,
            "gte" => self.gte,
            "lte" => self.lte,
            _ => unreachable!(),
        }
        .expect("date field presence checked above");
        let parsed = DateTime::parse_from_rfc3339(&value)
            .map(|dt| dt.with_timezone(&Utc))
            .map_err(|err| {
                async_graphql::Error::new(format!("invalid RFC3339 date `{value}`: {err}"))
            })?;
        Ok(match field {
            "gt" => DateLiteral::GreaterThan(parsed),
            "lt" => DateLiteral::LessThan(parsed),
            "gte" => DateLiteral::GreaterThanOrEqual(parsed),
            "lte" => DateLiteral::LessThanOrEqual(parsed),
            _ => unreachable!(),
        })
    }
}

#[derive(async_graphql::InputObject)]
struct GraphqlDocumentLiteral {
    file_type: Option<String>,
    id: Option<ID>,
    project_id: Option<ID>,
    owner: Option<String>,
    importance: Option<bool>,
    notification_done: Option<bool>,
    notification_seen: Option<bool>,
    include_cbm_atm_nc: Option<bool>,
    sub_type: Option<GraphqlDocumentSubType>,
    is_email_attachment: Option<bool>,
    created_at: Option<GraphqlDateLiteral>,
    updated_at: Option<GraphqlDateLiteral>,
}

impl IntoFilterExpr<DocumentLiteral> for GraphqlDocumentLiteral {
    fn into_expr(self) -> async_graphql::Result<Expr<DocumentLiteral>> {
        let field = exactly_one(
            "DocumentLiteral",
            &[
                ("fileType", self.file_type.is_some()),
                ("id", self.id.is_some()),
                ("projectId", self.project_id.is_some()),
                ("owner", self.owner.is_some()),
                ("importance", self.importance.is_some()),
                ("notificationDone", self.notification_done.is_some()),
                ("notificationSeen", self.notification_seen.is_some()),
                ("includeCbmAtmNc", self.include_cbm_atm_nc.is_some()),
                ("subType", self.sub_type.is_some()),
                ("isEmailAttachment", self.is_email_attachment.is_some()),
                ("createdAt", self.created_at.is_some()),
                ("updatedAt", self.updated_at.is_some()),
            ],
        )?;
        let literal = match field {
            "fileType" => {
                let value = self.file_type.expect("field checked");
                DocumentLiteral::FileType(FileType::from_str(&value).map_err(|err| {
                    async_graphql::Error::new(format!("invalid fileType `{value}`: {err}"))
                })?)
            }
            "id" => DocumentLiteral::Id(parse_id(self.id.expect("field checked"), "id")?),
            "projectId" => DocumentLiteral::ProjectId(parse_id(
                self.project_id.expect("field checked"),
                "projectId",
            )?),
            "owner" => DocumentLiteral::Owner(parse_macro_user_id(
                self.owner.expect("field checked"),
                "owner",
            )?),
            "importance" => DocumentLiteral::Importance(self.importance.expect("field checked")),
            "notificationDone" => {
                DocumentLiteral::NotificationDone(self.notification_done.expect("field checked"))
            }
            "notificationSeen" => {
                DocumentLiteral::NotificationSeen(self.notification_seen.expect("field checked"))
            }
            "includeCbmAtmNc" => {
                DocumentLiteral::IncludeCbmAtmNc(self.include_cbm_atm_nc.expect("field checked"))
            }
            "subType" => DocumentLiteral::SubType(self.sub_type.expect("field checked").into()),
            "isEmailAttachment" => {
                DocumentLiteral::IsEmailAttachment(self.is_email_attachment.expect("field checked"))
            }
            "createdAt" => {
                DocumentLiteral::CreatedAt(self.created_at.expect("field checked").into_ast()?)
            }
            "updatedAt" => {
                DocumentLiteral::UpdatedAt(self.updated_at.expect("field checked").into_ast()?)
            }
            _ => unreachable!(),
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

#[derive(async_graphql::InputObject)]
struct GraphqlProjectLiteral {
    project_id: Option<ID>,
    project_id_self: Option<ID>,
    owner: Option<String>,
    importance: Option<bool>,
    notification_done: Option<bool>,
    notification_seen: Option<bool>,
    created_at: Option<GraphqlDateLiteral>,
    updated_at: Option<GraphqlDateLiteral>,
}

impl IntoFilterExpr<ProjectLiteral> for GraphqlProjectLiteral {
    fn into_expr(self) -> async_graphql::Result<Expr<ProjectLiteral>> {
        let field = exactly_one(
            "ProjectLiteral",
            &[
                ("projectId", self.project_id.is_some()),
                ("projectIdSelf", self.project_id_self.is_some()),
                ("owner", self.owner.is_some()),
                ("importance", self.importance.is_some()),
                ("notificationDone", self.notification_done.is_some()),
                ("notificationSeen", self.notification_seen.is_some()),
                ("createdAt", self.created_at.is_some()),
                ("updatedAt", self.updated_at.is_some()),
            ],
        )?;
        let literal = match field {
            "projectId" => ProjectLiteral::ProjectId(parse_id(
                self.project_id.expect("field checked"),
                "projectId",
            )?),
            "projectIdSelf" => ProjectLiteral::ProjectIdSelf(parse_id(
                self.project_id_self.expect("field checked"),
                "projectIdSelf",
            )?),
            "owner" => ProjectLiteral::Owner(parse_macro_user_id(
                self.owner.expect("field checked"),
                "owner",
            )?),
            "importance" => ProjectLiteral::Importance(self.importance.expect("field checked")),
            "notificationDone" => {
                ProjectLiteral::NotificationDone(self.notification_done.expect("field checked"))
            }
            "notificationSeen" => {
                ProjectLiteral::NotificationSeen(self.notification_seen.expect("field checked"))
            }
            "createdAt" => {
                ProjectLiteral::CreatedAt(self.created_at.expect("field checked").into_ast()?)
            }
            "updatedAt" => {
                ProjectLiteral::UpdatedAt(self.updated_at.expect("field checked").into_ast()?)
            }
            _ => unreachable!(),
        };
        Ok(Expr::val(literal))
    }
}

#[derive(async_graphql::InputObject)]
struct GraphqlChatLiteral {
    project_id: Option<ID>,
    role: Option<GraphqlChatRole>,
    chat_id: Option<ID>,
    owner: Option<String>,
    importance: Option<bool>,
    notification_done: Option<bool>,
    notification_seen: Option<bool>,
    created_at: Option<GraphqlDateLiteral>,
    updated_at: Option<GraphqlDateLiteral>,
}

impl IntoFilterExpr<ChatLiteral> for GraphqlChatLiteral {
    fn into_expr(self) -> async_graphql::Result<Expr<ChatLiteral>> {
        let field = exactly_one(
            "ChatLiteral",
            &[
                ("projectId", self.project_id.is_some()),
                ("role", self.role.is_some()),
                ("chatId", self.chat_id.is_some()),
                ("owner", self.owner.is_some()),
                ("importance", self.importance.is_some()),
                ("notificationDone", self.notification_done.is_some()),
                ("notificationSeen", self.notification_seen.is_some()),
                ("createdAt", self.created_at.is_some()),
                ("updatedAt", self.updated_at.is_some()),
            ],
        )?;
        let literal = match field {
            "projectId" => ChatLiteral::ProjectId(parse_id(
                self.project_id.expect("field checked"),
                "projectId",
            )?),
            "role" => ChatLiteral::Role(self.role.expect("field checked").into()),
            "chatId" => {
                ChatLiteral::ChatId(parse_id(self.chat_id.expect("field checked"), "chatId")?)
            }
            "owner" => ChatLiteral::Owner(parse_macro_user_id(
                self.owner.expect("field checked"),
                "owner",
            )?),
            "importance" => ChatLiteral::Importance(self.importance.expect("field checked")),
            "notificationDone" => {
                ChatLiteral::NotificationDone(self.notification_done.expect("field checked"))
            }
            "notificationSeen" => {
                ChatLiteral::NotificationSeen(self.notification_seen.expect("field checked"))
            }
            "createdAt" => {
                ChatLiteral::CreatedAt(self.created_at.expect("field checked").into_ast()?)
            }
            "updatedAt" => {
                ChatLiteral::UpdatedAt(self.updated_at.expect("field checked").into_ast()?)
            }
            _ => unreachable!(),
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

#[derive(async_graphql::InputObject)]
struct GraphqlEmailLiteral {
    sender: Option<GraphqlEmailValue>,
    cc: Option<GraphqlEmailValue>,
    bcc: Option<GraphqlEmailValue>,
    recipient: Option<GraphqlEmailValue>,
    thread_id: Option<ID>,
    owner: Option<ID>,
    project_id: Option<String>,
    importance: Option<bool>,
    notification_done: Option<bool>,
    notification_seen: Option<bool>,
    shared: Option<GraphqlSharedEmailFilter>,
    calendar_only: Option<bool>,
    created_at: Option<GraphqlDateLiteral>,
    updated_at: Option<GraphqlDateLiteral>,
}

impl IntoFilterExpr<EmailLiteral> for GraphqlEmailLiteral {
    fn into_expr(self) -> async_graphql::Result<Expr<EmailLiteral>> {
        let field = exactly_one(
            "EmailLiteral",
            &[
                ("sender", self.sender.is_some()),
                ("cc", self.cc.is_some()),
                ("bcc", self.bcc.is_some()),
                ("recipient", self.recipient.is_some()),
                ("threadId", self.thread_id.is_some()),
                ("owner", self.owner.is_some()),
                ("projectId", self.project_id.is_some()),
                ("importance", self.importance.is_some()),
                ("notificationDone", self.notification_done.is_some()),
                ("notificationSeen", self.notification_seen.is_some()),
                ("shared", self.shared.is_some()),
                ("calendarOnly", self.calendar_only.is_some()),
                ("createdAt", self.created_at.is_some()),
                ("updatedAt", self.updated_at.is_some()),
            ],
        )?;
        let literal = match field {
            "sender" => EmailLiteral::Sender(self.sender.expect("field checked").into_ast()?),
            "cc" => EmailLiteral::Cc(self.cc.expect("field checked").into_ast()?),
            "bcc" => EmailLiteral::Bcc(self.bcc.expect("field checked").into_ast()?),
            "recipient" => {
                EmailLiteral::Recipient(self.recipient.expect("field checked").into_ast()?)
            }
            "threadId" => EmailLiteral::ThreadId(parse_id(
                self.thread_id.expect("field checked"),
                "threadId",
            )?),
            "owner" => EmailLiteral::Owner(parse_id(self.owner.expect("field checked"), "owner")?),
            "projectId" => EmailLiteral::ProjectId(self.project_id.expect("field checked")),
            "importance" => EmailLiteral::Importance(self.importance.expect("field checked")),
            "notificationDone" => {
                EmailLiteral::NotificationDone(self.notification_done.expect("field checked"))
            }
            "notificationSeen" => {
                EmailLiteral::NotificationSeen(self.notification_seen.expect("field checked"))
            }
            "shared" => EmailLiteral::Shared(self.shared.expect("field checked").into()),
            "calendarOnly" => {
                EmailLiteral::CalendarOnly(self.calendar_only.expect("field checked"))
            }
            "createdAt" => {
                EmailLiteral::CreatedAt(self.created_at.expect("field checked").into_ast()?)
            }
            "updatedAt" => {
                EmailLiteral::UpdatedAt(self.updated_at.expect("field checked").into_ast()?)
            }
            _ => unreachable!(),
        };
        Ok(Expr::val(literal))
    }
}

#[derive(async_graphql::InputObject)]
struct GraphqlEmailValue {
    partial: Option<String>,
    complete: Option<String>,
    domain: Option<String>,
}

impl GraphqlEmailValue {
    fn into_ast(self) -> async_graphql::Result<Email> {
        let field = exactly_one(
            "EmailValue",
            &[
                ("partial", self.partial.is_some()),
                ("complete", self.complete.is_some()),
                ("domain", self.domain.is_some()),
            ],
        )?;
        Ok(match field {
            "partial" => Email::Partial(self.partial.expect("field checked")),
            "complete" => {
                let value = self.complete.expect("field checked");
                Email::Complete(
                    EmailStr::parse_from_str(&value)
                        .map(CowLike::into_owned)
                        .map_err(|err| {
                            async_graphql::Error::new(format!(
                                "invalid complete email `{value}`: {err}"
                            ))
                        })?,
                )
            }
            "domain" => Email::Domain(self.domain.expect("field checked")),
            _ => unreachable!(),
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

#[derive(async_graphql::InputObject)]
struct GraphqlChannelLiteral {
    thread_id: Option<ID>,
    mention: Option<String>,
    organization_id: Option<i64>,
    team_id: Option<ID>,
    channel_id: Option<ID>,
    sender: Option<String>,
    channel_type: Option<GraphqlChannelTypeFilter>,
    importance: Option<bool>,
    notification_done: Option<bool>,
    notification_seen: Option<bool>,
}

impl IntoFilterExpr<ChannelLiteral> for GraphqlChannelLiteral {
    fn into_expr(self) -> async_graphql::Result<Expr<ChannelLiteral>> {
        let field = exactly_one(
            "ChannelLiteral",
            &[
                ("threadId", self.thread_id.is_some()),
                ("mention", self.mention.is_some()),
                ("organizationId", self.organization_id.is_some()),
                ("teamId", self.team_id.is_some()),
                ("channelId", self.channel_id.is_some()),
                ("sender", self.sender.is_some()),
                ("channelType", self.channel_type.is_some()),
                ("importance", self.importance.is_some()),
                ("notificationDone", self.notification_done.is_some()),
                ("notificationSeen", self.notification_seen.is_some()),
            ],
        )?;
        let literal = match field {
            "threadId" => ChannelLiteral::ThreadId(parse_id(
                self.thread_id.expect("field checked"),
                "threadId",
            )?),
            "mention" => ChannelLiteral::Mention(parse_macro_user_id(
                self.mention.expect("field checked"),
                "mention",
            )?),
            "organizationId" => {
                ChannelLiteral::OrganizationId(self.organization_id.expect("field checked"))
            }
            "teamId" => {
                ChannelLiteral::TeamId(parse_id(self.team_id.expect("field checked"), "teamId")?)
            }
            "channelId" => ChannelLiteral::ChannelId(parse_id(
                self.channel_id.expect("field checked"),
                "channelId",
            )?),
            "sender" => ChannelLiteral::Sender(parse_macro_user_id(
                self.sender.expect("field checked"),
                "sender",
            )?),
            "channelType" => {
                ChannelLiteral::ChannelType(self.channel_type.expect("field checked").into())
            }
            "importance" => ChannelLiteral::Importance(self.importance.expect("field checked")),
            "notificationDone" => {
                ChannelLiteral::NotificationDone(self.notification_done.expect("field checked"))
            }
            "notificationSeen" => {
                ChannelLiteral::NotificationSeen(self.notification_seen.expect("field checked"))
            }
            _ => unreachable!(),
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

#[derive(async_graphql::InputObject)]
struct GraphqlChannelThreadLiteral {
    thread_id: Option<ID>,
    channel_id: Option<ID>,
    root_sender: Option<String>,
    notification_done: Option<bool>,
    notification_seen: Option<bool>,
}

impl IntoFilterExpr<ChannelThreadLiteral> for GraphqlChannelThreadLiteral {
    fn into_expr(self) -> async_graphql::Result<Expr<ChannelThreadLiteral>> {
        let field = exactly_one(
            "ChannelThreadLiteral",
            &[
                ("threadId", self.thread_id.is_some()),
                ("channelId", self.channel_id.is_some()),
                ("rootSender", self.root_sender.is_some()),
                ("notificationDone", self.notification_done.is_some()),
                ("notificationSeen", self.notification_seen.is_some()),
            ],
        )?;
        let literal = match field {
            "threadId" => ChannelThreadLiteral::ThreadId(parse_id(
                self.thread_id.expect("field checked"),
                "threadId",
            )?),
            "channelId" => ChannelThreadLiteral::ChannelId(parse_id(
                self.channel_id.expect("field checked"),
                "channelId",
            )?),
            "rootSender" => ChannelThreadLiteral::RootSender(parse_macro_user_id(
                self.root_sender.expect("field checked"),
                "rootSender",
            )?),
            "notificationDone" => ChannelThreadLiteral::NotificationDone(
                self.notification_done.expect("field checked"),
            ),
            "notificationSeen" => ChannelThreadLiteral::NotificationSeen(
                self.notification_seen.expect("field checked"),
            ),
            _ => unreachable!(),
        };
        Ok(Expr::val(literal))
    }
}

#[derive(async_graphql::InputObject)]
struct GraphqlCallLiteral {
    call_id: Option<ID>,
    channel_id: Option<ID>,
    speaker: Option<String>,
    status: Option<GraphqlCallStatus>,
    attended: Option<bool>,
}

impl IntoFilterExpr<CallLiteral> for GraphqlCallLiteral {
    fn into_expr(self) -> async_graphql::Result<Expr<CallLiteral>> {
        let field = exactly_one(
            "CallLiteral",
            &[
                ("callId", self.call_id.is_some()),
                ("channelId", self.channel_id.is_some()),
                ("speaker", self.speaker.is_some()),
                ("status", self.status.is_some()),
                ("attended", self.attended.is_some()),
            ],
        )?;
        let literal = match field {
            "callId" => {
                CallLiteral::CallId(parse_id(self.call_id.expect("field checked"), "callId")?)
            }
            "channelId" => CallLiteral::ChannelId(parse_id(
                self.channel_id.expect("field checked"),
                "channelId",
            )?),
            "speaker" => CallLiteral::Speaker(parse_macro_user_id(
                self.speaker.expect("field checked"),
                "speaker",
            )?),
            "status" => CallLiteral::Status(self.status.expect("field checked").into()),
            "attended" => CallLiteral::Attended(self.attended.expect("field checked")),
            _ => unreachable!(),
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

#[derive(async_graphql::InputObject)]
struct GraphqlCrmCompanyLiteral {
    id: Option<ID>,
    hidden: Option<bool>,
}

impl IntoFilterExpr<CrmCompanyLiteral> for GraphqlCrmCompanyLiteral {
    fn into_expr(self) -> async_graphql::Result<Expr<CrmCompanyLiteral>> {
        let field = exactly_one(
            "CrmCompanyLiteral",
            &[("id", self.id.is_some()), ("hidden", self.hidden.is_some())],
        )?;
        let literal = match field {
            "id" => CrmCompanyLiteral::Id(parse_id(self.id.expect("field checked"), "id")?),
            "hidden" => CrmCompanyLiteral::Hidden(self.hidden.expect("field checked")),
            _ => unreachable!(),
        };
        Ok(Expr::val(literal))
    }
}

#[derive(async_graphql::InputObject)]
struct GraphqlForeignEntityLiteral {
    id: Option<ID>,
    foreign_entity_id: Option<String>,
    foreign_entity_source: Option<String>,
    includes_me: Option<bool>,
    notification_done: Option<bool>,
    notification_seen: Option<bool>,
}

impl IntoFilterExpr<ForeignEntityLiteral> for GraphqlForeignEntityLiteral {
    fn into_expr(self) -> async_graphql::Result<Expr<ForeignEntityLiteral>> {
        let field = exactly_one(
            "ForeignEntityLiteral",
            &[
                ("id", self.id.is_some()),
                ("foreignEntityId", self.foreign_entity_id.is_some()),
                ("foreignEntitySource", self.foreign_entity_source.is_some()),
                ("includesMe", self.includes_me.is_some()),
                ("notificationDone", self.notification_done.is_some()),
                ("notificationSeen", self.notification_seen.is_some()),
            ],
        )?;
        let literal = match field {
            "id" => ForeignEntityLiteral::Id(parse_id(self.id.expect("field checked"), "id")?),
            "foreignEntityId" => ForeignEntityLiteral::ForeignEntityId(
                self.foreign_entity_id.expect("field checked"),
            ),
            "foreignEntitySource" => ForeignEntityLiteral::ForeignEntitySource(
                self.foreign_entity_source.expect("field checked"),
            ),
            "includesMe" => {
                if !self.includes_me.expect("field checked") {
                    return Err(async_graphql::Error::new(
                        "ForeignEntityLiteral.includesMe must be true",
                    ));
                }
                ForeignEntityLiteral::IncludesMe
            }
            "notificationDone" => ForeignEntityLiteral::NotificationDone(
                self.notification_done.expect("field checked"),
            ),
            "notificationSeen" => ForeignEntityLiteral::NotificationSeen(
                self.notification_seen.expect("field checked"),
            ),
            _ => unreachable!(),
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

#[derive(async_graphql::InputObject)]
struct GraphqlPropertyMatchValue {
    select_option: Option<ID>,
    entity_ref: Option<String>,
}

impl GraphqlPropertyMatchValue {
    fn into_ast(self) -> async_graphql::Result<PropertyMatchValue> {
        let field = exactly_one(
            "PropertyMatchValue",
            &[
                ("selectOption", self.select_option.is_some()),
                ("entityRef", self.entity_ref.is_some()),
            ],
        )?;
        Ok(match field {
            "selectOption" => PropertyMatchValue::SelectOption(parse_id(
                self.select_option.expect("field checked"),
                "selectOption",
            )?),
            "entityRef" => {
                let value = self.entity_ref.expect("field checked");
                PropertyMatchValue::EntityRef(EntityRefId::new(value).map_err(|err| {
                    async_graphql::Error::new(format!("invalid entityRef: {err}"))
                })?)
            }
            _ => unreachable!(),
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
