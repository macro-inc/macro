use std::{future::Future, marker::PhantomData, pin::Pin, sync::Arc};

use async_graphql::Context;
use axum::extract::FromRef;
use axum_extra::extract::Cached;
use email::{
    domain::ports::EmailService,
    inbound::axum::{axum_impls::MultiEmailLinkExtractor, previews_router::EmailRouterState},
};
use entity_access::{
    domain::{models::MemberTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::OptionalMacroUserTeamExtractorV2,
};
use futures::Stream;
use graphql_common::{extract_part, require_authorized_user};
use graphql_email::EmailThreadMutationOutput;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use models_pagination::TypeEraseCursor;
use soup::domain::{models::grouping::NestedSoupGroups, ports::SoupService};
use soup_realtime::domain::ports::SoupRealtimeSubscriptionService;

use crate::{
    inputs::{GroupedSoupInput, SoupInput},
    loaders::SoupItemDataLoader,
    objects::{
        GraphqlSoupEmailThread, GraphqlSoupEntity, GroupedSoup, SoupEntityEdges, SoupPage,
        SoupPatch,
    },
};

/// Subscribe to realtime Soup updates for the authenticated user.
pub async fn resolve_soup_updates<R, Auth, St, Edges>(
    service: &R,
    ctx: &Context<'_>,
) -> async_graphql::Result<
    impl Stream<Item = async_graphql::Result<Vec<SoupPatch<Edges>>>> + Send + 'static,
>
where
    R: SoupRealtimeSubscriptionService,
    Auth: MacroAuthorizationService,
    MacroAuthorizationState<Auth>: FromRef<St>,
    St: Clone + Send + Sync + 'static,
    Edges: SoupEntityEdges,
{
    let macro_user_id = require_authorized_user::<Auth, St>(ctx).await?;
    let mut receiver = service.subscribe(macro_user_id.clone());
    const BUFFER_SIZE: usize = 10;
    let mut buf = Vec::with_capacity(BUFFER_SIZE);

    Ok(async_stream::stream! {
        while let x @ 1.. = receiver.recv_many(&mut buf, BUFFER_SIZE).await {
            let patches = buf
                .drain(..x)
                .map(|patch| SoupPatch::new(macro_user_id.clone(), patch))
                .collect();
            yield patches;
        }
    })
}

/// Resolve Soup items nested into grouping bins for the authenticated user.
pub async fn resolve_grouped_soup<S, Auth, St, Edges>(
    service: &S,
    ctx: &Context<'_>,
    input: GroupedSoupInput,
) -> async_graphql::Result<GroupedSoup<Edges>>
where
    S: SoupService,
    Auth: MacroAuthorizationService,
    MacroAuthorizationState<Auth>: FromRef<St>,
    St: Clone + Send + Sync + 'static,
    Edges: SoupEntityEdges,
{
    let macro_user_id = require_authorized_user::<Auth, St>(ctx).await?;
    let request = input.into_request(macro_user_id)?;
    let sort_method = *request.cursor.sort_method();
    let filters = request.cursor.filter().clone();
    let items = service.get_user_soup_grouped(request).await?;
    let groups: NestedSoupGroups<_, _> = items.collect();
    Ok(GroupedSoup::new(
        groups.with_next_cursors(sort_method, filters),
    ))
}

/// Resolve one email thread through the existing user-scoped Soup item loader.
///
/// A missing or inaccessible thread is represented as `None` by the loader's
/// filtered Soup request.
pub async fn resolve_soup_email_thread<Edges>(
    ctx: &Context<'_>,
    user_id: MacroUserIdStr<'static>,
    thread_id: uuid::Uuid,
) -> async_graphql::Result<Option<GraphqlSoupEmailThread<Edges>>>
where
    Edges: SoupEntityEdges,
{
    let loader = ctx.data::<SoupItemDataLoader>()?;
    let entity = EntityType::EmailThread.with_entity_string(thread_id.to_string());
    let Some(item) = loader.load_one((user_id, entity)).await? else {
        return Ok(None);
    };

    match GraphqlSoupEntity::<Edges>::new(item) {
        GraphqlSoupEntity::EmailThread(thread) => Ok(Some(thread)),
        _ => Err(async_graphql::Error::new(
            "Soup returned a non-email entity for an email-thread request",
        )),
    }
}

/// Mutation-output adapter that reloads the canonical Soup email-thread object.
pub struct SoupEmailThreadMutationOutput<Edges>(PhantomData<fn() -> Edges>);

impl<Edges> EmailThreadMutationOutput for SoupEmailThreadMutationOutput<Edges>
where
    Edges: SoupEntityEdges,
{
    type Thread = GraphqlSoupEmailThread<Edges>;

    fn load_email_thread<'ctx>(
        ctx: &'ctx Context<'_>,
        user_id: MacroUserIdStr<'static>,
        thread_id: uuid::Uuid,
    ) -> Pin<Box<dyn Future<Output = async_graphql::Result<Option<Self::Thread>>> + Send + 'ctx>>
    {
        Box::pin(resolve_soup_email_thread::<Edges>(ctx, user_id, thread_id))
    }
}

/// Resolve a page of Soup items for the authenticated user: runs the lazy
/// axum extractors against the request context, converts the GraphQL input
/// into a Soup request, and executes it against the Soup service.
pub async fn resolve_soup<S, E, EAS, Auth, St, Edges>(
    service: &S,
    ctx: &Context<'_>,
    input: SoupInput,
) -> async_graphql::Result<SoupPage<Edges>>
where
    S: SoupService,
    E: EmailService,
    EAS: EntityAccessService,
    Auth: MacroAuthorizationService,
    St: Clone + Send + Sync + 'static,
    EmailRouterState<E>: FromRef<St>,
    Arc<EAS>: FromRef<St>,
    MacroAuthorizationState<Auth>: FromRef<St>,
    Edges: SoupEntityEdges,
{
    let macro_user_id = require_authorized_user::<Auth, St>(ctx).await?;
    let Cached(MultiEmailLinkExtractor(links, _)) =
        extract_part::<Cached<MultiEmailLinkExtractor<E, Auth>>, St>(ctx).await?;
    let link_ids = links.into_iter().map(|link| link.id).collect();
    let request = input.into_request(macro_user_id, link_ids)?;

    // Always forward the optional team receipt: Soup uses it for all
    // team-scoped foreign entities, not only CRM-scoped filters.
    let Cached(team) = extract_part::<
        Cached<OptionalMacroUserTeamExtractorV2<MemberTeamRole, EAS, Auth>>,
        St,
    >(ctx)
    .await?;
    let team_receipt = team.entity_access_receipt;

    let include_frecency = ctx
        .look_ahead()
        .field("items")
        .field("frecencyScore")
        .exists();

    if include_frecency {
        let page = service
            .get_user_soup_with_frecency(request, team_receipt)
            .await?;
        Ok(SoupPage::new_from_enriched(page.type_erase()))
    } else {
        let page = service.get_user_soup(request, team_receipt).await?;
        Ok(SoupPage::new(page.type_erase()))
    }
}
