#[cfg(test)]
mod test;

use std::{marker::PhantomData, sync::Arc};

use async_graphql::{Context, ID, MergedObject, MergedSubscription, Object, Schema, Subscription};
use axum::extract::FromRef;
use email::{
    domain::ports::{EmailService, EmailUserService, NoOpEmailService},
    inbound::axum::previews_router::EmailRouterState,
};
use entity_access::domain::ports::{EntityAccessService, NoOpEntityAccessService};
use entity_mutation::{EntityMutationService, UnavailableEntityMutationService};
use favorites::domain::ports::FavoritesMutationService;
use graphql_activity::{
    ActivityFeedInput, ActivityOverviewInput, ActivityReader, GraphqlActivityOverview,
    GraphqlActivityPage, NoOpActivityReader, resolve_activity_feed, resolve_activity_overview,
};
use graphql_channel::{
    ChannelActivityAuthorizer, ChannelActivityMutationService, ChannelMutationRoot,
    NoOpChannelActivityMutationService,
};
use graphql_common::{parse_id, require_authorized_user};
use graphql_email::{
    GraphqlEmailMutation, GraphqlEmailQuery, NoOpSoupEmailContentEdgeReader,
    SoupEmailContentEdgeReader,
};
use graphql_entity_mutation::EntityMutationRoot;
use graphql_favorite::{
    EntityFavoriteEdgeReader, FavoriteMutationRoot, NoOpEntityFavoriteEdgeReader,
    NoOpFavoriteMutationService,
};
use graphql_notification::{
    NoOpNotificationMutationService, NoOpSoupNotificationEdgeReader, NotificationMutationRoot,
    NotificationMutationService, NotificationSubscriptionRoot, SoupNotificationEdgeReader,
};
use graphql_permission::{EntityPermissionEdgeReader, NoOpEntityPermissionEdgeReader};
use graphql_properties::{
    EntityPropertyReader, EntityPropertyWriter, NoOpEntityPropertyReader, NoOpEntityPropertyWriter,
    PropertiesMutationRoot,
};
use graphql_soup::{
    GraphqlSoupEmailThread, GroupedSoup, GroupedSoupInput, SoupEmailThreadMutationOutput,
    SoupEntityEdges, SoupInput, SoupPage, SoupPatch, resolve_grouped_soup, resolve_soup,
    resolve_soup_email_thread, resolve_soup_updates,
};
use macro_authorization::{
    InternalAuthConfig, MacroAuthorizationService, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, NoopMacroAuthJwtValidator,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_notifications::NotifEvent;
use notification::domain::{
    models::NotificationSubscriptionUpdate,
    ports::{
        NoopWebSocketNotificationSubscriptionService, WebSocketNotificationSubscriptionService,
    },
};
use soup::domain::ports::{NoOpSoupService, SoupService};
use soup_realtime::domain::ports::{
    NoOpSoupRealtimeSubscriptionService, SoupRealtimeSubscriptionService,
};

use crate::SoupEdges;

/// Mutation root combining independent domain GraphQL adapters.
#[derive(MergedObject)]
pub struct CompleteMutationRoot<
    W: EntityPropertyWriter,
    M: EntityMutationService,
    F: FavoritesMutationService,
    E: SoupEntityEdges,
    C: ChannelActivityMutationService,
    N: NotificationMutationService,
    A: ChannelActivityAuthorizer,
    ES: EmailService,
>(
    PropertiesMutationRoot<W>,
    EntityMutationRoot<M, E>,
    FavoriteMutationRoot<F, E>,
    ChannelMutationRoot<C, A>,
    NotificationMutationRoot<N>,
    GraphqlEmailMutation<ES, SoupEmailThreadMutationOutput<E>>,
);

impl<
    W: EntityPropertyWriter,
    M: EntityMutationService,
    F: FavoritesMutationService,
    E: SoupEntityEdges,
    C: ChannelActivityMutationService,
    N: NotificationMutationService,
    A: ChannelActivityAuthorizer,
    ES: EmailService,
> CompleteMutationRoot<W, M, F, E, C, N, A, ES>
{
    /// Construct the composed mutation root.
    fn new() -> Self {
        Self(
            PropertiesMutationRoot::<W>::new(),
            EntityMutationRoot::<M, E>::new(),
            FavoriteMutationRoot::<F, E>::new(),
            ChannelMutationRoot::<C, A>::new(),
            NotificationMutationRoot::<N>::new(),
            GraphqlEmailMutation::<ES, SoupEmailThreadMutationOutput<E>>::new(),
        )
    }
}

/// Root subscription object combining realtime Soup and notification adapters.
#[derive(MergedSubscription)]
pub struct CompleteSubscriptionRoot<R, NS, Auth, St, NR, PR, ER, FR, AR, AcR>(
    SoupSubscriptionRoot<R, Auth, St, NR, PR, ER, FR, AR, AcR>,
    NotificationSubscriptionRoot<NS>,
)
where
    R: SoupRealtimeSubscriptionService,
    NS: WebSocketNotificationSubscriptionService<NotificationSubscriptionUpdate<NotifEvent>>,
    Auth: MacroAuthorizationService,
    St: Clone + Send + Sync + 'static,
    MacroAuthorizationState<Auth>: FromRef<St>,
    NR: SoupNotificationEdgeReader,
    PR: EntityPropertyReader,
    ER: SoupEmailContentEdgeReader,
    FR: EntityFavoriteEdgeReader,
    AR: EntityPermissionEdgeReader,
    AcR: ActivityReader;

/// GraphQL Soup schema type.
///
/// `S` is the soup query service, `R` the realtime Soup subscription service,
/// `NS` the realtime notification subscription service, `E` the email service,
/// `EAS` the entity access service, `Auth` the authorization service, `St` the
/// embedding axum router state, `W` the property mutation writer, `M` the entity
/// mutation service, `FM` the favorites mutation service, `C` the channel activity
/// mutation service, `N` the notification mutation service, `NR` the notification
/// edge reader, `PR` the property edge reader, `ER` the email-content edge reader,
/// `FR` the favorite edge reader, `AR` the access edge reader, and `AcR` the activity
/// reader.
pub type SoupSchema<S, R, NS, E, EAS, Auth, St, W, M, FM, C, N, NR, PR, ER, FR, AR, AcR> = Schema<
    SoupQueryRoot<S, E, EAS, Auth, St, NR, PR, ER, FR, AR, AcR>,
    CompleteMutationRoot<W, M, FM, SoupEdges<NR, PR, ER, FR, AR, AcR>, C, N, EAS, E>,
    CompleteSubscriptionRoot<R, NS, Auth, St, NR, PR, ER, FR, AR, AcR>,
>;

/// GraphQL Soup schema type backed by shared query and realtime services.
pub type SharedSoupSchema<S, R, NS, E, EAS, Auth, St, W, M, FM, C, N, NR, PR, ER, FR, AR, AcR> =
    SoupSchema<Arc<S>, Arc<R>, Arc<NS>, E, EAS, Auth, St, W, M, FM, C, N, NR, PR, ER, FR, AR, AcR>;

/// GraphQL Soup schema type backed by the no-op services, used only for
/// SDL export or introspection.
pub type SchemaOnlySoupSchema = SoupSchema<
    NoOpSoupService,
    NoOpSoupRealtimeSubscriptionService,
    NoopWebSocketNotificationSubscriptionService,
    NoOpEmailService,
    NoOpEntityAccessService,
    SchemaOnlyAuthorizationService,
    SchemaOnlyState,
    NoOpEntityPropertyWriter,
    UnavailableEntityMutationService,
    NoOpFavoriteMutationService,
    NoOpChannelActivityMutationService,
    NoOpNotificationMutationService,
    NoOpSoupNotificationEdgeReader,
    NoOpEntityPropertyReader,
    NoOpSoupEmailContentEdgeReader,
    NoOpEntityFavoriteEdgeReader,
    NoOpEntityPermissionEdgeReader,
    NoOpActivityReader,
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
            macro_authorization::NoBotAuthorizer,
            macro_authorization::NoUserApiKeyAuthorizer,
        );
        MacroAuthorizationState::new(Arc::new(service))
    }
}

