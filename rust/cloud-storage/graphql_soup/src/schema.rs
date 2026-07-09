#[cfg(test)]
mod test;

use std::{marker::PhantomData, sync::Arc};

use async_graphql::{Context, EmptyMutation, EmptySubscription, Object, Schema};
use axum::extract::{FromRef, FromRequestParts};
use axum_extra::extract::Cached;
use email::{
    domain::ports::{EmailService, NoOpEmailService},
    inbound::axum::{axum_impls::MultiEmailLinkExtractor, previews_router::EmailRouterState},
};
use entity_access::{
    domain::{
        models::{EntityAccessReceipt, MemberTeamRole},
        ports::{EntityAccessService, NoOpEntityAccessService},
    },
    inbound::axum_extractors::OptionalMacroUserTeamExtractor,
};
use model_user::axum_extractor::MacroUserExtractor;
use models_pagination::TypeEraseCursor;
use soup::domain::{
    models::SoupRequest,
    ports::{NoOpSoupService, SoupService},
};

use crate::{inputs::SoupInput, objects::SoupPage, request_context::GraphqlSoupRequestParts};

/// GraphQL Soup schema type.
///
/// `S` is the soup service, `E` the email service, `EAS` the entity access
/// service, and `St` the embedding axum router state that can hand out the
/// email router state and entity access service for the lazy extractors.
pub type SoupSchema<S, E, EAS, St> =
    Schema<SoupQueryRoot<S, E, EAS, St>, EmptyMutation, EmptySubscription>;

/// GraphQL Soup schema type backed by a shared soup service.
pub type SharedSoupSchema<S, E, EAS, St> = SoupSchema<SharedSoupService<S>, E, EAS, St>;

/// GraphQL Soup schema type backed by the no-op services, used only for
/// SDL export or introspection.
pub type SchemaOnlySoupSchema =
    SoupSchema<NoOpSoupService, NoOpEmailService, NoOpEntityAccessService, SchemaOnlyState>;

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
    >{
        self.0.caller_tag_sets(user_id).await
    }
}

/// Zero-sized marker tying the query objects to the email/entity-access/state
/// generics without requiring values of those types.
type ServicesMarker<E, EAS, St> = PhantomData<fn() -> (E, EAS, St)>;

/// Root GraphQL query object for Soup.
pub struct SoupQueryRoot<S, E, EAS, St> {
    service: S,
    _marker: ServicesMarker<E, EAS, St>,
}

impl<S, E, EAS, St> SoupQueryRoot<S, E, EAS, St> {
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
pub struct GraphqlUser<S, E, EAS, St> {
    service: S,
    _marker: ServicesMarker<E, EAS, St>,
}

/// Build a GraphQL schema for Soup suitable for SDL export or introspection.
pub fn build_schema() -> SchemaOnlySoupSchema {
    build_schema_with_service(NoOpSoupService)
}

/// Build a GraphQL schema for Soup backed by the provided service.
pub fn build_schema_with_service<S, E, EAS, St>(service: S) -> SoupSchema<S, E, EAS, St>
where
    S: SoupService + Clone,
    E: EmailService,
    EAS: EntityAccessService,
    St: Clone + Send + Sync + 'static,
    EmailRouterState<E>: FromRef<St>,
    Arc<EAS>: FromRef<St>,
{
    Schema::build(
        SoupQueryRoot::new(service),
        EmptyMutation,
        EmptySubscription,
    )
    .finish()
}

/// Build a GraphQL schema for Soup backed by an `Arc`-shared service.
pub fn build_schema_from_arc<S, E, EAS, St>(service: Arc<S>) -> SharedSoupSchema<S, E, EAS, St>
where
    S: SoupService,
    E: EmailService,
    EAS: EntityAccessService,
    St: Clone + Send + Sync + 'static,
    EmailRouterState<E>: FromRef<St>,
    Arc<EAS>: FromRef<St>,
{
    build_schema_with_service(SharedSoupService::new(service))
}

/// Run an axum extractor against the request parts stored in the GraphQL
/// context, using the embedding router state `St` also stored there.
async fn extract_part<T, St>(ctx: &Context<'_>) -> async_graphql::Result<T>
where
    T: FromRequestParts<St>,
    T::Rejection: std::fmt::Display,
    St: Clone + Send + Sync + 'static,
{
    let parts = ctx.data::<GraphqlSoupRequestParts>()?;
    let state = ctx.data::<St>()?;
    parts
        .extract_with_state::<T, St>(state)
        .await
        .map_err(|err| async_graphql::Error::new(err.to_string()))
}

#[Object]
impl<S, E, EAS, St> SoupQueryRoot<S, E, EAS, St>
where
    S: SoupService + Clone,
    E: EmailService,
    EAS: EntityAccessService,
    St: Clone + Send + Sync + 'static,
    EmailRouterState<E>: FromRef<St>,
    Arc<EAS>: FromRef<St>,
{
    /// The authenticated user.
    async fn user(&self) -> GraphqlUser<S, E, EAS, St> {
        GraphqlUser {
            service: self.service.clone(),
            _marker: PhantomData,
        }
    }
}

#[Object(name = "GraphqlUser")]
impl<S, E, EAS, St> GraphqlUser<S, E, EAS, St>
where
    S: SoupService,
    E: EmailService,
    EAS: EntityAccessService,
    St: Clone + Send + Sync + 'static,
    EmailRouterState<E>: FromRef<St>,
    Arc<EAS>: FromRef<St>,
{
    /// Stable id of the authenticated user.
    async fn id(&self, ctx: &Context<'_>) -> async_graphql::Result<async_graphql::ID> {
        let Cached(MacroUserExtractor { macro_user_id, .. }) =
            extract_part::<Cached<MacroUserExtractor>, St>(ctx).await?;
        Ok(async_graphql::ID(macro_user_id.to_string()))
    }

    /// Fetch a page of Soup items using the existing Soup filter AST format.
    async fn soup(&self, ctx: &Context<'_>, input: SoupInput) -> async_graphql::Result<SoupPage> {
        let Cached(MacroUserExtractor { macro_user_id, .. }) =
            extract_part::<Cached<MacroUserExtractor>, St>(ctx).await?;
        let Cached(MultiEmailLinkExtractor(links, _)) =
            extract_part::<Cached<MultiEmailLinkExtractor<E>>, St>(ctx).await?;
        let link_ids = links.into_iter().map(|link| link.id).collect();
        let request = input.into_request(macro_user_id, link_ids)?;

        // Team membership is only resolved when the query actually asks for
        // CRM-scoped data; everything else skips the lookup entirely. The
        // authorization itself (membership + admin role for hidden
        // companies) is enforced by the soup domain and CRM service from
        // the receipt.
        let effective_filter = request.cursor.filter();
        let team_receipt =
            if effective_filter.requests_crm_scope() || effective_filter.requests_crm_admin() {
                let Cached(team) = extract_part::<
                    Cached<OptionalMacroUserTeamExtractor<MemberTeamRole, EAS>>,
                    St,
                >(ctx)
                .await?;
                team.entity_access_receipt
            } else {
                None
            };

        let page = self.service.get_user_soup(request, team_receipt).await?;
        Ok(SoupPage::from(page.type_erase()))
    }
}
