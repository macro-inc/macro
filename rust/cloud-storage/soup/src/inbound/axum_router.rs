use crate::domain::{
    grouping::{GroupKeyset, GroupedCursor, GroupedPaginationLimits, GroupedResponse},
    models::{
        FrecencyQueryInner, FrecencySoupItem, IntoSoupReqAst, SimpleQueryInner, SoupErr, SoupQuery,
        SoupRequest, SoupType,
    },
    ports::{GroupedSoupRequest, SoupService},
};
use axum::{
    Json, Router,
    extract::{FromRef, Query, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use axum_extra::{either::Either, extract::Cached};
use email::{
    domain::{
        models::{Link, PreviewView},
        ports::EmailService,
    },
    inbound::{EmailLinkErr, EmailLinkExtractor, EmailRouterState},
};
use filter_ast::{Expr, ExprFrame};
use item_filters::{
    EntityFilters,
    ast::{
        EntityFilterAst, ExpandErr, LiteralTree, call::CallLiteral, channel::ChannelLiteral,
        chat::ChatLiteral, document::DocumentLiteral, email::EmailLiteral, project::ProjectLiteral,
        properties::PropertiesLiteral,
    },
};
use macro_user_id::user_id::MacroUserIdStr;
use model_error_response::ErrorResponse;
use model_user::axum_extractor::MacroUserExtractor;
use models_grouping::{GroupByField, GroupingConfig};
use models_pagination::{
    CursorWithValAndFilter, Frecency, PaginatedOpaqueCursor, SimpleSortMethod, SortMethod,
    TypeEraseCursor,
};
use models_soup::item::SoupItem;
use non_empty::IsEmpty;
use recursion::CollapsibleExt;
use rootcause::{Report, report};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use thiserror::Error;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[cfg(test)]
mod tests;

#[derive(Debug, Default, serde::Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
pub struct Params {
    /// Whether to expand projects. Defaults to true.
    #[serde(default)]
    expand: Option<bool>,
    /// Limit the number of items returned. Defaults to 20. Max 500.
    #[serde(default)]
    limit: Option<u16>,
    /// Sort method. Options are viewed_at, created_at, updated_at, viewed_updated. Defaults to viewed_at.
    #[serde(default)]
    sort_method: Option<SoupApiSort>,
}

#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SoupApiSort {
    ViewedAt,
    CreatedAt,
    UpdatedAt,
    ViewedUpdated,
    Frecency,
}

impl SoupApiSort {
    fn into_sort_method(self) -> SortMethod {
        match self {
            SoupApiSort::ViewedAt => SortMethod::Simple(SimpleSortMethod::ViewedAt),
            SoupApiSort::CreatedAt => SortMethod::Simple(SimpleSortMethod::CreatedAt),
            SoupApiSort::UpdatedAt => SortMethod::Simple(SimpleSortMethod::UpdatedAt),
            SoupApiSort::ViewedUpdated => SortMethod::Simple(SimpleSortMethod::ViewedUpdated),
            SoupApiSort::Frecency => SortMethod::Advanced(Frecency),
        }
    }
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct SoupPage {
    items: Vec<SoupApiItem>,
    next_cursor: Option<String>,
}

pub struct SoupRouterState<T, U> {
    service: Arc<T>,
    email: EmailRouterState<U>,
}

impl<T, U> Clone for SoupRouterState<T, U> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            email: self.email.clone(),
        }
    }
}

impl<T, U> FromRef<SoupRouterState<T, U>> for EmailRouterState<U> {
    fn from_ref(input: &SoupRouterState<T, U>) -> Self {
        input.email.clone()
    }
}

