use std::str::FromStr;

use async_graphql::{Enum, ID};
use chrono::{DateTime, Utc};
use document_sub_type::DocumentSubType;
use filter_ast::Expr;
use graphql_common::{
    GraphqlPropertiesExpr, GraphqlPropertyEntityType, IntoFilterExpr, filter_expr_input,
    optional_tree, parse_id, parse_macro_user_id,
};
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
        properties::PropertyEntityType,
    },
};
use macro_user_id::{cowlike::CowLike, email::EmailStr, user_id::MacroUserIdStr};
use model_file_type::FileType;
use models_grouping::{GroupByField, GroupingConfig};
use models_pagination::{Base64Str, CursorWithValAndFilter, Query, SimpleSortMethod};
use soup::domain::models::{GroupedSortRequest, SoupQuery, SoupRequest, SoupType};
use uuid::Uuid;

/// Input for `Query.soup`.
#[derive(async_graphql::OneofObject)]
pub enum SoupInput {
    /// Start a new Soup query.
    Initial(Box<SoupInitialInput>),
    /// Continue a Soup query from an opaque cursor.
    Continuation(SoupContinuationInput),
}

/// Input for starting a Soup query.
#[derive(async_graphql::InputObject)]
pub struct SoupInitialInput {
    /// Maximum number of items to return. Defaults to 20, max 500.
    limit: Option<u16>,
    /// Whether to return expanded Soup items. Defaults to true.
    expand: Option<bool>,
    /// Simple timestamp sort. Defaults to VIEWED_AT. Frecency is intentionally
    /// not supported by this initial GraphQL adapter.
    sort_method: Option<GraphqlSimpleSortMethod>,
    /// Email preview view used when hydrating email Soup items.
    email_view: Option<GraphqlEmailView>,
    /// AST-shaped filters applied to each Soup entity type.
    filters: Option<GraphqlEntityFilterAst>,
}

/// Input for continuing a Soup query.
#[derive(async_graphql::InputObject)]
pub struct SoupContinuationInput {
    /// Opaque cursor returned by a previous GraphQL Soup response.
    cursor: String,
    /// Whether to return expanded Soup items. Defaults to true.
    expand: Option<bool>,
    /// Email preview view used when hydrating email Soup items.
    email_view: Option<GraphqlEmailView>,
}

/// Input for `Query.groupSoup`.
#[derive(async_graphql::OneofObject)]
pub enum GroupedSoupInput {
    /// Start a new grouped Soup query.
    Initial(Box<GroupedSoupInitialInput>),
    /// Continue one bin from a cursor returned by a previous grouped query.
    Continuation(GroupedSoupContinuationInput),
}

/// Input for starting a grouped Soup query.
#[derive(async_graphql::InputObject)]
pub struct GroupedSoupInitialInput {
    /// The field used to divide Soup items into bins.
    group_by: GraphqlGroupByInput,
    /// Maximum number of items to return per bin. Defaults to 20, max 500.
    limit: Option<u16>,
    /// Sort order within each bin. Defaults to `VIEWED_UPDATED`.
    sort_method: Option<GraphqlSimpleSortMethod>,
    /// AST-shaped filters applied to each Soup entity type.
    filters: Option<GraphqlEntityFilterAst>,
}

/// Input for continuing a single grouped Soup bin.
#[derive(async_graphql::InputObject)]
pub struct GroupedSoupContinuationInput {
    /// The field used to divide Soup items into bins.
    group_by: GraphqlGroupByInput,
    /// The grouping key of the bin to continue.
    group_key: String,
    /// Opaque cursor returned for the bin by a previous grouped query.
    cursor: String,
}

impl GroupedSoupInput {
    /// Convert this value into the grouped Soup domain request.
    pub(crate) fn into_request(
        self,
        macro_user_id: MacroUserIdStr<'static>,
    ) -> async_graphql::Result<GroupedSortRequest<'static>> {
        match self {
            Self::Initial(input) => input.into_request(macro_user_id),
            Self::Continuation(input) => input.into_request(macro_user_id),
        }
    }
}