/// Zero-sized marker tying the query objects to the adapter, authorization,
/// state, and reader generics without requiring values of those types.
type ServicesMarker<E, EAS, Auth, St, NR, PR, ER, FR, AR, AcR> =
    PhantomData<fn() -> (E, EAS, Auth, St, NR, PR, ER, FR, AR, AcR)>;

/// Root GraphQL query object for Soup.
pub struct SoupQueryRoot<S, E, EAS, Auth, St, NR, PR, ER, FR, AR, AcR> {
    /// Soup domain service used by user-scoped query resolvers.
    service: S,
    /// Associates the root with its adapter and reader types.
    _marker: ServicesMarker<E, EAS, Auth, St, NR, PR, ER, FR, AR, AcR>,
}

impl<S, E, EAS, Auth, St, NR, PR, ER, FR, AR, AcR>
    SoupQueryRoot<S, E, EAS, Auth, St, NR, PR, ER, FR, AR, AcR>
{
    /// Create a root GraphQL query object.
    pub fn new(service: S) -> Self {
        Self {
            service,
            _marker: PhantomData,
        }
    }
}

/// Root GraphQL subscription object for realtime Soup updates.
pub struct SoupSubscriptionRoot<R, Auth, St, NR, PR, ER, FR, AR, AcR> {
    /// Realtime Soup service used by user-scoped subscriptions.
    service: R,
    /// Associates the root with authorization, state, and edge reader types.
    #[allow(clippy::type_complexity)]
    _marker: PhantomData<fn() -> (Auth, St, NR, PR, ER, FR, AR, AcR)>,
}

