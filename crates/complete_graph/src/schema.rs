#[cfg(test)]
mod test;

use std::{marker::PhantomData, sync::Arc};

use async_graphql::{Context, EmptySubscription, Object, Schema};
use axum::extract::FromRef;
use axum_extra::extract::Cached;
use email::{
    domain::ports::{EmailService, NoOpEmailService},
    inbound::axum::previews_router::EmailRouterState,
};
use entity_access::domain::ports::{EntityAccessService, NoOpEntityAccessService};
use graphql_common::extract_part;
use graphql_notification::{NoOpSoupNotificationEdgeReader, SoupNotificationEdgeReader};
use graphql_properties::{
    EntityPropertyWriter, NoOpEntityPropertyWriter, NoOpSoupPropertyEdgeReader,
    PropertiesMutationRoot, SoupPropertyEdgeReader,
};
use graphql_soup::{SharedSoupService, SoupInput, SoupPage, resolve_soup};
use model_user::axum_extractor::MacroUserExtractor;
use soup::domain::ports::{NoOpSoupService, SoupService};

use crate::SoupEdges;

/// GraphQL Soup schema type.
///
/// `S` is the soup service, `E` the email service, `EAS` the entity access
/// service, `St` the embedding axum router state, `W` the property mutation
/// writer, `NR` the notification edge reader, and `PR` the property edge
/// reader.
pub type SoupSchema<S, E, EAS, St, W, NR, PR> =
    Schema<SoupQueryRoot<S, E, EAS, St, NR, PR>, PropertiesMutationRoot<W>, EmptySubscription>;

/// GraphQL Soup schema type backed by a shared soup service.
pub type SharedSoupSchema<S, E, EAS, St, W, NR, PR> =
    SoupSchema<SharedSoupService<S>, E, EAS, St, W, NR, PR>;

/// GraphQL Soup schema type backed by the no-op services, used only for
/// SDL export or introspection.
pub type SchemaOnlySoupSchema = SoupSchema<
    NoOpSoupService,
    NoOpEmailService,
    NoOpEntityAccessService,
    SchemaOnlyState,
    NoOpEntityPropertyWriter,
    NoOpSoupNotificationEdgeReader,
    NoOpSoupPropertyEdgeReader,
>;

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

/// Zero-sized marker tying the query objects to the email/entity-access/state
/// generics without requiring values of those types.
type ServicesMarker<E, EAS, St, NR, PR> = PhantomData<fn() -> (E, EAS, St, NR, PR)>;

/// Root GraphQL query object for Soup.
pub struct SoupQueryRoot<S, E, EAS, St, NR, PR> {
    service: S,
    _marker: ServicesMarker<E, EAS, St, NR, PR>,
}

impl<S, E, EAS, St, NR, PR> SoupQueryRoot<S, E, EAS, St, NR, PR> {
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
pub struct GraphqlUser<S, E, EAS, St, NR, PR> {
    service: S,
    _marker: ServicesMarker<E, EAS, St, NR, PR>,
}

/// Build a GraphQL schema for Soup suitable for SDL export or introspection.
pub fn build_schema() -> SchemaOnlySoupSchema {
    build_schema_with_service(NoOpSoupService)
}

/// Build a GraphQL schema for Soup backed by the provided service.
pub fn build_schema_with_service<S, E, EAS, St, W, NR, PR>(
    service: S,
) -> SoupSchema<S, E, EAS, St, W, NR, PR>
where
    S: SoupService + Clone,
    E: EmailService,
    EAS: EntityAccessService,
    St: Clone + Send + Sync + 'static,
    EmailRouterState<E>: FromRef<St>,
    Arc<EAS>: FromRef<St>,
    W: EntityPropertyWriter,
    NR: SoupNotificationEdgeReader,
    PR: SoupPropertyEdgeReader,
{
    Schema::build(
        SoupQueryRoot::new(service),
        PropertiesMutationRoot::<W>::new(),
        EmptySubscription,
    )
    .finish()
}

/// Build a GraphQL schema for Soup backed by an `Arc`-shared service.
pub fn build_schema_from_arc<S, E, EAS, St, W, NR, PR>(
    service: Arc<S>,
) -> SharedSoupSchema<S, E, EAS, St, W, NR, PR>
where
    S: SoupService,
    E: EmailService,
    EAS: EntityAccessService,
    St: Clone + Send + Sync + 'static,
    EmailRouterState<E>: FromRef<St>,
    Arc<EAS>: FromRef<St>,
    W: EntityPropertyWriter,
    NR: SoupNotificationEdgeReader,
    PR: SoupPropertyEdgeReader,
{
    build_schema_with_service(SharedSoupService::new(service))
}

#[Object]
impl<S, E, EAS, St, NR, PR> SoupQueryRoot<S, E, EAS, St, NR, PR>
where
    S: SoupService + Clone,
    E: EmailService,
    EAS: EntityAccessService,
    St: Clone + Send + Sync + 'static,
    EmailRouterState<E>: FromRef<St>,
    Arc<EAS>: FromRef<St>,
    NR: SoupNotificationEdgeReader,
    PR: SoupPropertyEdgeReader,
{
    /// The authenticated user.
    async fn user(&self) -> GraphqlUser<S, E, EAS, St, NR, PR> {
        GraphqlUser {
            service: self.service.clone(),
            _marker: PhantomData,
        }
    }
}

#[Object(name = "GraphqlUser")]
impl<S, E, EAS, St, NR, PR> GraphqlUser<S, E, EAS, St, NR, PR>
where
    S: SoupService,
    E: EmailService,
    EAS: EntityAccessService,
    St: Clone + Send + Sync + 'static,
    EmailRouterState<E>: FromRef<St>,
    Arc<EAS>: FromRef<St>,
    NR: SoupNotificationEdgeReader,
    PR: SoupPropertyEdgeReader,
{
    /// Stable id of the authenticated user.
    async fn id(&self, ctx: &Context<'_>) -> async_graphql::Result<async_graphql::ID> {
        let Cached(MacroUserExtractor { macro_user_id, .. }) =
            extract_part::<Cached<MacroUserExtractor>, St>(ctx).await?;
        Ok(async_graphql::ID(macro_user_id.to_string()))
    }

    /// Fetch a page of Soup items using the existing Soup filter AST format.
    async fn soup(
        &self,
        ctx: &Context<'_>,
        input: SoupInput,
    ) -> async_graphql::Result<SoupPage<SoupEdges<NR, PR>>> {
        resolve_soup::<S, E, EAS, St, SoupEdges<NR, PR>>(&self.service, ctx, input).await
    }
}