impl GroupedSoupInitialInput {
    /// Convert an initial input into the grouped Soup domain request.
    fn into_request(
        self,
        macro_user_id: MacroUserIdStr<'static>,
    ) -> async_graphql::Result<GroupedSortRequest<'static>> {
        let filters = self
            .filters
            .map(GraphqlEntityFilterAst::into_ast)
            .transpose()?
            .unwrap_or_default();
        let sort_method = self
            .sort_method
            .map(SimpleSortMethod::from)
            .unwrap_or(SimpleSortMethod::ViewedUpdated);
        let limit = self.limit.unwrap_or(20).min(500);

        Ok(GroupedSortRequest {
            limit,
            cursor: Query::Sort(sort_method, filters),
            user_id: macro_user_id,
            grouping: GroupingConfig {
                field: self.group_by.into_group_by_field()?,
                group_key: None,
                per_group_limit: Some(u32::from(limit)),
            },
        })
    }
}

impl GroupedSoupContinuationInput {
    /// Decode a bin cursor into the grouped Soup domain request.
    fn into_request(
        self,
        macro_user_id: MacroUserIdStr<'static>,
    ) -> async_graphql::Result<GroupedSortRequest<'static>> {
        let cursor = Base64Str::<
            CursorWithValAndFilter<Uuid, SimpleSortMethod, EntityFilterAst>,
        >::new_from_string(self.cursor)
        .decode_json()
        .map_err(|err| async_graphql::Error::new(format!("invalid cursor: {err}")))?;
        let limit = u16::try_from(cursor.limit).unwrap_or(500).min(500);

        Ok(GroupedSortRequest {
            limit,
            cursor: Query::Cursor(cursor),
            user_id: macro_user_id,
            grouping: GroupingConfig {
                field: self.group_by.into_group_by_field()?,
                group_key: Some(self.group_key),
                per_group_limit: None,
            },
        })
    }
}

/// GraphQL representation of a field used to group Soup items.
#[derive(async_graphql::InputObject)]
struct GraphqlGroupByInput {
    /// The kind of grouping to perform.
    field: GraphqlGroupByField,
    /// Property definition to group by when `field` is `PROPERTY`.
    property_definition_id: Option<ID>,
    /// Optional property entity type restriction.
    entity_type: Option<GraphqlPropertyEntityType>,
}

impl GraphqlGroupByInput {
    /// Convert this input into the grouping domain model.
    fn into_group_by_field(self) -> async_graphql::Result<GroupByField> {
        match self.field {
            GraphqlGroupByField::Date => self.without_property_options(GroupByField::Date),
            GraphqlGroupByField::EntityType => {
                self.without_property_options(GroupByField::EntityType)
            }
            GraphqlGroupByField::Project => self.without_property_options(GroupByField::Project),
            GraphqlGroupByField::Property => {
                let property_definition_id = self.property_definition_id.ok_or_else(|| {
                    async_graphql::Error::new(
                        "propertyDefinitionId is required when grouping by PROPERTY",
                    )
                })?;
                let property_definition_id =
                    parse_id(property_definition_id, "propertyDefinitionId")?;
                let entity_type = self
                    .entity_type
                    .map(PropertyEntityType::try_from)
                    .transpose()
                    .map_err(|_| {
                        async_graphql::Error::new(
                            "CALL_RECORD is not supported for property grouping",
                        )
                    })?
                    .map(|entity_type| entity_type.to_string());

                Ok(GroupByField::Property {
                    property_definition_id,
                    entity_type,
                })
            }
        }
    }

    /// Reject property-only options for non-property grouping modes.
    fn without_property_options(
        self,
        group_by: GroupByField,
    ) -> async_graphql::Result<GroupByField> {
        if self.property_definition_id.is_some() || self.entity_type.is_some() {
            return Err(async_graphql::Error::new(
                "propertyDefinitionId and entityType require PROPERTY grouping",
            ));
        }
        Ok(group_by)
    }
}

