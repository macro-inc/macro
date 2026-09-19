use crate::domain::{
    models::{
        EnrichedSoupItem, FrecencyQueryInner, GroupedSortRequest, IntoSoupReqAst,
        NotifiedQueryInner, SimpleQueryInner, SoupErr, SoupItemWithProperties, SoupQuery,
        SoupRequest, SoupSortDirection, SoupType, TouchedQueryInner,
        grouping::{GroupMeta, build_grouped_response},
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
use axum_extra::either::Either4;
use cowlike::CowLike;
use email::{
    domain::{
        models::{EmailErr, PreviewView},
        ports::EmailService,
    },
    inbound::axum::previews_router::EmailRouterState,
};
use entity_access::{
    domain::{
        models::{EntityAccessReceipt, MemberTeamRole},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::OptionalMacroUserTeamExtractorV2,
};
use filter_ast::{Expr, ExprFrame};
use item_filters::{
    EntityFilters,
    ast::{
        EntityFilterAst, ExpandErr, LiteralTree,
        calendar_event::CalendarEventLiteral,
        call::CallLiteral,
        channel::{ChannelLiteral, ChannelThreadLiteral},
        chat::ChatLiteral,
        crm_company::CrmCompanyLiteral,
        document::DocumentLiteral,
        email::EmailLiteral,
        foreign_entity::ForeignEntityLiteral,
        project::ProjectLiteral,
        properties::{PropertiesLiteral, PropertyEntityType},
        reminder::ReminderLiteral,
    },
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use model_error_response::ErrorResponse;
use models_grouping::{GroupByField, GroupingConfig};
use models_pagination::{
    CursorWithValAndFilter, Frecency, NotifiedAt, PaginatedOpaqueCursor, SimpleSortMethod,
    TouchedByMe, TypeEraseCursor,
};
use non_empty::IsEmpty;
use recursion::CollapsibleExt;
use rootcause::{Report, report};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::pin::Pin;
use std::sync::Arc;
use thiserror::Error;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[cfg(test)]
mod tests;

/// Query parameters shared by soup endpoints.
#[derive(Debug, Default, serde::Deserialize, IntoParams, ToSchema)]
#[into_params(parameter_in = Query)]
pub struct Params {
    /// Whether to expand projects. Defaults to true.
    #[serde(default)]
    expand: Option<bool>,
    /// Limit the number of items returned. Defaults to 20. Max 500.
    #[serde(default)]
    limit: Option<u16>,
    /// Sort method. Options are viewed_at, created_at, updated_at,
    /// viewed_updated, frecency, touched_by_me, notified_at. Defaults to
    /// viewed_at.
    #[serde(default)]
    sort_method: Option<SoupApiSort>,
    /// Sort direction. Options are asc, desc. Defaults to desc.
    ///
    /// Re-send this with every page: it is not carried in the cursor.
    ///
    /// Applies to the timestamp sort methods only. `asc` combined with
    /// `frecency` is rejected rather than ignored: frecency pages are ordered
    /// by relevance score and the cursor comparison assumes descending, so
    /// there is no ascending frecency order to give.
    #[serde(default)]
    sort_direction: Option<SoupApiSortDirection>,
}

/// Sort direction accepted by non-grouped soup API endpoints.
#[derive(Debug, Clone, Copy, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SoupApiSortDirection {
    /// Oldest, or soonest-firing, first.
    Asc,
    /// Newest first.
    Desc,
}

impl From<SoupApiSortDirection> for SoupSortDirection {
    fn from(value: SoupApiSortDirection) -> Self {
        match value {
            SoupApiSortDirection::Asc => SoupSortDirection::Asc,
            SoupApiSortDirection::Desc => SoupSortDirection::Desc,
        }
    }
}

/// Sort options accepted by non-grouped soup API endpoints.
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SoupApiSort {
    /// Sort by last viewed time.
    ViewedAt,
    /// Sort by creation time.
    CreatedAt,
    /// Sort by last update time.
    UpdatedAt,
    /// Sort by viewed and updated activity.
    ViewedUpdated,
    /// Sort by frecency score.
    Frecency,
    /// Only entities the caller has mutated, newest own-mutation first.
    /// Both a filter and an ordering: views don't count, and entities the
    /// caller never touched are absent.
    TouchedByMe,
    /// Only entities the caller holds a notification for, most recently
    /// notified first. Both a filter and an ordering: entities the caller
    /// was never notified about are absent. Thread-scoped channel
    /// notifications surface as channel-thread rows; calls and CRM
    /// companies never appear.
    NotifiedAt,
}

impl SoupApiSort {
    /// Builds the initial query for this sort method over the given filters.
    fn into_query<R>(self, filters: R) -> SoupQuery<R> {
        match self {
            SoupApiSort::ViewedAt => {
                SoupQuery::new_sort_simple(SimpleSortMethod::ViewedAt, filters)
            }
            SoupApiSort::CreatedAt => {
                SoupQuery::new_sort_simple(SimpleSortMethod::CreatedAt, filters)
            }
            SoupApiSort::UpdatedAt => {
                SoupQuery::new_sort_simple(SimpleSortMethod::UpdatedAt, filters)
            }
            SoupApiSort::ViewedUpdated => {
                SoupQuery::new_sort_simple(SimpleSortMethod::ViewedUpdated, filters)
            }
            SoupApiSort::Frecency => SoupQuery::new_sort_frecency(Frecency, filters),
            SoupApiSort::TouchedByMe => SoupQuery::new_sort_touched(filters),
            SoupApiSort::NotifiedAt => SoupQuery::new_sort_notified(filters),
        }
    }
}

/// Sort method for grouped queries (frecency not supported).
#[derive(Debug, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum GroupedSoupSort {
    /// Sort by last viewed time.
    ViewedAt,
    /// Sort by creation time.
    CreatedAt,
    /// Sort by last update time.
    UpdatedAt,
    /// Sort by viewed and updated activity.
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

/// Response page for non-grouped soup endpoints.
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
    /// Initial grouped response containing multiple groups.
    Initial(GroupedSoupInitialPage),
    /// Follow-up response for one specific group.
    GroupPage(GroupedSoupGroupPage),
}

struct ApiGroupedSoupParts {
    items: HashMap<Uuid, SoupApiItem>,
    groups: Vec<ApiGroupMeta>,
}

/// Reader used to flag soup items that the requesting user (or their team)
/// has favorited. Object-safe so the router state can hold it without an
/// extra generic; the concrete impl is provided by the mounting service.
pub trait SoupFavoritesReader: Send + Sync + 'static {
    /// Of the given entities, return the subset favorited by the user or
    /// the user's team.
    fn favorited_entities<'a>(
        &'a self,
        user_id: &'a str,
        entities: Vec<Entity<'static>>,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<HashSet<Entity<'static>>>> + Send + 'a>>;
}

/// Default [SoupFavoritesReader] that marks nothing as favorited.
pub struct NoFavoritesReader;

impl SoupFavoritesReader for NoFavoritesReader {
    fn favorited_entities<'a>(
        &'a self,
        _user_id: &'a str,
        _entities: Vec<Entity<'static>>,
    ) -> Pin<Box<dyn Future<Output = anyhow::Result<HashSet<Entity<'static>>>> + Send + 'a>> {
        Box::pin(async { Ok(HashSet::new()) })
    }
}

