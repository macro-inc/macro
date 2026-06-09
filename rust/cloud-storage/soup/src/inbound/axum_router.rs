use crate::domain::{
    models::{
        FrecencyQueryInner, FrecencySoupItem, GroupMeta, GroupedSortRequest, IntoSoupReqAst,
        SimpleQueryInner, SoupErr, SoupQuery, SoupRequest, SoupType, build_grouped_response,
    },
    ports::SoupService,
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
        models::{EmailErr, PreviewView},
        ports::EmailService,
    },
    inbound::axum::previews_router::EmailRouterState,
};
use entity_access::{
    domain::{
        models::{AdminTeamRole, EntityAccessReceipt, MemberTeamRole},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::OptionalMacroUserTeamExtractor,
};
use filter_ast::{Expr, ExprFrame};
use item_filters::{
    EntityFilters,
    ast::{
        EntityFilterAst, ExpandErr, LiteralTree,
        call::CallLiteral,
        channel::ChannelLiteral,
        chat::ChatLiteral,
        crm_company::CrmCompanyLiteral,
        document::DocumentLiteral,
        email::EmailLiteral,
        foreign_entity::ForeignEntityLiteral,
        project::ProjectLiteral,
        properties::{PropertiesLiteral, PropertyEntityType},
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
use std::collections::HashMap;
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

/// Sort method for grouped queries (frecency not supported).
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum GroupedSoupSort {
    ViewedAt,
    CreatedAt,
    UpdatedAt,
    ViewedUpdated,
}

impl GroupedSoupSort {
    fn into_simple_sort(self) -> SimpleSortMethod {
        match self {
            GroupedSoupSort::ViewedAt => SimpleSortMethod::ViewedAt,
            GroupedSoupSort::CreatedAt => SimpleSortMethod::CreatedAt,
            GroupedSoupSort::UpdatedAt => SimpleSortMethod::UpdatedAt,
            GroupedSoupSort::ViewedUpdated => SimpleSortMethod::ViewedUpdated,
        }
    }
}

/// Parameters for grouped soup queries.
#[derive(Debug, Deserialize, ToSchema)]
pub struct GroupedParams {
    /// Field to group results by (required).
    pub group_by: ApiGroupByField,
    /// Filter to a specific group key (for "load more in group X").
    #[serde(default)]
    pub group_key: Option<String>,
    /// Sort method. Defaults to viewed_updated.
    #[serde(default)]
    pub sort_method: Option<GroupedSoupSort>,
    /// Limit the number of items returned. Defaults to 20. Max 500.
    #[serde(default)]
    pub limit: Option<u16>,
}

/// Parameters for the initial grouped soup query.
#[derive(Debug, Deserialize, ToSchema)]
pub struct GroupedInitialParams {
    /// Field to group results by (required).
    pub group_by: ApiGroupByField,
    /// Sort method. Defaults to viewed_updated.
    #[serde(default)]
    pub sort_method: Option<GroupedSoupSort>,
    /// Limit the number of items returned per group. Defaults to 20. Max 500.
    #[serde(default)]
    pub per_group_limit: Option<u16>,
}

/// Parameters for fetching one page within a specific group.
#[derive(Debug, Deserialize, ToSchema)]
pub struct GroupedPageParams {
    /// Field to group results by (required).
    pub group_by: ApiGroupByField,
    /// Group key to fetch.
    pub group_key: String,
    /// Sort method. Defaults to viewed_updated.
    #[serde(default)]
    pub sort_method: Option<GroupedSoupSort>,
    /// Limit the number of items returned. Defaults to 20. Max 500.
    #[serde(default)]
    pub limit: Option<u16>,
}

impl From<GroupedInitialParams> for GroupedParams {
    fn from(params: GroupedInitialParams) -> Self {
        Self {
            group_by: params.group_by,
            group_key: None,
            sort_method: params.sort_method,
            limit: params.per_group_limit,
        }
    }
}

impl From<GroupedPageParams> for GroupedParams {
    fn from(params: GroupedPageParams) -> Self {
        Self {
            group_by: params.group_by,
            group_key: Some(params.group_key),
            sort_method: params.sort_method,
            limit: params.limit,
        }
    }
}

/// Entity type for property lookups (API representation).
#[derive(Debug, Clone, Copy, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ApiPropertyEntityType {
    /// Channel entity
    Channel,
    /// Chat entity
    Chat,
    /// Company entity
    Company,
    /// Document entity
    Document,
    /// Project entity
    Project,
    /// Task entity
    Task,
    /// Thread entity
    Thread,
    /// User entity
    User,
}

impl From<ApiPropertyEntityType> for PropertyEntityType {
    fn from(api: ApiPropertyEntityType) -> Self {
        match api {
            ApiPropertyEntityType::Channel => PropertyEntityType::Channel,
            ApiPropertyEntityType::Chat => PropertyEntityType::Chat,
            ApiPropertyEntityType::Company => PropertyEntityType::Company,
            ApiPropertyEntityType::Document => PropertyEntityType::Document,
            ApiPropertyEntityType::Project => PropertyEntityType::Project,
            ApiPropertyEntityType::Task => PropertyEntityType::Task,
            ApiPropertyEntityType::Thread => PropertyEntityType::Thread,
            ApiPropertyEntityType::User => PropertyEntityType::User,
        }
    }
}

/// API representation of group-by field.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum ApiGroupByField {
    /// Smart date buckets: Today, Yesterday, This Week, Last Week, This Month, Last Month, Older
    Date,
    /// Group by entity type (document, email, channel, etc.)
    EntityType,
    /// Group by project
    Project,
    /// Group by a property value (e.g., status, priority, or custom properties)
    #[serde(rename = "property")]
    Property {
        /// The property definition UUID to group by
        property_definition_id: Uuid,
        /// Optional entity type filter for the property lookup
        #[serde(skip_serializing_if = "Option::is_none")]
        entity_type: Option<ApiPropertyEntityType>,
    },
}

impl From<ApiGroupByField> for GroupByField {
    fn from(api: ApiGroupByField) -> Self {
        match api {
            ApiGroupByField::Date => GroupByField::Date,
            ApiGroupByField::EntityType => GroupByField::EntityType,
            ApiGroupByField::Project => GroupByField::Project,
            ApiGroupByField::Property {
                property_definition_id,
                entity_type,
            } => GroupByField::Property {
                property_definition_id,
                entity_type: entity_type.map(|et| PropertyEntityType::from(et).to_string()),
            },
        }
    }
}

/// API representation of group metadata.
///
/// Items belonging to this group are referenced by `item_ids`, each of which
/// looks up an entry in `GroupedSoupPage.items` (a normalized pool).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct ApiGroupMeta {
    /// Group key - format depends on group_by field
    pub key: String,
    /// Human-readable label for the group
    pub label: String,
    /// Display order for sorting groups (lower = first)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_order: Option<i32>,
    /// Total count of items in this group across all pages
    pub total_count: u32,
    /// Ordered ids of items in this group for the current page.
    /// Each id keys into `GroupedSoupPage.items`.
    pub item_ids: Vec<Uuid>,
    /// Cursor to load more items specifically from this group
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
}

