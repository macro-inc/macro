#[cfg(test)]
mod test;

use std::{marker::PhantomData, sync::Arc};

use async_graphql::{Context, EmptySubscription, Object, Schema};
use axum::extract::FromRef;
use email::{
    domain::ports::{EmailService, NoOpEmailService},
    inbound::axum::previews_router::EmailRouterState,
};
use entity_access::domain::ports::{EntityAccessService, NoOpEntityAccessService};
use graphql_common::require_authorized_user;
use graphql_email::{NoOpSoupEmailContentEdgeReader, SoupEmailContentEdgeReader};
use graphql_notification::{NoOpSoupNotificationEdgeReader, SoupNotificationEdgeReader};
use graphql_properties::{
    EntityPropertyReader, EntityPropertyWriter, NoOpEntityPropertyReader, NoOpEntityPropertyWriter,
    PropertiesMutationRoot,
};
use graphql_soup::{
    GroupedSoup, GroupedSoupInput, SoupInput, SoupPage, resolve_grouped_soup, resolve_soup,
};
use macro_authorization::{
    InternalAuthConfig, MacroAuthorizationService, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, NoopMacroAuthJwtValidator,
};
use soup::domain::ports::{NoOpSoupService, SoupService};

use crate::SoupEdges;

/// GraphQL Soup schema type.
///
/// `S` is the soup service, `E` the email service, `EAS` the entity access
/// service, `Auth` the authorization service, `St` the embedding axum router
/// state, `W` the property mutation writer, `NR` the notification edge reader,
/// `PR` the property edge reader, and `ER` the email-content edge reader.
pub type SoupSchema<S, E, EAS, Auth, St, W, NR, PR, ER> = Schema<
    SoupQueryRoot<S, E, EAS, Auth, St, NR, PR, ER>,
    PropertiesMutationRoot<W>,
    EmptySubscription,
>;

/// GraphQL Soup schema type backed by a shared soup service.
pub type SharedSoupSchema<S, E, EAS, Auth, St, W, NR, PR, ER> =
    SoupSchema<Arc<S>, E, EAS, Auth, St, W, NR, PR, ER>;

/// GraphQL Soup schema type backed by the no-op services, used only for
/// SDL export or introspection.
pub type SchemaOnlySoupSchema = SoupSchema<
    NoOpSoupService,
    NoOpEmailService,
    NoOpEntityAccessService,
    SchemaOnlyAuthorizationService,
    SchemaOnlyState,
    NoOpEntityPropertyWriter,
    NoOpSoupNotificationEdgeReader,
    NoOpEntityPropertyReader,
    NoOpSoupEmailContentEdgeReader,
>;

/// Authorization service used only to construct the GraphQL schema for SDL export.
pub type SchemaOnlyAuthorizationService = MacroAuthorizationServiceImpl<NoopMacroAuthJwtValidator>;

/// Axum-style state used only to construct the GraphQL schema for SDL export.
#[derive(Clone, Copy, Debug, Default)]
pub struct SchemaOnlyState;

impl FromRef<SchemaOnlyState> for EmailRouterState<NoOpEmailService> {
    fn from_ref(_state: &SchemaOnlyState) -> Self {
        EmailRouterState::new(NoOpEmailService)
    }
}

impl FromRef<SchemaOnlyState> for Arc<NoOpEntityAccessService> {
    fn from_ref(_state: &SchemaOnlyState) -> Self {
        Arc::new(NoOpEntityAccessService)
    }
}

impl FromRef<SchemaOnlyState> for MacroAuthorizationState<SchemaOnlyAuthorizationService> {
    fn from_ref(_state: &SchemaOnlyState) -> Self {
        let service = MacroAuthorizationServiceImpl::new(
            NoopMacroAuthJwtValidator,
            InternalAuthConfig {
                api_key: String::new(),
                default_user_id: None,
            },
        );
        MacroAuthorizationState::new(Arc::new(service))
    }
}

/// Zero-sized marker tying the query objects to the adapter, authorization,
/// state, and reader generics without requiring values of those types.
type ServicesMarker<E, EAS, Auth, St, NR, PR, ER> =
    PhantomData<fn() -> (E, EAS, Auth, St, NR, PR, ER)>;

/// Root GraphQL query object for Soup.
pub struct SoupQueryRoot<S, E, EAS, Auth, St, NR, PR, ER> {
    /// Soup domain service used by user-scoped query resolvers.
    service: S,
    /// Associates the root with its adapter and reader types.
    _marker: ServicesMarker<E, EAS, Auth, St, NR, PR, ER>,
}

impl<S, E, EAS, Auth, St, NR, PR, ER> SoupQueryRoot<S, E, EAS, Auth, St, NR, PR, ER> {
    /// Create a root GraphQL query object.
    pub fn new(service: S) -> Self {
        Self {
            service,
            _marker: PhantomData,
        }
    }
}