impl<T, U> SoupRouterState<T, U>
where
    T: SoupService,
    U: EmailService,
{
    pub fn new(service: T, email: U) -> Self {
        SoupRouterState {
            service: Arc::new(service),
            email: EmailRouterState::new(email),
        }
    }

    async fn handle<R>(
        &self,
        macro_user_id: MacroUserIdStr<'static>,
        email_link: Option<Link>,
        ApiSoupRequestInner {
            filters,
            params,
            email_view,
        }: ApiSoupRequestInner<R>,
        cursor: SoupCursor<R>,
    ) -> Result<Json<PaginatedOpaqueCursor<SoupApiItem>>, SoupHandlerErr>
    where
        SoupRequest<R>: IntoSoupReqAst,
        R: Clone + Serialize + Send,
    {
        let create_fallback = move || -> SoupQuery<R> {
            let params_sort = params
                .sort_method
                .map(|s| s.into_sort_method())
                .unwrap_or(SortMethod::Simple(SimpleSortMethod::ViewedAt));
            match params_sort {
                SortMethod::Simple(simple_sort_method) => {
                    SoupQuery::new_sort_simple(simple_sort_method, filters)
                }
                SortMethod::Advanced(frecency) => SoupQuery::new_sort_frecency(frecency, filters),
            }
        };

        let cursor: SoupQuery<R> = match cursor {
            Either::E1(l) => l
                .map(SoupQuery::new_cursor_simple)
                .unwrap_or_else(create_fallback),
            Either::E2(r) => r
                .map(SoupQuery::new_cursor_frecency)
                .unwrap_or_else(create_fallback),
        };

        let res = self
            .service
            .get_user_soup(SoupRequest {
                soup_type: match params.expand {
                    Some(true) | None => SoupType::Expanded,
                    Some(false) => SoupType::UnExpanded,
                },
                limit: params.limit.unwrap_or(20),
                cursor,
                user: macro_user_id,
                email_preview_view: email_view,
                link_id: email_link.map(|l| l.id),
            })
            .await?;

        Ok(Json(
            res.type_erase().map(SoupApiItem::from_frecency_soup_item),
        ))
    }
}