impl From<GroupMeta> for ApiGroupMeta {
    fn from(meta: GroupMeta) -> Self {
        Self {
            key: meta.key,
            label: meta.label,
            display_order: meta.display_order,
            total_count: meta.total_count,
            item_ids: meta.item_ids,
            next_cursor: meta.next_cursor,
        }
    }
}

#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct SoupPage {
    items: Vec<SoupApiItem>,
    next_cursor: Option<String>,
}

/// Response for the initial grouped soup query.
///
/// Items are returned as a pool keyed by id; each `ApiGroupMeta.item_ids`
/// describes the ordered membership of one group.
#[derive(Debug, Serialize, ToSchema)]
pub struct GroupedSoupInitialPage {
    /// Items in this page, keyed by id. Ordering lives in `groups[].item_ids`.
    pub items: HashMap<Uuid, SoupApiItem>,
    /// Ordered group metadata for this grouped response.
    pub groups: Vec<ApiGroupMeta>,
}

/// Response for fetching a page within one group.
#[derive(Debug, Serialize, ToSchema)]
pub struct GroupedSoupGroupPage {
    /// Items in this page, keyed by id. Ordering lives in `group.item_ids`.
    pub items: HashMap<Uuid, SoupApiItem>,
    /// Metadata and item membership for the requested group page.
    pub group: ApiGroupMeta,
}

/// Response for grouped soup queries.
#[derive(Debug, Serialize, ToSchema)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum GroupedSoupPage {
    Initial(GroupedSoupInitialPage),
    GroupPage(GroupedSoupGroupPage),
}