/// The authenticated user (viewer). All user-scoped data hangs off this
/// object so clients (and their normalized caches) observe data ownership
/// structurally rather than implicitly through the session.
pub struct GraphqlUser<S, E, EAS, Auth, St, NR, PR, ER> {
    /// Soup domain service used by this user's resolvers.
    service: S,
    /// Associates the user object with its adapter and reader types.
    _marker: ServicesMarker<E, EAS, Auth, St, NR, PR, ER>,
}

/// Build a GraphQL schema for Soup suitable for SDL export or introspection.
pub fn build_schema() -> SchemaOnlySoupSchema {
    build_schema_with_service(NoOpSoupService)
}

/// Build a GraphQL schema for Soup backed by the provided service.
pub fn build_schema_with_service<S, E, EAS, Auth, St, W, NR, PR, ER>(
    service: S,
) -> SoupSchema<S, E, EAS, Auth, St, W, NR, PR, ER>
where
    S: SoupService + Clone,
    E: EmailService,
    EAS: EntityAccessService,
    Auth: MacroAuthorizationService,
    St: Clone + Send + Sync + 'static,
    EmailRouterState<E>: FromRef<St>,
    Arc<EAS>: FromRef<St>,
    MacroAuthorizationState<Auth>: FromRef<St>,
    W: EntityPropertyWriter,
    NR: SoupNotificationEdgeReader,
    PR: EntityPropertyReader,
    ER: SoupEmailContentEdgeReader,
{
    Schema::build(
        SoupQueryRoot::new(service),
        PropertiesMutationRoot::<W>::new(),
        EmptySubscription,
    )
    .finish()
}

/// Build a GraphQL schema for Soup backed by an `Arc`-shared service.
pub fn build_schema_from_arc<S, E, EAS, Auth, St, W, NR, PR, ER>(
    service: Arc<S>,
) -> SharedSoupSchema<S, E, EAS, Auth, St, W, NR, PR, ER>
where
    S: SoupService,
    E: EmailService,
    EAS: EntityAccessService,
    Auth: MacroAuthorizationService,
    St: Clone + Send + Sync + 'static,
    EmailRouterState<E>: FromRef<St>,
    Arc<EAS>: FromRef<St>,
    MacroAuthorizationState<Auth>: FromRef<St>,
    W: EntityPropertyWriter,
    NR: SoupNotificationEdgeReader,
    PR: EntityPropertyReader,
    ER: SoupEmailContentEdgeReader,
{
    build_schema_with_service(service)
}

/// Root entry point for the complete GraphQL API.
#[Object]
impl<S, E, EAS, Auth, St, NR, PR, ER> SoupQueryRoot<S, E, EAS, Auth, St, NR, PR, ER>
where
    S: SoupService + Clone,
    E: EmailService,
    EAS: EntityAccessService,
    Auth: MacroAuthorizationService,
    St: Clone + Send + Sync + 'static,
    EmailRouterState<E>: FromRef<St>,
    Arc<EAS>: FromRef<St>,
    MacroAuthorizationState<Auth>: FromRef<St>,
    NR: SoupNotificationEdgeReader,
    PR: EntityPropertyReader,
    ER: SoupEmailContentEdgeReader,
{
    /// The authenticated user.
    async fn user(&self) -> GraphqlUser<S, E, EAS, Auth, St, NR, PR, ER> {
        GraphqlUser {
            service: self.service.clone(),
            _marker: PhantomData,
        }
    }
}

/// The authenticated user and their user-scoped data.
#[Object(name = "GraphqlUser")]
impl<S, E, EAS, Auth, St, NR, PR, ER> GraphqlUser<S, E, EAS, Auth, St, NR, PR, ER>
where
    S: SoupService,
    E: EmailService,
    EAS: EntityAccessService,
    Auth: MacroAuthorizationService,
    St: Clone + Send + Sync + 'static,
    EmailRouterState<E>: FromRef<St>,
    Arc<EAS>: FromRef<St>,
    MacroAuthorizationState<Auth>: FromRef<St>,
    NR: SoupNotificationEdgeReader,
    PR: EntityPropertyReader,
    ER: SoupEmailContentEdgeReader,
{
    /// Stable id of the authenticated user.
    async fn id(&self, ctx: &Context<'_>) -> async_graphql::Result<async_graphql::ID> {
        let macro_user_id = require_authorized_user::<Auth, St>(ctx).await?;
        Ok(async_graphql::ID(macro_user_id.to_string()))
    }

    /// Fetch Soup items nested into grouping bins.
    async fn group_soup(
        &self,
        ctx: &Context<'_>,
        input: GroupedSoupInput,
    ) -> async_graphql::Result<GroupedSoup<SoupEdges<NR, PR, ER>>> {
        resolve_grouped_soup::<S, Auth, St, SoupEdges<NR, PR, ER>>(&self.service, ctx, input).await
    }

    /// Fetch a page of Soup items using the existing Soup filter AST format.
    async fn soup(
        &self,
        ctx: &Context<'_>,
        input: SoupInput,
    ) -> async_graphql::Result<SoupPage<SoupEdges<NR, PR, ER>>> {
        resolve_soup::<S, E, EAS, Auth, St, SoupEdges<NR, PR, ER>>(&self.service, ctx, input).await
    }
}