/// Shared state for soup API routes.
pub struct SoupRouterState<T, U, EAS, Auth> {
    service: Arc<T>,
    email: EmailRouterState<U>,
    entity_access_service: Arc<EAS>,
    authorization: MacroAuthorizationState<Auth>,
    favorites: Arc<dyn SoupFavoritesReader>,
}

impl<T, U, EAS, Auth> Clone for SoupRouterState<T, U, EAS, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            email: self.email.clone(),
            entity_access_service: self.entity_access_service.clone(),
            authorization: self.authorization.clone(),
            favorites: self.favorites.clone(),
        }
    }
}

impl<T, U, EAS, Auth> FromRef<SoupRouterState<T, U, EAS, Auth>> for EmailRouterState<U> {
    fn from_ref(input: &SoupRouterState<T, U, EAS, Auth>) -> Self {
        input.email.clone()
    }
}

impl<T, U, EAS, Auth> FromRef<SoupRouterState<T, U, EAS, Auth>> for Arc<EAS> {
    fn from_ref(input: &SoupRouterState<T, U, EAS, Auth>) -> Self {
        input.entity_access_service.clone()
    }
}

impl<T, U, EAS, Auth> FromRef<SoupRouterState<T, U, EAS, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(input: &SoupRouterState<T, U, EAS, Auth>) -> Self {
        input.authorization.clone()
    }
}