struct ApiGroupedSoupParts {
    items: HashMap<Uuid, SoupApiItem>,
    groups: Vec<ApiGroupMeta>,
}

pub struct SoupRouterState<T, U, EAS> {
    service: Arc<T>,
    email: EmailRouterState<U>,
    entity_access_service: Arc<EAS>,
}

impl<T, U, EAS> Clone for SoupRouterState<T, U, EAS> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            email: self.email.clone(),
            entity_access_service: self.entity_access_service.clone(),
        }
    }
}

impl<T, U, EAS> FromRef<SoupRouterState<T, U, EAS>> for EmailRouterState<U> {
    fn from_ref(input: &SoupRouterState<T, U, EAS>) -> Self {
        input.email.clone()
    }
}

impl<T, U, EAS> FromRef<SoupRouterState<T, U, EAS>> for Arc<EAS> {
    fn from_ref(input: &SoupRouterState<T, U, EAS>) -> Self {
        input.entity_access_service.clone()
    }
}

impl<T, U, EAS> SoupRouterState<T, U, EAS>
where
    T: SoupService,
    U: EmailService,
    EAS: entity_access::domain::ports::EntityAccessService,
{
    pub fn new(service: T, email: U, entity_access_service: Arc<EAS>) -> Self {
        SoupRouterState {
            service: Arc::new(service),
            email: EmailRouterState::new(email),
            entity_access_service,
        }
    }

    async fn handle<R>(
        &self,
        macro_user_id: MacroUserIdStr<'static>,
        link_ids: Vec<Uuid>,
        team_receipt_option: Option<EntityAccessReceipt<MemberTeamRole>>,
        ApiSoupRequestInner {
            filters,
            params,
            email_view,
        }: ApiSoupRequestInner<R>,
        cursor: SoupCursor<R>,
    ) -> Result<Json<PaginatedOpaqueCursor<SoupApiItem>>, SoupHandlerErr>
    where
        SoupRequest<R>: IntoSoupReqAst,
        R: Clone + Serialize + Send + RequestsCrmScope + RequestsCrmAdmin,
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

        // Derive CRM-scope authorization from the *effective* filter (the
        // one embedded in the resolved SoupQuery), not the raw request body.
        // For cursor-paginated requests the body's filters may be empty and
        // the real filter lives inside the cursor — checking the body would
        // miss CRM scope on follow-up pages.
        let team_receipt =
            resolve_crm_team_receipt(cursor.filter().requests_crm_scope(), team_receipt_option)?;
        require_crm_admin_role(cursor.filter().requests_crm_admin(), &team_receipt)?;

        let res = self
            .service
            .get_user_soup(
                SoupRequest {
                    soup_type: match params.expand {
                        Some(true) | None => SoupType::Expanded,
                        Some(false) => SoupType::UnExpanded,
                    },
                    limit: params.limit.unwrap_or(20),
                    cursor,
                    user: macro_user_id,
                    email_preview_view: email_view,
                    link_ids,
                },
                team_receipt,
            )
            .await?;

        Ok(Json(
            res.type_erase().map(SoupApiItem::from_frecency_soup_item),
        ))
    }

    async fn handle_grouped(
        &self,
        macro_user_id: MacroUserIdStr<'static>,
        filters: EntityFilterAst,
        params: GroupedParams,
        cursor: Option<CursorWithValAndFilter<Uuid, SimpleSortMethod, EntityFilterAst>>,
    ) -> Result<ApiGroupedSoupParts, SoupHandlerErr> {
        let limit = params.limit.unwrap_or(20).clamp(20, 500);
        let sort_method = params
            .sort_method
            .map(|s| s.into_simple_sort())
            .unwrap_or(SimpleSortMethod::ViewedUpdated);

        let group_by_field = GroupByField::from(params.group_by);
        let grouping = GroupingConfig {
            field: group_by_field.clone(),
            group_key: params.group_key.clone(),
            per_group_limit: None,
        };

        // Use cursor if provided, otherwise start fresh
        let query_cursor = match cursor {
            Some(c) => models_pagination::Query::Cursor(c),
            None => models_pagination::Query::Sort(sort_method, filters.clone()),
        };

        let req = GroupedSortRequest {
            limit,
            cursor: query_cursor,
            user_id: macro_user_id,
            grouping,
        };

        let items = self.service.get_user_soup_grouped(req).await?;

        let response = build_grouped_response(
            items,
            &group_by_field,
            sort_method,
            params.group_key,
            filters,
        );

        Ok(ApiGroupedSoupParts {
            items: response
                .items
                .into_iter()
                .map(|(id, item)| (id, SoupApiItem::from_frecency_soup_item(item)))
                .collect(),
            groups: response
                .groups
                .into_iter()
                .map(ApiGroupMeta::from)
                .collect(),
        })
    }
}