/// Grouping modes supported by grouped Soup.
#[derive(async_graphql::Enum, Copy, Clone, Eq, PartialEq)]
enum GraphqlGroupByField {
    /// Group into date buckets.
    Date,
    /// Group by Soup entity type.
    EntityType,
    /// Group by containing project.
    Project,
    /// Group by a property value.
    Property,
}

impl SoupInput {
    /// Convert this value into the request representation.
    pub(crate) fn into_request(
        self,
        macro_user_id: MacroUserIdStr<'static>,
        link_ids: Vec<Uuid>,
    ) -> async_graphql::Result<SoupRequest<EntityFilterAst>> {
        match self {
            Self::Initial(input) => input.into_request(macro_user_id, link_ids),
            Self::Continuation(input) => input.into_request(macro_user_id, link_ids),
        }
    }
}

impl SoupInitialInput {
    /// Convert an initial input into the request representation.
    fn into_request(
        self,
        macro_user_id: MacroUserIdStr<'static>,
        link_ids: Vec<Uuid>,
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

        Ok(SoupRequest {
            soup_type: soup_type(self.expand),
            limit: self.limit.unwrap_or(20).min(500),
            cursor: SoupQuery::new_sort_simple(sort, filter),
            user: macro_user_id,
            email_preview_view: email_preview_view(self.email_view)?,
            link_ids,
        })
    }
}

impl SoupContinuationInput {
    /// Decode a cursor continuation into the request representation.
    fn into_request(
        self,
        macro_user_id: MacroUserIdStr<'static>,
        link_ids: Vec<Uuid>,
    ) -> async_graphql::Result<SoupRequest<EntityFilterAst>> {
        let cursor = Base64Str::<
            CursorWithValAndFilter<Uuid, SimpleSortMethod, EntityFilterAst>,
        >::new_from_string(self.cursor)
        .decode_json()
        .map_err(|err| async_graphql::Error::new(format!("invalid cursor: {err}")))?;
        let limit = u16::try_from(cursor.limit).unwrap_or(500).min(500);

        Ok(SoupRequest {
            soup_type: soup_type(self.expand),
            limit,
            cursor: SoupQuery::new_cursor_simple(cursor),
            user: macro_user_id,
            email_preview_view: email_preview_view(self.email_view)?,
            link_ids,
        })
    }
}

/// Convert the optional GraphQL expansion flag into the domain representation.
fn soup_type(expand: Option<bool>) -> SoupType {
    match expand {
        Some(false) => SoupType::UnExpanded,
        Some(true) | None => SoupType::Expanded,
    }
}

/// Convert the optional GraphQL email view into the domain representation.
fn email_preview_view(
    email_view: Option<GraphqlEmailView>,
) -> async_graphql::Result<email::domain::models::PreviewView> {
    email_view
        .map(GraphqlEmailView::as_preview_view_str)
        .unwrap_or("inbox")
        .parse()
        .map_err(async_graphql::Error::new)
}

/// GraphQL input representing the email view.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
enum GraphqlEmailView {
    /// The inbox option.
    Inbox,
    /// The drafts option.
    Drafts,
    /// The sent option.
    Sent,
    /// The all option.
    All,
    /// The starred option.
    Starred,
    /// The important option.
    Important,
    /// The other option.
    Other,
}

impl GraphqlEmailView {
    /// Return the corresponding email preview view name.
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
    /// The properties filter to apply.
    properties_filter: Option<GraphqlPropertiesExpr>,
}