impl<R, Auth, St, NR, PR, ER, FR, AR, AcR>
    SoupSubscriptionRoot<R, Auth, St, NR, PR, ER, FR, AR, AcR>
{
    /// Creates a root GraphQL subscription object.
    pub fn new(service: R) -> Self {
        Self {
            service,
            _marker: PhantomData,
        }
    }
}

/// The authenticated user (viewer). All user-scoped data hangs off this
/// object so clients (and their normalized caches) observe data ownership
/// structurally rather than implicitly through the session.
pub struct GraphqlUser<S, E, EAS, Auth, St, NR, PR, ER, FR, AR, AcR> {
    /// Soup domain service used by this user's resolvers.
    service: S,
    /// Associates the user object with its adapter and reader types.
    _marker: ServicesMarker<E, EAS, Auth, St, NR, PR, ER, FR, AR, AcR>,
    /// The [MacroUserIdStr] of the resolving user
    user_id: MacroUserIdStr<'static>,
}

/// Input for fetching one email thread by its canonical identifier.
#[derive(async_graphql::InputObject)]
pub struct EmailThreadInput {
    /// The canonical email thread identifier.
    thread_id: ID,
}

/// Build a GraphQL schema for Soup suitable for SDL export or introspection.
pub fn build_schema() -> SchemaOnlySoupSchema {
    build_schema_with_services(
        NoOpSoupService,
        NoOpSoupRealtimeSubscriptionService,
        NoopWebSocketNotificationSubscriptionService,
    )
}

/// Build a GraphQL schema backed by a query service and no-op realtime service.
#[allow(clippy::type_complexity)]
pub fn build_schema_with_service<S, E, EAS, Auth, St, W, M, FM, C, N, NR, PR, ER, FR, AR, AcR>(
    service: S,
) -> SoupSchema<
    S,
    NoOpSoupRealtimeSubscriptionService,
    NoopWebSocketNotificationSubscriptionService,
    E,
    EAS,
    Auth,
    St,
    W,
    M,
    FM,
    C,
    N,
    NR,
    PR,
    ER,
    FR,
    AR,
    AcR,