/// Probe applied to whichever filter type a soup endpoint accepts
/// (`EntityFilters` for the typed POST, `ApiEntityFilterAst` for the AST
/// endpoint). Lets `handle` inspect the *materialized* SoupQuery's filter
/// — which may have come from the request body or from the cursor — and
/// decide whether CRM scope is in play.
pub trait RequestsCrmScope {
    /// True when this filter asks the query to expand visibility across
    /// the requesting user's team via a CRM-scoped attribute
    /// (`crm_domains` or `crm_addresses`).
    fn requests_crm_scope(&self) -> bool;
}

impl RequestsCrmScope for EntityFilters {
    fn requests_crm_scope(&self) -> bool {
        !self.email_filters.crm_domains.is_empty() || !self.email_filters.crm_addresses.is_empty()
    }
}

impl RequestsCrmScope for ApiEntityFilterAst {
    fn requests_crm_scope(&self) -> bool {
        !self.email_crm_domains.is_empty() || !self.email_crm_addresses.is_empty()
    }
}

/// Filter bodies that may opt into admin-only CRM data (currently:
/// hidden CRM companies) implement this so the soup handler can gate
/// the request on an admin/owner team role.
pub trait RequestsCrmAdmin {
    /// True when this filter asks for data only admin/owner team
    /// members may see — e.g. `crm_company_filters.hidden = Some(true)`.
    fn requests_crm_admin(&self) -> bool;
}

impl RequestsCrmAdmin for EntityFilters {
    fn requests_crm_admin(&self) -> bool {
        matches!(self.crm_company_filters.hidden, Some(true))
    }
}

impl RequestsCrmAdmin for ApiEntityFilterAst {
    fn requests_crm_admin(&self) -> bool {
        self.crm_company_filter
            .as_deref()
            .is_some_and(ast_requests_crm_admin)
    }
}

/// Walks a `CrmCompanyLiteral` AST checking for any `Hidden(true)`
/// literal. Mirrors the conservative shape the request-time extractor
/// in `models::extract_crm_company_filter` allows: `And`/`Or` recurse;
/// `Not` would invert and fail closed downstream, but for the *role
/// gate* we still must inspect under `Not` to avoid a `Not(Hidden(false))`
/// sneaking past — treat any path reaching a `Hidden(true)` literal as
/// admin-required.
fn ast_requests_crm_admin(expr: &Expr<CrmCompanyLiteral>) -> bool {
    match expr {
        Expr::Literal(CrmCompanyLiteral::Hidden(true)) => true,
        Expr::Literal(_) => false,
        Expr::And(a, b) | Expr::Or(a, b) => ast_requests_crm_admin(a) || ast_requests_crm_admin(b),
        Expr::Not(a) => ast_requests_crm_admin(a),
    }
}

