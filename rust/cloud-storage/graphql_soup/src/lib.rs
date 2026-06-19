//! GraphQL inbound adapter for Soup.
//!
//! This crate is intentionally additive: it maps GraphQL requests onto the
//! existing `soup` domain service without changing the existing REST API.

use async_graphql::{
    Context, EmptyMutation, EmptySubscription, Enum, Json, Object, Schema, SimpleObject,
};
use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use filter_ast::Expr;
use item_filters::ast::{EntityFilterAst, crm_company::CrmCompanyLiteral};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use models_pagination::{
    Base64Str, CursorWithValAndFilter, PaginatedOpaqueCursor, SimpleSortMethod, TypeEraseCursor,
};
use serde_json::Value;
use soup::domain::{
    models::{FrecencySoupItem, SoupQuery, SoupRequest, SoupType},
    ports::SoupService,
};
use std::sync::Arc;
use uuid::Uuid;

/// Request-scoped data required to execute a Soup GraphQL query.
///
/// The embedding Axum/service layer remains responsible for authentication and
/// for resolving inbox link IDs. This keeps `graphql_soup` independent from the
/// existing REST extractors.
#[derive(Clone)]
pub struct GraphqlSoupRequestContext {
    pub macro_user_id: MacroUserIdStr<'static>,
    pub link_ids: Vec<Uuid>,
    pub team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
}

/// GraphQL Soup schema type.
pub type SoupSchema<S> = Schema<SoupQueryRoot<S>, EmptyMutation, EmptySubscription>;

/// GraphQL Soup schema type backed by a shared soup service.
pub type SharedSoupSchema<S> = SoupSchema<SharedSoupService<S>>;

/// Object-safe-ish wrapper for sharing a concrete Soup service with GraphQL.
#[derive(Clone)]
pub struct SharedSoupService<S>(Arc<S>);

impl<S> SharedSoupService<S> {
    pub fn new(service: Arc<S>) -> Self {
        Self(service)
    }
}

impl<S> SoupService for SharedSoupService<S>
where
    S: SoupService,
{
    async fn get_user_soup<T>(
        &self,
        req: SoupRequest<T>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<soup::domain::ports::SoupOutput<T>, soup::domain::models::SoupErr>
    where
        SoupRequest<T>: soup::domain::models::IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        self.0.get_user_soup(req, team_receipt).await
    }

    async fn get_user_soup_grouped(
        &self,
        req: soup::domain::models::GroupedSortRequest<'_>,
    ) -> Result<Vec<soup::domain::models::GroupedSoupItem>, soup::domain::models::SoupErr> {
        self.0.get_user_soup_grouped(req).await
    }
}

/// Root GraphQL query object for Soup.
pub struct SoupQueryRoot<S> {
    service: S,
}

impl<S> SoupQueryRoot<S> {
    pub fn new(service: S) -> Self {
        Self { service }
    }
}

/// Build a GraphQL schema for Soup backed by the provided service.
pub fn build_schema<S>(service: S) -> SoupSchema<S>
where
    S: SoupService,
{
    Schema::build(
        SoupQueryRoot::new(service),
        EmptyMutation,
        EmptySubscription,
    )
    .finish()
}

/// Build a GraphQL schema for Soup backed by an `Arc`-shared service.
pub fn build_schema_from_arc<S>(service: Arc<S>) -> SharedSoupSchema<S>
where
    S: SoupService,
{
    build_schema(SharedSoupService::new(service))
}

#[Object]
impl<S> SoupQueryRoot<S>
where
    S: SoupService,
{
    /// Fetch a page of Soup items using the existing Soup filter AST format.
    async fn soup(&self, ctx: &Context<'_>, input: SoupInput) -> async_graphql::Result<SoupPage> {
        let request_context = ctx.data::<GraphqlSoupRequestContext>()?;
        let request = input.into_request(request_context)?;

        let effective_filter = request.cursor.filter();
        let team_receipt = resolve_crm_team_receipt(
            requests_crm_scope(effective_filter),
            request_context.team_receipt.clone(),
        )?;
        require_crm_admin_role(requests_crm_admin(effective_filter), &team_receipt)?;

        let page = self.service.get_user_soup(request, team_receipt).await?;
        Ok(SoupPage::from(page.type_erase()))
    }
}

/// Input for `Query.soup`.
#[derive(async_graphql::InputObject)]
pub struct SoupInput {
    /// Maximum number of items to return. Defaults to 20, max 500.
    pub limit: Option<u16>,
    /// Whether to return expanded Soup items. Defaults to true.
    pub expand: Option<bool>,
    /// Simple timestamp sort. Defaults to VIEWED_AT. Frecency is intentionally
    /// not supported by this initial GraphQL adapter.
    pub sort_method: Option<GraphqlSimpleSortMethod>,
    /// Opaque cursor returned by a previous GraphQL Soup response.
    pub cursor: Option<String>,
    /// Existing Soup AST filter payload, represented as GraphQL JSON.
    pub filters: Option<Json<EntityFilterAst>>,
}