>
where
    S: SoupService + Clone,
    E: EmailService + EmailUserService,
    EAS: EntityAccessService,
    Auth: MacroAuthorizationService,
    St: Clone + Send + Sync + 'static,
    EmailRouterState<E>: FromRef<St>,
    Arc<EAS>: FromRef<St>,
    MacroAuthorizationState<Auth>: FromRef<St>,
    W: EntityPropertyWriter,
    M: EntityMutationService,
    FM: FavoritesMutationService,
    C: ChannelActivityMutationService,
    N: NotificationMutationService,
    NR: SoupNotificationEdgeReader,
    PR: EntityPropertyReader,
    ER: SoupEmailContentEdgeReader,
    FR: EntityFavoriteEdgeReader,
    AR: EntityPermissionEdgeReader,
    AcR: ActivityReader,
{
    build_schema_with_services(
        service,
        NoOpSoupRealtimeSubscriptionService,
        NoopWebSocketNotificationSubscriptionService,
    )
}

/// Build a GraphQL schema backed by query and realtime Soup services.
#[allow(clippy::type_complexity)]
pub fn build_schema_with_services<
    S,
    R,
    NS,
    E,
    EAS,
    Auth,
    St,
    W,
    M,
    FM,
    C,
    N,
    NR,
    PR,
    ER,
    FR,
    AR,
    AcR,
>(
    service: S,
    realtime_service: R,
    notification_subscription_service: NS,
) -> SoupSchema<S, R, NS, E, EAS, Auth, St, W, M, FM, C, N, NR, PR, ER, FR, AR, AcR>
where
    S: SoupService + Clone,
    R: SoupRealtimeSubscriptionService + Clone,
    NS: WebSocketNotificationSubscriptionService<NotificationSubscriptionUpdate<NotifEvent>>
        + Clone,
    E: EmailService + EmailUserService,
    EAS: EntityAccessService,
    Auth: MacroAuthorizationService,
    St: Clone + Send + Sync + 'static,
    EmailRouterState<E>: FromRef<St>,
    Arc<EAS>: FromRef<St>,
    MacroAuthorizationState<Auth>: FromRef<St>,
    W: EntityPropertyWriter,
    M: EntityMutationService,
    FM: FavoritesMutationService,
    C: ChannelActivityMutationService,
    N: NotificationMutationService,
    NR: SoupNotificationEdgeReader,
    PR: EntityPropertyReader,
    ER: SoupEmailContentEdgeReader,
    FR: EntityFavoriteEdgeReader,
    AR: EntityPermissionEdgeReader,
    AcR: ActivityReader,
{
    Schema::build(
        SoupQueryRoot::new(service),
        CompleteMutationRoot::<W, M, FM, SoupEdges<NR, PR, ER, FR, AR, AcR>, C, N, EAS, E>::new(),
        CompleteSubscriptionRoot(
            SoupSubscriptionRoot::new(realtime_service),
            NotificationSubscriptionRoot::new(notification_subscription_service),
        ),
    )
    .finish()
}

/// Build a GraphQL schema backed by an `Arc`-shared query service.
#[allow(clippy::type_complexity)]
pub fn build_schema_from_arc<S, E, EAS, Auth, St, W, M, FM, C, N, NR, PR, ER, FR, AR, AcR>(
    service: Arc<S>,
) -> SoupSchema<
    Arc<S>,
    NoOpSoupRealtimeSubscriptionService,
    NoopWebSocketNotificationSubscriptionService,
    E,
    EAS,
    Auth,
    St,
    W,
    M,
    FM,
    C,
    N,
    NR,
    PR,
    ER,
    FR,
    AR,
    AcR,
>
where
    S: SoupService,
    E: EmailService + EmailUserService,
    EAS: EntityAccessService,
    Auth: MacroAuthorizationService,
    St: Clone + Send + Sync + 'static,
    EmailRouterState<E>: FromRef<St>,
    Arc<EAS>: FromRef<St>,
    MacroAuthorizationState<Auth>: FromRef<St>,
    W: EntityPropertyWriter,
    M: EntityMutationService,
    FM: FavoritesMutationService,
    C: ChannelActivityMutationService,
    N: NotificationMutationService,
    NR: SoupNotificationEdgeReader,
    PR: EntityPropertyReader,
    ER: SoupEmailContentEdgeReader,
    FR: EntityFavoriteEdgeReader,
    AR: EntityPermissionEdgeReader,
    AcR: ActivityReader,
{
    build_schema_with_service(service)
}