pub fn soup_router<T, U, S>(state: SoupRouterState<T, U>) -> Router<S>
where
    T: SoupService,
    U: EmailService,
    S: Send + Sync,
{
    Router::new()
        .route("/soup", get(get_soup_handler))
        .route("/soup", post(post_soup_handler))
        .route("/soup/ast", post(post_soup_ast_handler))
        .route("/soup/grouped", post(post_soup_grouped_handler))
        .with_state(state)
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct SoupApiItem {
    #[serde(flatten)]
    item: SoupItem,
    frecency_score: f64,
}

impl SoupApiItem {
    fn from_frecency_soup_item(item: FrecencySoupItem) -> Self {
        let FrecencySoupItem {
            item,
            frecency_score,
        } = item;
        SoupApiItem {
            item,
            frecency_score: frecency_score
                .map(|f| f.data.frecency_score)
                .unwrap_or_default(),
        }
    }
}

#[derive(Debug, Error)]
pub enum SoupHandlerErr {
    #[error("An internal server error has occurred")]
    Internal(SoupErr),
    #[error("An internal email server error has occurred")]
    EmailLinkErr(#[from] EmailLinkErr),
    #[error("Invalid filter arguments provided")]
    ExpandErr(ExpandErr),
    #[error("Invalid compound filter could not be expanded")]
    Expand,
}

impl From<SoupErr> for SoupHandlerErr {
    fn from(value: SoupErr) -> Self {
        match value {
            SoupErr::AstErr(expand_err) => SoupHandlerErr::ExpandErr(expand_err),
            err => SoupHandlerErr::Internal(err),
        }
    }
}

impl IntoResponse for SoupHandlerErr {
    fn into_response(self) -> axum::response::Response {
        let status_code = match &self {
            SoupHandlerErr::ExpandErr(_) | SoupHandlerErr::Expand => StatusCode::BAD_REQUEST,
            _ => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status_code,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

/// Gets the items the user has access to
#[utoipa::path(
    get,
    operation_id = "get_items_soup",
    path = "/items/soup",
    params(
        Params,
        ("cursor" = Option<String>, Query, description = "Base64 encoded cursor value."),
    ),
    responses(
            (status = 200, body=SoupPage),
            (status = 500, body=ErrorResponse),
    )
)]
pub async fn get_soup_handler<T, U>(
    State(service): State<SoupRouterState<T, U>>,
    Cached(MacroUserExtractor { macro_user_id, .. }): Cached<MacroUserExtractor>,
    email_link: Result<Cached<EmailLinkExtractor<U>>, EmailLinkErr>,
    Query(params): Query<Params>,
    cursor: SoupCursor<EntityFilters>,
) -> Result<Json<PaginatedOpaqueCursor<SoupApiItem>>, SoupHandlerErr>
where
    T: SoupService,
    U: EmailService,
{
    let link = match email_link {
        Ok(l) => Some(l.0.0),
        Err(EmailLinkErr::NotFound) => None,
        Err(e) => Err(e)?,
    };
    service
        .handle(
            macro_user_id,
            link,
            ApiSoupRequestInner {
                params,
                filters: EntityFilters::default(),
                email_view: Default::default(),
            },
            cursor,
        )
        .await
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PostSoupRequest {
    #[serde(default, flatten)]
    filters: EntityFilters,
    #[serde(default, flatten)]
    params: Params,
    /// the view of specific emails to display
    #[serde(default)]
    #[schema(value_type = String)]
    email_view: PreviewView,
}

struct ApiSoupRequestInner<T> {
    filters: T,
    params: Params,
    email_view: PreviewView,
}

type SoupCursor<R> = axum_extra::either::Either<
    Option<CursorWithValAndFilter<Uuid, SimpleSortMethod, R>>,
    Option<CursorWithValAndFilter<Uuid, Frecency, R>>,
>;

/// Gets the items the user has access to
#[utoipa::path(
    post,
    operation_id = "post_items_soup",
    path = "/items/soup",
    params(
        ("cursor" = Option<String>, Query, description = "Base64 encoded cursor value."),
    ),
    responses(
            (status = 200, body=SoupPage),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn post_soup_handler<T, U>(
    State(service): State<SoupRouterState<T, U>>,
    Cached(MacroUserExtractor { macro_user_id, .. }): Cached<MacroUserExtractor>,
    email_link: Result<Cached<EmailLinkExtractor<U>>, EmailLinkErr>,
    cursor: SoupCursor<EntityFilters>,
    Json(PostSoupRequest {
        filters,
        params,
        email_view,
    }): Json<PostSoupRequest>,
) -> Result<Json<PaginatedOpaqueCursor<SoupApiItem>>, SoupHandlerErr>
where
    T: SoupService,
    U: EmailService,
{
    let link = match email_link {
        Ok(l) => Some(l.0.0),
        Err(EmailLinkErr::NotFound) => None,
        Err(e) => Err(e)?,
    };
    service
        .handle(
            macro_user_id,
            link,
            ApiSoupRequestInner {
                filters,
                params,
                email_view,
            },
            cursor,
        )
        .await
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PostSoupAstRequest {
    #[serde(default, flatten)]
    #[schema(value_type = EntityFilterAst)]
    filters: ApiEntityFilterAst,
    #[serde(default, flatten)]
    params: Params,
    /// the view of specific emails to display
    #[serde(default)]
    #[schema(value_type = String)]
    email_view: PreviewView,
}

/// Gets the items the user has access to using AST filters
#[utoipa::path(
    post,
    operation_id = "post_items_soup_ast",
    path = "/items/soup/ast",
    params(
        ("cursor" = Option<String>, Query, description = "Base64 encoded cursor value."),
    ),
    request_body = PostSoupAstRequest,
    responses(
        (status = 200, body=SoupPage),
        (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn post_soup_ast_handler<T, U>(
    State(service): State<SoupRouterState<T, U>>,
    Cached(MacroUserExtractor { macro_user_id, .. }): Cached<MacroUserExtractor>,
    email_link: Result<Cached<EmailLinkExtractor<U>>, EmailLinkErr>,
    cursor: SoupCursor<ApiEntityFilterAst>,
    Json(PostSoupAstRequest {
        filters,
        params,
        email_view,
    }): Json<PostSoupAstRequest>,
) -> Result<Json<PaginatedOpaqueCursor<SoupApiItem>>, SoupHandlerErr>
where
    T: SoupService,
    U: EmailService,
{
    let link = match email_link {
        Ok(l) => Some(l.0.0),
        Err(EmailLinkErr::NotFound) => None,
        Err(e) => Err(e)?,
    };
    service
        .handle(
            macro_user_id,
            link,
            ApiSoupRequestInner {
                filters,
                params,
                email_view,
            },
            cursor,
        )
        .await
}

/// API request for grouped soup queries.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GroupedSoupApiRequest {
    /// Filter AST for items
    #[serde(default, flatten)]
    #[schema(value_type = EntityFilterAst)]
    pub filter: ApiEntityFilterAst,
    /// Sort method (only simple sorts allowed for grouped queries)
    #[serde(default)]
    pub sort_method: Option<SoupApiSimpleSort>,
    /// Field to group by
    pub group_by: ApiGroupByField,
    /// Filter to specific group (for "load more in group")
    #[serde(default)]
    pub group_key: Option<String>,
    /// Max items per group (default: 10)
    #[serde(default)]
    pub per_group_limit: Option<u32>,
    /// Max total items (default: 100)
    #[serde(default)]
    pub limit: Option<u32>,
    /// Pagination cursor from previous response
    #[serde(default)]
    pub cursor: Option<GroupedSoupApiCursor>,
    /// Whether to expand projects. Defaults to true.
    #[serde(default)]
    pub expand: Option<bool>,
    /// The view of specific emails to display
    #[serde(default)]
    #[schema(value_type = String)]
    pub email_view: PreviewView,
}

/// API cursor for grouped pagination (keyset-based).
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GroupedSoupApiCursor {
    /// Per-group keyset state for resumption
    pub groups: std::collections::HashMap<String, ApiGroupKeyset>,
}

/// API keyset state for a single group.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApiGroupKeyset {
    /// ID of last item seen in this group
    pub last_id: String,
    /// Sort timestamp of last item (ISO 8601)
    pub last_sort_ts: chrono::DateTime<chrono::Utc>,
}

impl From<GroupedSoupApiCursor> for GroupedCursor {
    fn from(c: GroupedSoupApiCursor) -> Self {
        GroupedCursor {
            groups: c
                .groups
                .into_iter()
                .map(|(k, v)| {
                    (
                        k,
                        GroupKeyset {
                            last_id: v.last_id,
                            last_sort_ts: v.last_sort_ts,
                        },
                    )
                })
                .collect(),
        }
    }
}

impl From<GroupedCursor> for GroupedSoupApiCursor {
    fn from(c: GroupedCursor) -> Self {
        GroupedSoupApiCursor {
            groups: c
                .groups
                .into_iter()
                .map(|(k, v)| {
                    (
                        k,
                        ApiGroupKeyset {
                            last_id: v.last_id,
                            last_sort_ts: v.last_sort_ts,
                        },
                    )
                })
                .collect(),
        }
    }
}

/// Simple sort methods for grouped queries.
#[derive(Debug, Default, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SoupApiSimpleSort {
    #[default]
    ViewedAt,
    CreatedAt,
    UpdatedAt,
    ViewedUpdated,
}

impl From<SoupApiSimpleSort> for SimpleSortMethod {
    fn from(s: SoupApiSimpleSort) -> Self {
        match s {
            SoupApiSimpleSort::ViewedAt => SimpleSortMethod::ViewedAt,
            SoupApiSimpleSort::CreatedAt => SimpleSortMethod::CreatedAt,
            SoupApiSimpleSort::UpdatedAt => SimpleSortMethod::UpdatedAt,
            SoupApiSimpleSort::ViewedUpdated => SimpleSortMethod::ViewedUpdated,
        }
    }
}

/// Field to group by.
#[derive(Debug, Clone, Deserialize, ToSchema)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ApiGroupByField {
    /// Smart date buckets: Today, Yesterday, This Week, etc.
    Date,
    /// Group by entity/item type
    EntityType,
    /// Group by project association
    Project,
    /// Group by a property value
    Property {
        property_definition_id: Uuid,
        #[serde(default)]
        entity_type: Option<String>,
    },
}

impl From<ApiGroupByField> for GroupByField {
    fn from(f: ApiGroupByField) -> Self {
        match f {
            ApiGroupByField::Date => GroupByField::Date,
            ApiGroupByField::EntityType => GroupByField::EntityType,
            ApiGroupByField::Project => GroupByField::Project,
            ApiGroupByField::Property {
                property_definition_id,
                entity_type,
            } => GroupByField::Property {
                property_definition_id,
                entity_type,
            },
        }
    }
}

/// API response for grouped soup queries.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GroupedSoupApiResponse {
    /// Items ordered by group, then by sort within group
    pub items: Vec<GroupedSoupApiItem>,
    /// Metadata for each group
    pub groups: Vec<ApiGroupMeta>,
    /// Cursor for next page (global pagination)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<GroupedSoupApiCursor>,
}

/// A soup item with its group assignment.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GroupedSoupApiItem {
    /// The item data
    #[serde(flatten)]
    pub item: SoupItem,
    /// Frecency score
    pub frecency_score: f64,
    /// Which group this item belongs to
    pub group_key: String,
    /// Human-readable label for the group
    pub group_label: String,
    /// Display order (lower = first)
    pub group_display_order: i32,
}

/// Group metadata in API response.
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ApiGroupMeta {
    /// Unique key identifying the group
    pub key: String,
    /// Human-readable label
    pub label: String,
    /// Display order (lower = first)
    pub display_order: i32,
    /// Total items in this group across all pages
    pub total_count: u32,
    /// Items from this group in current page
    pub page_count: u32,
    /// Index where this group starts in items array
    pub start_index: u32,
    /// Cursor to load more from this specific group
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

/// Gets soup items grouped by a specified field
#[utoipa::path(
    post,
    operation_id = "post_items_soup_grouped",
    path = "/items/soup/grouped",
    request_body = GroupedSoupApiRequest,
    responses(
        (status = 200, body = GroupedSoupApiResponse),
        (status = 400, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn post_soup_grouped_handler<T, U>(
    State(service): State<SoupRouterState<T, U>>,
    Cached(MacroUserExtractor { macro_user_id, .. }): Cached<MacroUserExtractor>,
    email_link: Result<Cached<EmailLinkExtractor<U>>, EmailLinkErr>,
    Json(request): Json<GroupedSoupApiRequest>,
) -> Result<Json<GroupedSoupApiResponse>, SoupHandlerErr>
where
    T: SoupService,
    U: EmailService,
{
    let link = match email_link {
        Ok(l) => Some(l.0.0),
        Err(EmailLinkErr::NotFound) => None,
        Err(e) => Err(e)?,
    };

    let filter = request
        .filter
        .into_entity_ast()
        .map_err(|_| SoupHandlerErr::Expand)?;
    let filter = if filter.is_empty() {
        None
    } else {
        Some(filter)
    };

    let sort_method = request.sort_method.unwrap_or_default().into();

    let soup_request = SoupRequest {
        soup_type: match request.expand {
            Some(true) | None => SoupType::Expanded,
            Some(false) => SoupType::UnExpanded,
        },
        limit: request.limit.unwrap_or(100).clamp(20, 500) as u16,
        cursor: SoupQuery::new_sort_simple(sort_method, filter),
        user: macro_user_id,
        email_preview_view: request.email_view,
        link_id: link.map(|l| l.id),
    };

    let grouping = GroupingConfig {
        field: request.group_by.into(),
        group_key: request.group_key,
        per_group_limit: request.per_group_limit,
    };

    let limits = GroupedPaginationLimits {
        per_group: request.per_group_limit.unwrap_or(10),
        total: request.limit.unwrap_or(100),
    };

    let response = service
        .service
        .get_soup_grouped(GroupedSoupRequest {
            soup_request,
            grouping,
            limits,
            cursor: request.cursor.map(Into::into),
        })
        .await?;

    Ok(Json(response.into()))
}

impl From<GroupedResponse> for GroupedSoupApiResponse {
    fn from(r: GroupedResponse) -> Self {
        GroupedSoupApiResponse {
            items: r
                .items
                .into_iter()
                .map(|i| GroupedSoupApiItem {
                    frecency_score: i
                        .item
                        .frecency_score
                        .as_ref()
                        .map(|f| f.data.frecency_score)
                        .unwrap_or_default(),
                    item: i.item.item,
                    group_key: i.group_key,
                    group_label: i.group_label,
                    group_display_order: i.group_display_order,
                })
                .collect(),
            groups: r
                .groups
                .into_iter()
                .map(|g| ApiGroupMeta {
                    key: g.key,
                    label: g.label,
                    display_order: g.display_order.unwrap_or(0),
                    total_count: g.total_count,
                    page_count: g.page_count,
                    start_index: g.start_index,
                    next_cursor: g.next_cursor,
                })
                .collect(),
            next_cursor: r.next_cursor.map(Into::into),
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ApiEntityFilterAst {
    /// the filters that should be applied to the document entity
    #[serde(default, rename = "df")]
    pub document_filter: LiteralTree<ApiDocumentLiteral>,
    /// the filters that should be applied to the project entity
    #[serde(default, rename = "pf")]
    pub project_filter: LiteralTree<ProjectLiteral>,
    /// the filters that should be applied to the chat entity
    #[serde(default, rename = "cf")]
    pub chat_filter: LiteralTree<ChatLiteral>,
    /// the filters that should be applied to the email entity
    #[serde(default, rename = "ef")]
    pub email_filter: LiteralTree<EmailLiteral>,
    /// the filters that should be applied to the channel entity
    #[serde(default, rename = "chanf")]
    pub channel_filter: LiteralTree<ChannelLiteral>,
    /// the filters that should be applied to the call entity
    #[serde(default, rename = "callf")]
    pub call_filter: LiteralTree<CallLiteral>,
    /// the filters that should be applied based on entity properties
    #[serde(default, rename = "propf")]
    pub properties_filter: LiteralTree<PropertiesLiteral>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub enum ApiDocumentLiteral {
    Plain(DocumentLiteral),
    FileAssoc(CompoundDocumentLiteral),
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum CompoundDocumentLiteral {
    #[serde(rename = "fa")]
    FileAssoc(String),
}

impl IntoSoupReqAst for SoupRequest<ApiEntityFilterAst> {
    fn into_ast(self) -> Result<SoupRequest<Option<EntityFilterAst>>, ExpandErr> {
        let SoupRequest {
            soup_type,
            limit,
            cursor,
            user,
            email_preview_view,
            link_id,
        } = self;

        let cursor = match cursor {
            SoupQuery::Simple(SimpleQueryInner(query)) => SoupQuery::Simple(SimpleQueryInner(
                query.try_map_filter(ApiEntityFilterAst::into_optional_entity_ast)?,
            )),
            SoupQuery::Frecency(FrecencyQueryInner(query)) => {
                SoupQuery::Frecency(FrecencyQueryInner(
                    query.try_map_filter(ApiEntityFilterAst::into_optional_entity_ast)?,
                ))
            }
        };

        Ok(SoupRequest {
            soup_type,
            limit,
            cursor,
            user,
            email_preview_view,
            link_id,
        })
    }
}

impl ApiEntityFilterAst {
    fn into_optional_entity_ast(self) -> Result<Option<EntityFilterAst>, ExpandErr> {
        let ast = self
            .into_entity_ast()
            .map_err(|e| ExpandErr::ApiAst(e.to_string()))?;
        Ok((!ast.is_empty()).then_some(ast))
    }

    #[tracing::instrument(err, skip(self))]
    fn into_entity_ast(self) -> Result<EntityFilterAst, Report> {
        let ApiEntityFilterAst {
            document_filter,
            project_filter,
            chat_filter,
            email_filter,
            channel_filter,
            call_filter,
            properties_filter,
        } = self;

        let document_filter = document_filter
            .map(|tree| {
                tree.as_ref().try_collapse_frames(|frame| match frame {
                    ExprFrame::And(a, b) => Ok(Expr::and(a, b)),
                    ExprFrame::Or(a, b) => Ok(Expr::or(a, b)),
                    ExprFrame::Not(a) => Ok(Expr::is_not(a)),
                    ExprFrame::Literal(ApiDocumentLiteral::Plain(doc_lit)) => {
                        Ok(Expr::val(doc_lit))
                    }
                    ExprFrame::Literal(ApiDocumentLiteral::FileAssoc(compound)) => match compound {
                        CompoundDocumentLiteral::FileAssoc(s) => {
                            let (_, file_types) =
                                item_filters::ast::document::parse_to_file_types(&s)?;
                            file_types
                                .map(|ft| Expr::val(DocumentLiteral::FileType(ft)))
                                .reduce(Expr::or)
                                .ok_or(report!("File association list cannot be empty"))
                        }
                    },
                })
            })
            .transpose()?
            .map(Arc::new);

        Ok(EntityFilterAst {
            document_filter,
            project_filter,
            chat_filter,
            email_filter,
            channel_filter,
            call_filter,
            properties_filter,
        })
    }
}