impl GraphqlEntityFilterAst {
    /// Convert this value into the ast representation.
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
/// GraphQL input representing the email filter ast.
#[derive(async_graphql::InputObject)]
struct GraphqlEmailFilterAst {
    /// The tree.
    tree: Option<GraphqlEmailExpr>,
    /// The crm scope.
    crm_scope: Option<GraphqlCrmScope>,
}

impl GraphqlEmailFilterAst {
    /// Convert this value into the ast representation.
    fn into_ast(self) -> async_graphql::Result<EmailFilterAst> {
        Ok(EmailFilterAst {
            tree: optional_tree(self.tree)?,
            crm_scope: self.crm_scope.map(GraphqlCrmScope::into_ast).transpose()?,
        })
    }
}

/// GraphQL input representing the crm scope.
#[derive(async_graphql::OneofObject)]
enum GraphqlCrmScope {
    /// The domains option.
    Domains(Vec<String>),
    /// The addresses option.
    Addresses(Vec<String>),
}

impl GraphqlCrmScope {
    /// Convert this value into the ast representation.
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

/// GraphQL input representing the date literal.
#[derive(async_graphql::OneofObject)]
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
    fn parse(value: String) -> async_graphql::Result<DateTime<Utc>> {
        DateTime::parse_from_rfc3339(&value)
            .map(|dt| dt.with_timezone(&Utc))
            .map_err(|err| {
                async_graphql::Error::new(format!("invalid RFC3339 date `{value}`: {err}"))
            })
    }

    /// Convert this value into the ast representation.
    fn into_ast(self) -> async_graphql::Result<DateLiteral> {
        Ok(match self {
            Self::Gt(value) => DateLiteral::GreaterThan(Self::parse(value)?),
            Self::Lt(value) => DateLiteral::LessThan(Self::parse(value)?),
            Self::Gte(value) => DateLiteral::GreaterThanOrEqual(Self::parse(value)?),
            Self::Lte(value) => DateLiteral::LessThanOrEqual(Self::parse(value)?),
        })
    }
}

/// GraphQL input representing the document literal.
#[derive(async_graphql::OneofObject)]
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

/// GraphQL input representing the document sub type.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
enum GraphqlDocumentSubType {
    /// The task option.
    Task,
    /// The snippet option.
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

/// GraphQL input representing the project literal.
#[derive(async_graphql::OneofObject)]
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

/// GraphQL input representing the chat literal.
#[derive(async_graphql::OneofObject)]
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

/// GraphQL input representing the chat role.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
enum GraphqlChatRole {
    /// The user option.
    User,
    /// The system option.
    System,
    /// The assistant option.
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

/// GraphQL input representing the email literal.
#[derive(async_graphql::OneofObject)]
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
}

impl IntoFilterExpr<EmailLiteral> for GraphqlEmailLiteral {
    /// Convert this value into the expr representation.
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

/// GraphQL input representing the email value.
#[derive(async_graphql::OneofObject)]
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

/// GraphQL input representing the shared email filter.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
enum GraphqlSharedEmailFilter {
    /// The exclude option.
    Exclude,
    /// The include option.
    Include,
    /// The only option.
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

/// GraphQL input representing the channel literal.
#[derive(async_graphql::OneofObject)]
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
    /// The notification done option.
    NotificationDone(bool),
    /// The notification seen option.
    NotificationSeen(bool),
}

impl IntoFilterExpr<ChannelLiteral> for GraphqlChannelLiteral {
    /// Convert this value into the expr representation.
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

/// GraphQL input representing the channel type filter.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
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

/// GraphQL input representing the channel thread literal.
#[derive(async_graphql::OneofObject)]
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

/// GraphQL input representing the call literal.
#[derive(async_graphql::OneofObject)]
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

/// GraphQL input representing the call status.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
enum GraphqlCallStatus {
    /// The attended option.
    Attended,
    /// The missed option.
    Missed,
    /// The unattended option.
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

/// GraphQL input representing the crm company literal.
#[derive(async_graphql::OneofObject)]
enum GraphqlCrmCompanyLiteral {
    /// The id option.
    Id(ID),
    /// The hidden option.
    Hidden(bool),
}

impl IntoFilterExpr<CrmCompanyLiteral> for GraphqlCrmCompanyLiteral {
    /// Convert this value into the expr representation.
    fn into_expr(self) -> async_graphql::Result<Expr<CrmCompanyLiteral>> {
        let literal = match self {
            Self::Id(id) => CrmCompanyLiteral::Id(parse_id(id, "id")?),
            Self::Hidden(hidden) => CrmCompanyLiteral::Hidden(hidden),
        };
        Ok(Expr::val(literal))
    }
}

/// GraphQL input representing the foreign entity literal.
#[derive(async_graphql::OneofObject)]
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