/// Build a GraphQL schema backed by `Arc`-shared query and realtime services.
#[allow(clippy::type_complexity)]
pub fn build_schema_from_arcs<S, R, NS, E, EAS, Auth, St, W, M, FM, C, N, NR, PR, ER, FR, AR, AcR>(
    service: Arc<S>,
    realtime_service: Arc<R>,
    notification_subscription_service: Arc<NS>,
) -> SharedSoupSchema<S, R, NS, E, EAS, Auth, St, W, M, FM, C, N, NR, PR, ER, FR, AR, AcR>
where
    S: SoupService,
    R: SoupRealtimeSubscriptionService,
    NS: WebSocketNotificationSubscriptionService<NotificationSubscriptionUpdate<NotifEvent>>,
    E: EmailService + EmailUserService,
    EAS: EntityAccessService,
    Auth: MacroAuthorizationService,
    St: Clone + Send + Sync + 'static,
    EmailRouterState<E>: FromRef<St>,
    Arc<EAS>: FromRef<St>,
    MacroAuthorizationState<Auth>: FromRef<St>,
    W: EntityPropertyWriter,
    M: EntityMutationService,
    FM: FavoritesMutationService,
    C: ChannelActivityMutationService,
    N: NotificationMutationService,
    NR: SoupNotificationEdgeReader,
    PR: EntityPropertyReader,
    ER: SoupEmailContentEdgeReader,
    FR: EntityFavoriteEdgeReader,
    AR: EntityPermissionEdgeReader,
    AcR: ActivityReader,
{
    build_schema_with_services(service, realtime_service, notification_subscription_service)
}

/// Root entry point for the complete GraphQL API.
#[Object]
impl<S, E, EAS, Auth, St, NR, PR, ER, FR, AR, AcR>
    SoupQueryRoot<S, E, EAS, Auth, St, NR, PR, ER, FR, AR, AcR>