impl<T, U, EAS, Auth> SoupRouterState<T, U, EAS, Auth>
where
    T: SoupService,
    U: EmailService,
    EAS: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    /// Creates router state from the soup service, email service, entity access service, and authorization state.
    pub fn new(
        service: T,
        email: U,
        entity_access_service: Arc<EAS>,
        authorization: MacroAuthorizationState<Auth>,
    ) -> Self {
        Self::from_arc(
            Arc::new(service),
            email,
            entity_access_service,
            authorization,
        )
    }

    /// Creates router state from shared soup and entity access services, an email service, and authorization state.
    pub fn from_arc(
        service: Arc<T>,
        email: U,
        entity_access_service: Arc<EAS>,
        authorization: MacroAuthorizationState<Auth>,
    ) -> Self {
        SoupRouterState {
            service,
            email: EmailRouterState::new(email),
            entity_access_service,
            authorization,
            favorites: Arc::new(NoFavoritesReader),
        }
    }

    /// Attach a [SoupFavoritesReader] used to populate `is_favorited` on
    /// returned soup items.
    pub fn with_favorites_reader(mut self, favorites: Arc<dyn SoupFavoritesReader>) -> Self {
        self.favorites = favorites;
        self
    }

    /// Returns an `Arc` to the inner soup service.
    pub fn service(&self) -> Arc<T> {
        Arc::clone(&self.service)
    }

    /// Returns an `Arc` to the inner email service.
    pub fn email_service(&self) -> Arc<U> {
        self.email.service()
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
        R: Clone + Serialize + Send,
    {
        let user_for_favorites = macro_user_id.copied().into_owned();
        let sort_direction: SoupSortDirection =
            params.sort_direction.map(Into::into).unwrap_or_default();
        let create_fallback = move || -> SoupQuery<R> {
            params
                .sort_method
                .unwrap_or(SoupApiSort::ViewedAt)
                .into_query(filters)
        };

        let cursor: SoupQuery<R> = match cursor {
            Either4::E1(l) => l
                .map(SoupQuery::new_cursor_simple)
                .unwrap_or_else(create_fallback),
            Either4::E2(r) => r
                .map(SoupQuery::new_cursor_frecency)
                .unwrap_or_else(create_fallback),
            Either4::E3(t) => t
                .map(SoupQuery::new_cursor_touched)
                .unwrap_or_else(create_fallback),
            Either4::E4(n) => n
                .map(SoupQuery::new_cursor_notified)
                .unwrap_or_else(create_fallback),
        };

        // Frecency pages are ordered by relevance score, touched pages by the
        // caller's own latest mutation and notified pages by their latest
        // notification; none of those branches applies the merged sort the
        // direction would flip. Rejecting beats accepting the parameter and
        // silently doing nothing with it. Checked against the resolved query
        // so a *cursor* of those kinds is caught too, not just an initial
        // request naming the method.
        if sort_direction == SoupSortDirection::Asc {
            match &cursor {
                SoupQuery::Frecency(_) => {
                    return Err(SoupHandlerErr::AscendingFrecencyUnsupported);
                }
                SoupQuery::Touched(_) => {
                    return Err(SoupHandlerErr::AscendingTouchedUnsupported);
                }
                SoupQuery::Notified(_) => {
                    return Err(SoupHandlerErr::AscendingNotifiedUnsupported);
                }
                SoupQuery::Simple(_) => {}
            }
        }

        // CRM authorization (team membership for CRM scope, admin/owner
        // role for hidden companies) is enforced by the soup domain and
        // CRM service from the receipt itself; the router just forwards
        // whatever membership the extractor resolved.
        let res = self
            .service
            .get_user_soup_with_properties_and_frecency(
                SoupRequest {
                    soup_type: match params.expand {
                        Some(true) | None => SoupType::Expanded,
                        Some(false) => SoupType::UnExpanded,
                    },
                    limit: params.limit.unwrap_or(20),
                    cursor,
                    sort_direction,
                    user: macro_user_id,
                    email_preview_view: email_view,
                    link_ids,
                },
                team_receipt_option,
            )
            .await?;

        let mut page = res.type_erase().map(SoupApiItem::from_frecency_soup_item);
        mark_favorited(&*self.favorites, &user_for_favorites, page.items.iter_mut()).await;

        Ok(Json(page))
    }

    async fn handle_grouped(
        &self,
        macro_user_id: MacroUserIdStr<'static>,
        filters: EntityFilterAst,
        params: GroupedParams,
        cursor: Option<CursorWithValAndFilter<Uuid, SimpleSortMethod, EntityFilterAst>>,
    ) -> Result<ApiGroupedSoupParts, SoupHandlerErr> {
        let user_for_favorites = macro_user_id.copied().into_owned();
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

        let mut items: HashMap<Uuid, SoupApiItem> = response
            .items
            .into_iter()
            .map(|(id, item)| (id, SoupApiItem::from_frecency_soup_item(item)))
            .collect();
        mark_favorited(&*self.favorites, &user_for_favorites, items.values_mut()).await;

        Ok(ApiGroupedSoupParts {
            items,
            groups: response
                .groups
                .into_iter()
                .map(ApiGroupMeta::from)
                .collect(),
        })
    }
}

