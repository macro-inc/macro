use std::sync::Arc;

use async_graphql::{Context, EmptyMutation, EmptySubscription, Object, Schema};
use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use models_pagination::TypeEraseCursor;
use soup::domain::{models::SoupRequest, ports::SoupService};

use crate::{
    auth::{
        requests_crm_admin, requests_crm_scope, require_crm_admin_role, resolve_crm_team_receipt,
    },
    inputs::SoupInput,
    objects::SoupPage,
    request_context::GraphqlSoupRequestContext,
};

/// GraphQL Soup schema type.
pub type SoupSchema<S> = Schema<SoupQueryRoot<S>, EmptyMutation, EmptySubscription>;

/// GraphQL Soup schema type backed by a shared soup service.
pub type SharedSoupSchema<S> = SoupSchema<SharedSoupService<S>>;

/// GraphQL Soup schema type backed by the schema-only service.
pub type SchemaOnlySoupSchema = SoupSchema<SchemaOnlySoupService>;

/// Soup service used only to construct the GraphQL schema for SDL export.
#[derive(Clone, Copy, Debug, Default)]
pub struct SchemaOnlySoupService;

impl SoupService for SchemaOnlySoupService {
    async fn get_user_soup<T>(
        &self,
        _req: SoupRequest<T>,
        _team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<soup::domain::ports::SoupOutput<T>, soup::domain::models::SoupErr>
    where
        SoupRequest<T>: soup::domain::models::IntoSoupReqAst,
        T: Clone + serde::Serialize + Send,
    {
        Err(soup::domain::models::SoupErr::CommsErr)
    }

    async fn get_user_soup_grouped(
        &self,
        _req: soup::domain::models::GroupedSortRequest<'_>,
    ) -> Result<Vec<soup::domain::models::GroupedSoupItem>, soup::domain::models::SoupErr> {
        Err(soup::domain::models::SoupErr::CommsErr)
    }

    async fn caller_tag_sets<'a>(
        &self,
        _user_id: macro_user_id::user_id::MacroUserIdStr<'a>,
    ) -> Result<
        Vec<models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions>,
        soup::domain::models::SoupErr,
    > {
        Err(soup::domain::models::SoupErr::CommsErr)
    }
}

/// Object-safe-ish wrapper for sharing a concrete Soup service with GraphQL.
pub struct SharedSoupService<S>(Arc<S>);

impl<S> Clone for SharedSoupService<S> {
    fn clone(&self) -> Self {
        Self(Arc::clone(&self.0))
    }
}

impl<S> SharedSoupService<S> {
    /// Create a shared Soup service wrapper.
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

    async fn caller_tag_sets<'a>(
        &self,
        user_id: macro_user_id::user_id::MacroUserIdStr<'a>,
    ) -> Result<
        Vec<models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions>,
        soup::domain::models::SoupErr,
    > {
        self.0.caller_tag_sets(user_id).await
    }
}

/// Root GraphQL query object for Soup.
pub struct SoupQueryRoot<S> {
    service: S,
}

impl<S> SoupQueryRoot<S> {
    /// Create a root GraphQL query object.
    pub fn new(service: S) -> Self {
        Self { service }
    }
}

/// The authenticated user (viewer). All user-scoped data hangs off this
/// object so clients (and their normalized caches) observe data ownership
/// structurally rather than implicitly through the session.
pub struct GraphqlUser<S> {
    service: S,
}

/// Build a GraphQL schema for Soup suitable for SDL export or introspection.
pub fn build_schema() -> SchemaOnlySoupSchema {
    build_schema_with_service(SchemaOnlySoupService)
}

/// Build a GraphQL schema for Soup backed by the provided service.
pub fn build_schema_with_service<S>(service: S) -> SoupSchema<S>
where
    S: SoupService + Clone,
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
    build_schema_with_service(SharedSoupService::new(service))
}

#[Object]
impl<S> SoupQueryRoot<S>
where
    S: SoupService + Clone,
{
    /// The authenticated user.
    async fn user(&self) -> GraphqlUser<S> {
        GraphqlUser {
            service: self.service.clone(),
        }
    }
}

#[Object(name = "GraphqlUser")]
impl<S> GraphqlUser<S>
where
    S: SoupService,
{
    /// Stable id of the authenticated user.
    async fn id(&self, ctx: &Context<'_>) -> async_graphql::Result<async_graphql::ID> {
        let request_context = ctx.data::<GraphqlSoupRequestContext>()?;
        Ok(async_graphql::ID(request_context.macro_user_id.to_string()))
    }

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