where
    S: SoupService + Clone,
    E: EmailService + EmailUserService,
    EAS: EntityAccessService,
    Auth: MacroAuthorizationService,
    St: Clone + Send + Sync + 'static,
    EmailRouterState<E>: FromRef<St>,
    Arc<EAS>: FromRef<St>,
    MacroAuthorizationState<Auth>: FromRef<St>,
    NR: SoupNotificationEdgeReader,
    PR: EntityPropertyReader,
    ER: SoupEmailContentEdgeReader,
    FR: EntityFavoriteEdgeReader,
    AR: EntityPermissionEdgeReader,
    AcR: ActivityReader,
{
    /// The authenticated user.
    async fn user(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<GraphqlUser<S, E, EAS, Auth, St, NR, PR, ER, FR, AR, AcR>> {
        let user_id = require_authorized_user::<Auth, St>(ctx).await?;

        Ok(GraphqlUser {
            service: self.service.clone(),
            _marker: PhantomData,
            user_id,
        })
    }
}

/// Root entry point for realtime Soup subscriptions.
#[Subscription]
impl<R, Auth, St, NR, PR, ER, FR, AR, AcR>
    SoupSubscriptionRoot<R, Auth, St, NR, PR, ER, FR, AR, AcR>
where
    R: SoupRealtimeSubscriptionService,
    Auth: MacroAuthorizationService,
    St: Clone + Send + Sync + 'static,
    MacroAuthorizationState<Auth>: FromRef<St>,
    NR: SoupNotificationEdgeReader,
    PR: EntityPropertyReader,
    ER: SoupEmailContentEdgeReader,
    FR: EntityFavoriteEdgeReader,
    AR: EntityPermissionEdgeReader,
    AcR: ActivityReader,
{
    /// Subscribe to realtime Soup updates for the authenticated user.
    async fn soup_updates(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<
        impl async_graphql::futures_util::Stream<
            Item = async_graphql::Result<Vec<SoupPatch<SoupEdges<NR, PR, ER, FR, AR, AcR>>>>,
        >,
    > {
        resolve_soup_updates::<R, Auth, St, SoupEdges<NR, PR, ER, FR, AR, AcR>>(&self.service, ctx)
            .await
    }
}

/// The authenticated user and their user-scoped data.
#[Object(name = "GraphqlUser")]
impl<S, E, EAS, Auth, St, NR, PR, ER, FR, AR, AcR>
    GraphqlUser<S, E, EAS, Auth, St, NR, PR, ER, FR, AR, AcR>
where
    S: SoupService,
    E: EmailService + EmailUserService,
    EAS: EntityAccessService,
    Auth: MacroAuthorizationService,
    St: Clone + Send + Sync + 'static,
    EmailRouterState<E>: FromRef<St>,
    Arc<EAS>: FromRef<St>,
    MacroAuthorizationState<Auth>: FromRef<St>,
    NR: SoupNotificationEdgeReader,
    PR: EntityPropertyReader,
    ER: SoupEmailContentEdgeReader,
    FR: EntityFavoriteEdgeReader,
    AR: EntityPermissionEdgeReader,
    AcR: ActivityReader,
{
    /// Stable id of the authenticated user.
    async fn id(&self) -> async_graphql::ID {
        async_graphql::ID(self.user_id.to_string())
    }

    /// A page of the authenticated user's own activity, newest first.
    /// Delegated actions performed on the user's behalf are included.
    async fn activity(
        &self,
        ctx: &Context<'_>,
        input: ActivityFeedInput,
    ) -> async_graphql::Result<GraphqlActivityPage> {
        resolve_activity_feed::<AcR>(ctx, &self.user_id, input).await
    }

    /// The authenticated user's activity over the trailing year, bucketed
    /// into local dates in the requested time zone.
    async fn activity_overview(
        &self,
        ctx: &Context<'_>,
        input: ActivityOverviewInput,
    ) -> async_graphql::Result<GraphqlActivityOverview> {
        resolve_activity_overview::<AcR>(ctx, &self.user_id, input).await
    }

    /// Authenticated user email catalog fields supplied by `graphql_email`.
    #[graphql(flatten)]
    async fn email(&self, ctx: &Context<'_>) -> async_graphql::Result<GraphqlEmailQuery<E>> {
        let state = ctx.data::<St>()?;
        let service = EmailRouterState::<E>::from_ref(state).service();
        Ok(GraphqlEmailQuery::new(service, self.user_id.clone()))
    }

    /// Fetch one accessible email thread by its canonical identifier.
    async fn email_thread(
        &self,
        ctx: &Context<'_>,
        input: EmailThreadInput,
    ) -> async_graphql::Result<Option<GraphqlSoupEmailThread<SoupEdges<NR, PR, ER, FR, AR, AcR>>>>
    {
        let thread_id = parse_id(input.thread_id, "threadId")?;
        resolve_soup_email_thread::<SoupEdges<NR, PR, ER, FR, AR, AcR>>(
            ctx,
            self.user_id.clone(),
            thread_id,
        )
        .await
    }

    /// Fetch Soup items nested into grouping bins.
    async fn group_soup(
        &self,
        ctx: &Context<'_>,
        input: GroupedSoupInput,
    ) -> async_graphql::Result<GroupedSoup<SoupEdges<NR, PR, ER, FR, AR, AcR>>> {
        resolve_grouped_soup::<S, Auth, St, SoupEdges<NR, PR, ER, FR, AR, AcR>>(
            &self.service,
            ctx,
            input,
        )
        .await
    }

    /// Fetch a page of Soup items using the existing Soup filter AST format.
    async fn soup(
        &self,
        ctx: &Context<'_>,
        input: SoupInput,
    ) -> async_graphql::Result<SoupPage<SoupEdges<NR, PR, ER, FR, AR, AcR>>> {
        resolve_soup::<S, E, EAS, Auth, St, SoupEdges<NR, PR, ER, FR, AR, AcR>>(
            &self.service,
            ctx,
            input,
        )
        .await
    }
}