/// Builds the Axum router for soup HTTP endpoints.
pub fn soup_router<T, U, EAS, Auth, S>(state: SoupRouterState<T, U, EAS, Auth>) -> Router<S>
where
    T: SoupService,
    U: EmailService,
    EAS: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Send + Sync,
{
    Router::new()
        .route("/soup", get(get_soup_handler::<T, U, EAS, Auth>))
        .route("/soup", post(post_soup_handler::<T, U, EAS, Auth>))
        .route("/soup/ast", post(post_soup_ast_handler::<T, U, EAS, Auth>))
        .route(
            "/soup/ast/grouped",
            post(post_grouped_soup_ast_handler::<T, U, EAS, Auth>),
        )
        .with_state(state)
}

/// API representation of a soup item with its per-viewer enrichments.
#[derive(Debug, Serialize, utoipa::ToSchema)]
pub struct SoupApiItem {
    #[serde(flatten)]
    item: SoupItemWithProperties,
    frecency_score: f64,
    /// The caller's latest own mutation of this entity, present only when the
    /// page was ordered by `touched_by_me`. Clients keep the touched feed
    /// ordered on this value, so it can be bumped optimistically.
    #[serde(skip_serializing_if = "Option::is_none")]
    touched_at: Option<chrono::DateTime<chrono::Utc>>,
    /// When the caller was last notified about this entity, present only
    /// when the page was ordered by `notified_at`. Clients keep the notified
    /// feed ordered and date-bucketed on this value.
    #[serde(skip_serializing_if = "Option::is_none")]
    notified_at: Option<chrono::DateTime<chrono::Utc>>,
    /// Whether the requesting user has favorited this entity.
    is_favorited: bool,
}

impl SoupApiItem {
    fn from_frecency_soup_item(item: EnrichedSoupItem) -> Self {
        let EnrichedSoupItem {
            item,
            frecency_score,
            touched_at,
            notified_at,
            ..
        } = item;
        SoupApiItem {
            item,
            frecency_score: frecency_score
                .map(|f| f.data.frecency_score)
                .unwrap_or_default(),
            touched_at,
            notified_at,
            is_favorited: false,
        }
    }
}

/// Populate `is_favorited` on the given items from one batched favorites
/// lookup. A lookup failure leaves every flag `false` rather than failing
/// the soup query.
async fn mark_favorited<'a>(
    favorites: &dyn SoupFavoritesReader,
    user_id: &MacroUserIdStr<'_>,
    items: impl Iterator<Item = &'a mut SoupApiItem>,
) {
    let items: Vec<&mut SoupApiItem> = items.collect();
    if items.is_empty() {
        return;
    }
    let entities = items.iter().map(|i| i.item.entity()).collect();
    match favorites
        .favorited_entities(user_id.as_ref(), entities)
        .await
    {
        Ok(favorited) => {
            for item in items {
                item.is_favorited = favorited.contains(&item.item.entity());
            }
        }
        Err(error) => {
            tracing::error!(error=?error, "failed to resolve favorited soup items");
        }
    }
}