impl SoupInput {
    fn into_request(
        self,
        request_context: &GraphqlSoupRequestContext,
    ) -> async_graphql::Result<SoupRequest<EntityFilterAst>> {
        let filter = self.filters.map(|Json(filter)| filter).unwrap_or_default();
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

/// GraphQL representation of supported simple Soup sorts.
#[derive(Enum, Copy, Clone, Eq, PartialEq)]
pub enum GraphqlSimpleSortMethod {
    ViewedAt,
    CreatedAt,
    UpdatedAt,
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

/// Page returned by `Query.soup`.
#[derive(SimpleObject)]
pub struct SoupPage {
    pub items: Vec<GraphqlSoupItem>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
}

impl From<PaginatedOpaqueCursor<FrecencySoupItem>> for SoupPage {
    fn from(page: PaginatedOpaqueCursor<FrecencySoupItem>) -> Self {
        let has_more = page.next_cursor.is_some();
        Self {
            items: page.items.into_iter().map(GraphqlSoupItem::from).collect(),
            next_cursor: page.next_cursor,
            has_more,
        }
    }
}

/// Initial GraphQL Soup item representation.
///
/// `raw` preserves the current Soup JSON shape so the frontend can adopt this
/// endpoint incrementally before we add a fully typed GraphQL union.
#[derive(SimpleObject)]
pub struct GraphqlSoupItem {
    pub id: String,
    pub entity_type: String,
    pub frecency_score: f64,
    pub raw: Json<Value>,
}

impl From<FrecencySoupItem> for GraphqlSoupItem {
    fn from(item: FrecencySoupItem) -> Self {
        let FrecencySoupItem {
            item,
            frecency_score,
            ..
        } = item;
        let entity = item.entity();
        let raw = serde_json::to_value(&item).unwrap_or(Value::Null);

        Self {
            id: entity.entity_id.into_owned(),
            entity_type: entity_type_name(entity.entity_type).to_owned(),
            frecency_score: frecency_score
                .map(|f| f.data.frecency_score)
                .unwrap_or_default(),
            raw: Json(raw),
        }
    }
}

fn entity_type_name(entity_type: EntityType) -> &'static str {
    match entity_type {
        EntityType::Document => "document",
        EntityType::Chat => "chat",
        EntityType::Project => "project",
        EntityType::EmailThread => "email_thread",
        EntityType::Channel => "channel",
        EntityType::ChannelMessage => "channel_message",
        EntityType::Call => "call",
        EntityType::CrmCompany => "crm_company",
        EntityType::ForeignEntity => "foreign_entity",
        _ => "unknown",
    }
}

fn resolve_crm_team_receipt(
    crm_scope_requested: bool,
    receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
) -> async_graphql::Result<Option<EntityAccessReceipt<MemberTeamRole>>> {
    if crm_scope_requested && receipt.is_none() {
        return Err(async_graphql::Error::new(
            "CRM-scoped queries require team membership",
        ));
    }
    Ok(receipt)
}

fn require_crm_admin_role(
    admin_requested: bool,
    receipt: &Option<EntityAccessReceipt<MemberTeamRole>>,
) -> async_graphql::Result<()> {
    if !admin_requested {
        return Ok(());
    }
    let Some(receipt) = receipt else {
        return Err(async_graphql::Error::new(
            "Querying hidden CRM companies requires admin/owner team role",
        ));
    };
    if !receipt
        .entity_permission()
        .satisfies::<entity_access::domain::models::AdminTeamRole>()
    {
        return Err(async_graphql::Error::new(
            "Querying hidden CRM companies requires admin/owner team role",
        ));
    }
    Ok(())
}

fn requests_crm_scope(filter: &EntityFilterAst) -> bool {
    filter.email_filter.crm_scope.is_some()
}

fn requests_crm_admin(filter: &EntityFilterAst) -> bool {
    filter
        .crm_company_filter
        .as_deref()
        .is_some_and(ast_requests_crm_admin)
}

fn ast_requests_crm_admin(expr: &Expr<CrmCompanyLiteral>) -> bool {
    match expr {
        Expr::Literal(CrmCompanyLiteral::Hidden(_)) => true,
        Expr::And(a, b) | Expr::Or(a, b) => ast_requests_crm_admin(a) || ast_requests_crm_admin(b),
        Expr::Not(a) => ast_requests_crm_admin(a),
        _ => false,
    }
}