pub fn soup_router<T, U, EAS, S>(state: SoupRouterState<T, U, EAS>) -> Router<S>
where
    T: SoupService,
    U: EmailService,
    EAS: EntityAccessService,
    S: Send + Sync,
{
    Router::new()
        .route("/soup", get(get_soup_handler))
        .route("/soup", post(post_soup_handler))
        .route("/soup/ast", post(post_soup_ast_handler))
        .route("/soup/ast/grouped", post(post_grouped_soup_ast_handler))
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
    EmailErr(#[from] EmailErr),
    #[error("Invalid filter arguments provided")]
    ExpandErr(ExpandErr),
    #[error("Invalid compound filter could not be expanded")]
    Expand,
    #[error("CRM-scoped queries require team membership")]
    CrmScopeForbidden,
    #[error("Querying hidden CRM companies requires admin/owner team role")]
    CrmAdminRequired,
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
            SoupHandlerErr::CrmScopeForbidden | SoupHandlerErr::CrmAdminRequired => {
                StatusCode::FORBIDDEN
            }
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

async fn fetch_caller_link_ids<T, U, EAS>(
    service: &SoupRouterState<T, U, EAS>,
    macro_user_id: &str,
) -> Result<Vec<Uuid>, SoupHandlerErr>
where
    T: SoupService,
    U: EmailService,
    EAS: EntityAccessService,
{
    let macro_id = MacroUserIdStr::parse_from_str(macro_user_id).map_err(|e| {
        SoupHandlerErr::Internal(SoupErr::SoupDbErr(anyhow::anyhow!(
            "invalid macro_user_id from extractor: {e}"
        )))
    })?;
    let links = service
        .email
        .service()
        .get_inboxes_for_macro_id(macro_id)
        .await?;
    Ok(links.into_iter().map(|l| l.id).collect())
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
            (status = 403, description = "CRM-scoped queries require team membership, or requesting hidden CRM companies requires admin/owner team role", body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
pub async fn get_soup_handler<T, U, EAS>(
    State(service): State<SoupRouterState<T, U, EAS>>,
    Cached(MacroUserExtractor { macro_user_id, .. }): Cached<MacroUserExtractor>,
    team: OptionalMacroUserTeamExtractor<MemberTeamRole, EAS>,
    Query(params): Query<Params>,
    cursor: SoupCursor<EntityFilters>,
) -> Result<Json<PaginatedOpaqueCursor<SoupApiItem>>, SoupHandlerErr>
where
    T: SoupService,
    U: EmailService,
    EAS: EntityAccessService,
{
    let link_ids = fetch_caller_link_ids(&service, macro_user_id.as_ref()).await?;
    // Team receipt is plumbed through even for GET so that paginating a
    // team-scoped query via a cursor (which carries the original filter)
    // continues to authorize correctly.
    service
        .handle(
            macro_user_id,
            link_ids,
            team.entity_access_receipt,
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
            (status = 403, description = "CRM-scoped queries require team membership, or requesting hidden CRM companies requires admin/owner team role", body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn post_soup_handler<T, U, EAS>(
    State(service): State<SoupRouterState<T, U, EAS>>,
    Cached(MacroUserExtractor { macro_user_id, .. }): Cached<MacroUserExtractor>,
    team: OptionalMacroUserTeamExtractor<MemberTeamRole, EAS>,
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
    EAS: EntityAccessService,
{
    let link_ids = fetch_caller_link_ids(&service, macro_user_id.as_ref()).await?;
    // Pass the raw extractor receipt through — `handle` resolves the
    // CRM-scope check against the *effective* filter (which may come from
    // the cursor on follow-up pages), not the request body.
    service
        .handle(
            macro_user_id,
            link_ids,
            team.entity_access_receipt,
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
        (status = 403, description = "CRM-scoped queries require team membership, or requesting hidden CRM companies requires admin/owner team role", body=ErrorResponse),
        (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn post_soup_ast_handler<T, U, EAS>(
    State(service): State<SoupRouterState<T, U, EAS>>,
    Cached(MacroUserExtractor { macro_user_id, .. }): Cached<MacroUserExtractor>,
    team: OptionalMacroUserTeamExtractor<MemberTeamRole, EAS>,
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
    EAS: EntityAccessService,
{
    let link_ids = fetch_caller_link_ids(&service, macro_user_id.as_ref()).await?;
    // Pass the raw extractor receipt through — `handle` resolves the
    // CRM-scope check against the *effective* filter (which may come from
    // the cursor on follow-up pages), not the request body.
    service
        .handle(
            macro_user_id,
            link_ids,
            team.entity_access_receipt,
            ApiSoupRequestInner {
                filters,
                params,
                email_view,
            },
            cursor,
        )
        .await
}

/// Request body for the initial grouped soup query.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PostGroupedSoupAstInitialRequest {
    /// Filters to apply (AST format)
    #[serde(default, flatten)]
    filters: ApiEntityFilterAst,
    /// Grouping parameters (required)
    #[serde(flatten)]
    params: GroupedInitialParams,
}

/// Request body for fetching one page within a specific group.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PostGroupedSoupAstGroupPageRequest {
    /// Filters to apply (AST format)
    #[serde(default, flatten)]
    filters: ApiEntityFilterAst,
    /// Grouping parameters (required)
    #[serde(flatten)]
    params: GroupedPageParams,
}

/// Request body for grouped soup queries with AST filters.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum PostGroupedSoupAstRequest {
    Initial(PostGroupedSoupAstInitialRequest),
    GroupPage(PostGroupedSoupAstGroupPageRequest),
}

enum GroupedSoupRequestMode {
    Initial,
    GroupPage,
}

/// Gets the items grouped by the specified field using AST filters.
#[utoipa::path(
    post,
    operation_id = "post_items_soup_ast_grouped",
    path = "/items/soup/ast/grouped",
    params(
        ("cursor" = Option<String>, Query, description = "Base64 encoded cursor value."),
    ),
    request_body = PostGroupedSoupAstRequest,
    responses(
        (status = 200, body=GroupedSoupPage),
        (status = 403, description = "CRM-scoped queries require team membership, or requesting hidden CRM companies requires admin/owner team role", body=ErrorResponse),
        (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(err, skip_all)]
pub async fn post_grouped_soup_ast_handler<T, U, EAS>(
    State(service): State<SoupRouterState<T, U, EAS>>,
    Cached(MacroUserExtractor { macro_user_id, .. }): Cached<MacroUserExtractor>,
    cursor: Option<CursorWithValAndFilter<Uuid, SimpleSortMethod, EntityFilterAst>>,
    Json(request): Json<PostGroupedSoupAstRequest>,
) -> Result<Json<GroupedSoupPage>, SoupHandlerErr>
where
    T: SoupService,
    U: EmailService,
    EAS: EntityAccessService,
{
    let (filters, params, mode) = match request {
        PostGroupedSoupAstRequest::Initial(request) => (
            request.filters,
            request.params.into(),
            GroupedSoupRequestMode::Initial,
        ),
        PostGroupedSoupAstRequest::GroupPage(request) => (
            request.filters,
            request.params.into(),
            GroupedSoupRequestMode::GroupPage,
        ),
    };

    let filters = filters
        .into_entity_ast()
        .map_err(|_| SoupHandlerErr::Expand)?;

    let response = service
        .handle_grouped(macro_user_id, filters, params, cursor)
        .await?;

    Ok(Json(match mode {
        GroupedSoupRequestMode::Initial => GroupedSoupPage::Initial(GroupedSoupInitialPage {
            items: response.items,
            groups: response.groups,
        }),
        GroupedSoupRequestMode::GroupPage => {
            let Some(group) = response.groups.into_iter().next() else {
                return Err(SoupHandlerErr::Expand);
            };
            GroupedSoupPage::GroupPage(GroupedSoupGroupPage {
                items: response.items,
                group,
            })
        }
    }))
}

/// Returns the team receipt to use when CRM-scoped visibility is required.
/// `crm_scope_requested` is true when the request body carries a
/// `crm_domains` / `crm_addresses` attribute. Returns
/// `Err(CrmScopeForbidden)` when CRM scope was requested but the user has
/// no qualifying team membership.
fn resolve_crm_team_receipt(
    crm_scope_requested: bool,
    receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
) -> Result<Option<EntityAccessReceipt<MemberTeamRole>>, SoupHandlerErr> {
    if crm_scope_requested && receipt.is_none() {
        return Err(SoupHandlerErr::CrmScopeForbidden);
    }
    Ok(receipt)
}

/// Companion to [`resolve_crm_team_receipt`] for the admin-only CRM
/// data path (currently: hidden CRM companies). `admin_requested` is
/// the result of [`RequestsCrmAdmin::requests_crm_admin`] on the
/// effective filter. Returns `Err(CrmAdminRequired)` when the request
/// asks for admin-only data but the receipt is missing or the user's
/// actual team role doesn't satisfy [`AdminTeamRole`].
fn require_crm_admin_role(
    admin_requested: bool,
    receipt: &Option<EntityAccessReceipt<MemberTeamRole>>,
) -> Result<(), SoupHandlerErr> {
    if !admin_requested {
        return Ok(());
    }
    let Some(receipt) = receipt else {
        return Err(SoupHandlerErr::CrmAdminRequired);
    };
    if !receipt.entity_permission().satisfies::<AdminTeamRole>() {
        return Err(SoupHandlerErr::CrmAdminRequired);
    }
    Ok(())
}

#[derive(Debug, Default, Serialize, Deserialize, Clone, ToSchema)]
pub struct ApiEntityFilterAst {
    /// the filters that should be applied to the document entity
    #[serde(default, rename = "df")]
    #[schema(value_type = serde_json::Value)]
    pub document_filter: LiteralTree<ApiDocumentLiteral>,
    /// the filters that should be applied to the project entity
    #[serde(default, rename = "pf")]
    #[schema(value_type = serde_json::Value)]
    pub project_filter: LiteralTree<ProjectLiteral>,
    /// the filters that should be applied to the chat entity
    #[serde(default, rename = "cf")]
    #[schema(value_type = serde_json::Value)]
    pub chat_filter: LiteralTree<ChatLiteral>,
    /// the filters that should be applied to the email entity (raw AST
    /// tree only; CRM scope is carried by the `ecd` / `eca` sibling
    /// fields). On this endpoint the email filter stays a bare tree,
    /// unlike the materialized [`EntityFilterAst`] used for cursors.
    #[serde(default, rename = "ef")]
    #[schema(value_type = serde_json::Value)]
    pub email_filter: LiteralTree<EmailLiteral>,
    /// the filters that should be applied to the channel entity
    #[serde(default, rename = "chanf")]
    #[schema(value_type = serde_json::Value)]
    pub channel_filter: LiteralTree<ChannelLiteral>,
    /// the filters that should be applied to foreign entity records
    #[serde(default, rename = "fef")]
    #[schema(value_type = serde_json::Value)]
    pub foreign_entity_filter: LiteralTree<ForeignEntityLiteral>,
    /// the filters that should be applied to the call entity
    #[serde(default, rename = "callf")]
    #[schema(value_type = serde_json::Value)]
    pub call_filter: LiteralTree<CallLiteral>,
    /// Filters applied to the crm_company entity (wire key `ccf`).
    /// Empty/omitted = team's full visible list.
    #[serde(default, rename = "ccf")]
    #[schema(value_type = serde_json::Value)]
    pub crm_company_filter: LiteralTree<CrmCompanyLiteral>,
    /// the filters that should be applied based on entity properties
    #[serde(default, rename = "propf")]
    #[schema(value_type = serde_json::Value)]
    pub properties_filter: LiteralTree<PropertiesLiteral>,
    /// CRM-scoped domain filter (wire key: `ecd`). Parallel to the
    /// freeform `ef` AST. Expanded by the router into an any-direction
    /// OR sub-tree AND-merged into `ef`, plus a `CrmScope` tag stamped
    /// on the resulting [`item_filters::ast::EmailFilterAst::crm_scope`].
    /// Drives the per-team CRM authorization pre-check and candidate-set
    /// widening downstream. Mutually exclusive with `eca`.
    #[serde(default, rename = "ecd", skip_serializing_if = "Vec::is_empty")]
    pub email_crm_domains: Vec<String>,
    /// CRM-scoped address filter (wire key: `eca`). Symmetric counterpart
    /// to `ecd` for fully-qualified email addresses.
    #[serde(default, rename = "eca", skip_serializing_if = "Vec::is_empty")]
    pub email_crm_addresses: Vec<String>,
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
            link_ids,
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
            link_ids,
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
            foreign_entity_filter,
            call_filter,
            crm_company_filter,
            properties_filter,
            email_crm_domains,
            email_crm_addresses,
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

        // Build the CRM sub-tree and tag from the typed lists. Mutual
        // exclusivity and per-value validation happen here. We then
        // AND-merge the sub-tree into the freeform `email_filter` AST so
        // the matching SQL works identically to the typed POST path.
        let crm =
            item_filters::ast::email::expand_crm_scope(email_crm_domains, email_crm_addresses)
                .map_err(|e| report!("{e}"))?;

        let (email_tree, crm_scope) = match (email_filter, crm) {
            (Some(existing), Some((crm_tree, scope))) => {
                // The Arc was freshly constructed by serde when this
                // request body deserialized, and has not been cloned
                // since — refcount is 1, so `try_unwrap` always succeeds.
                let existing_owned = Arc::try_unwrap(existing)
                    .map_err(|_| report!("internal: email_filter Arc was unexpectedly shared"))?;
                (
                    Some(Arc::new(Expr::and(existing_owned, crm_tree))),
                    Some(scope),
                )
            }
            (Some(existing), None) => (Some(existing), None),
            (None, Some((crm_tree, scope))) => (Some(Arc::new(crm_tree)), Some(scope)),
            (None, None) => (None, None),
        };

        Ok(EntityFilterAst {
            document_filter,
            project_filter,
            chat_filter,
            email_filter: item_filters::ast::EmailFilterAst {
                tree: email_tree,
                crm_scope,
            },
            channel_filter,
            call_filter,
            crm_company_filter,
            foreign_entity_filter,
            properties_filter,
        })
    }
}