/// Errors returned by soup HTTP handlers.
#[derive(Debug, Error)]
pub enum SoupHandlerErr {
    /// Internal soup service error.
    #[error("An internal server error has occurred")]
    Internal(SoupErr),
    /// Internal email service error.
    #[error("An internal email server error has occurred")]
    EmailErr(#[from] EmailErr),
    /// Invalid filter AST expansion.
    #[error("Invalid filter arguments provided")]
    ExpandErr(ExpandErr),
    /// Invalid compound filter expansion.
    #[error("Invalid compound filter could not be expanded")]
    Expand,
    /// CRM-scoped query was requested without team membership.
    #[error("CRM-scoped queries require team membership")]
    CrmScopeForbidden,
    /// Hidden CRM company query was requested without admin privileges.
    #[error("Querying hidden CRM companies requires admin/owner team role")]
    CrmAdminRequired,
    /// Ascending order was requested for a frecency-sorted query.
    #[error("sort_direction=asc is not supported with sort_method=frecency")]
    AscendingFrecencyUnsupported,
    /// Ascending order was requested for a touched-by-me query.
    #[error("sort_direction=asc is not supported with sort_method=touched_by_me")]
    AscendingTouchedUnsupported,
    /// A touched-by-me query carried a filter kind the mode cannot evaluate.
    #[error("sort_method=touched_by_me does not support {0} filters")]
    TouchedUnsupportedFilter(&'static str),
    /// Ascending order was requested for a notified-at query.
    #[error("sort_direction=asc is not supported with sort_method=notified_at")]
    AscendingNotifiedUnsupported,
    /// A notified-at query carried a filter kind the mode cannot evaluate.
    #[error("sort_method=notified_at does not support {0} filters")]
    NotifiedUnsupportedFilter(&'static str),
}

impl From<SoupErr> for SoupHandlerErr {
    fn from(value: SoupErr) -> Self {
        match value {
            SoupErr::AstErr(expand_err) => SoupHandlerErr::ExpandErr(expand_err),
            SoupErr::CrmTeamRequired => SoupHandlerErr::CrmScopeForbidden,
            SoupErr::CrmAdminRequired => SoupHandlerErr::CrmAdminRequired,
            SoupErr::TouchedUnsupportedFilter(kind) => {
                SoupHandlerErr::TouchedUnsupportedFilter(kind)
            }
            SoupErr::NotifiedUnsupportedFilter(kind) => {
                SoupHandlerErr::NotifiedUnsupportedFilter(kind)
            }
            err => SoupHandlerErr::Internal(err),
        }
    }
}

impl IntoResponse for SoupHandlerErr {
    fn into_response(self) -> axum::response::Response {
        let status_code = match &self {
            SoupHandlerErr::ExpandErr(_)
            | SoupHandlerErr::Expand
            | SoupHandlerErr::AscendingFrecencyUnsupported
            | SoupHandlerErr::AscendingTouchedUnsupported
            | SoupHandlerErr::TouchedUnsupportedFilter(_)
            | SoupHandlerErr::AscendingNotifiedUnsupported
            | SoupHandlerErr::NotifiedUnsupportedFilter(_) => StatusCode::BAD_REQUEST,
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

async fn fetch_caller_link_ids<T, U, EAS, Auth>(
    service: &SoupRouterState<T, U, EAS, Auth>,
    macro_user_id: &str,
) -> Result<Vec<Uuid>, SoupHandlerErr>
where
    T: SoupService,
    U: EmailService,
    EAS: EntityAccessService,
    Auth: MacroAuthorizationService,
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
pub async fn get_soup_handler<T, U, EAS, Auth>(
    State(service): State<SoupRouterState<T, U, EAS, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    team: OptionalMacroUserTeamExtractorV2<MemberTeamRole, EAS, Auth>,
    Query(params): Query<Params>,
    cursor: SoupCursor<EntityFilters>,
) -> Result<Json<PaginatedOpaqueCursor<SoupApiItem>>, SoupHandlerErr>
where
    T: SoupService,
    U: EmailService,
    EAS: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let macro_user_id = authorization.authorization.user.macro_user_id;
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

/// Request body for the typed soup endpoint.
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

type SoupCursor<R> = Either4<
    Option<CursorWithValAndFilter<Uuid, SimpleSortMethod, R>>,
    Option<CursorWithValAndFilter<Uuid, Frecency, R>>,
    // String id, not Uuid: the touched keyset compares the raw stored
    // entity id byte-for-byte, so the cursor must not canonicalize it.
    Option<CursorWithValAndFilter<String, TouchedByMe, R>>,
    // Same value shape as the touched cursor; its `"notified_at"` sort
    // marker (touched serializes `null`) is what keeps it out of arm 3.
    Option<CursorWithValAndFilter<String, NotifiedAt, R>>,
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
pub async fn post_soup_handler<T, U, EAS, Auth>(
    State(service): State<SoupRouterState<T, U, EAS, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    team: OptionalMacroUserTeamExtractorV2<MemberTeamRole, EAS, Auth>,
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
    Auth: MacroAuthorizationService,
{
    let macro_user_id = authorization.authorization.user.macro_user_id;
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

/// Request body for the AST soup endpoint.
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
pub async fn post_soup_ast_handler<T, U, EAS, Auth>(
    State(service): State<SoupRouterState<T, U, EAS, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    team: OptionalMacroUserTeamExtractorV2<MemberTeamRole, EAS, Auth>,
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
    Auth: MacroAuthorizationService,
{
    let macro_user_id = authorization.authorization.user.macro_user_id;
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
    /// Initial grouped soup request.
    Initial(PostGroupedSoupAstInitialRequest),
    /// Request for a page within one group.
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
pub async fn post_grouped_soup_ast_handler<T, U, EAS, Auth>(
    State(service): State<SoupRouterState<T, U, EAS, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    cursor: Option<CursorWithValAndFilter<Uuid, SimpleSortMethod, EntityFilterAst>>,
    Json(request): Json<PostGroupedSoupAstRequest>,
) -> Result<Json<GroupedSoupPage>, SoupHandlerErr>
where
    T: SoupService,
    U: EmailService,
    EAS: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let macro_user_id = authorization.authorization.user.macro_user_id;
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

/// Wire-format entity filter AST accepted by soup AST endpoints.
#[derive(Debug, Default, Serialize, Deserialize, Clone, ToSchema)]
pub struct ApiEntityFilterAst {
    /// filters applied to canonical calendar events
    #[serde(default, rename = "calf")]
    #[schema(value_type = serde_json::Value)]
    pub calendar_event_filter: LiteralTree<CalendarEventLiteral>,
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
    /// the filters that should be applied to the channel-thread entity
    #[serde(default, rename = "cthf")]
    #[schema(value_type = serde_json::Value)]
    pub channel_thread_filter: LiteralTree<ChannelThreadLiteral>,
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
    /// Filters applied to reminders (wire key `remf`). Unlike every other
    /// filter here, empty/omitted returns **no** reminders: they are opt-in,
    /// so the caller must send `inc`, an id, or an entity to get any.
    #[serde(default, rename = "remf")]
    #[schema(value_type = serde_json::Value)]
    pub reminder_filter: LiteralTree<ReminderLiteral>,
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

/// Document literal accepted by the soup AST API.
#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(untagged)]
pub enum ApiDocumentLiteral {
    /// A plain document filter literal.
    Plain(DocumentLiteral),
    /// A compound literal for document file associations.
    FileAssoc(CompoundDocumentLiteral),
}

/// Compound document filter literal accepted by the soup AST API.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum CompoundDocumentLiteral {
    /// Match documents associated with a file id.
    #[serde(rename = "fa")]
    FileAssoc(String),
}

impl IntoSoupReqAst for SoupRequest<ApiEntityFilterAst> {
    fn into_ast(self) -> Result<SoupRequest<Option<EntityFilterAst>>, ExpandErr> {
        let SoupRequest {
            soup_type,
            limit,
            cursor,
            sort_direction,
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
            SoupQuery::Touched(TouchedQueryInner(query)) => SoupQuery::Touched(TouchedQueryInner(
                query.try_map_filter(ApiEntityFilterAst::into_optional_entity_ast)?,
            )),
            SoupQuery::Notified(NotifiedQueryInner(query)) => {
                SoupQuery::Notified(NotifiedQueryInner(
                    query.try_map_filter(ApiEntityFilterAst::into_optional_entity_ast)?,
                ))
            }
        };

        Ok(SoupRequest {
            soup_type,
            limit,
            cursor,
            sort_direction,
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
            calendar_event_filter,
            document_filter,
            project_filter,
            chat_filter,
            email_filter,
            channel_filter,
            channel_thread_filter,
            foreign_entity_filter,
            call_filter,
            crm_company_filter,
            reminder_filter,
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
                // Callers may hold other clones of this Arc (the soup
                // service clones the request filters before expansion),
                // so fall back to cloning the tree when it's shared.
                let existing_owned = Arc::unwrap_or_clone(existing);
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
            calendar_event_filter,
            document_filter,
            project_filter,
            chat_filter,
            email_filter: item_filters::ast::EmailFilterAst {
                tree: email_tree,
                crm_scope,
            },
            channel_filter,
            channel_thread_filter,
            call_filter,
            crm_company_filter,
            foreign_entity_filter,
            reminder_filter,
            properties_filter,
        })
    }
}
