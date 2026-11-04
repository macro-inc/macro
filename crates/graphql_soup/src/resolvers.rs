use std::{collections::HashSet, future::Future, marker::PhantomData, pin::Pin, sync::Arc};

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
use soup::domain::{
    models::{SoupPropertiesField, grouping::build_grouped_response},
    ports::SoupService,
};
use soup_realtime::domain::{models::Patch, ports::SoupRealtimeSubscriptionService};

use crate::{
    id_list::{SoupIdLists, selects_ids_only},
    inputs::{GroupedSoupInput, SoupChannelReads, SoupInput},
    loaders::{AgentSessionEntityLoader, PrimarySoupItemLoader, SoupItemDataLoader},
    objects::{
        EmailThreadPrefetch, GraphqlSoupAgentSession, GraphqlSoupEmailThread, GraphqlSoupEntity,
        GroupedSoup, SoupEntityEdges, SoupPage, SoupPagePrefetch, SoupPatch,
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
    let loader = ctx
        .data_opt::<PrimarySoupItemLoader>()
        .map(|loader| loader.0.clone());
    const BUFFER_SIZE: usize = 10;
    let mut buf = Vec::with_capacity(BUFFER_SIZE);

    Ok(async_stream::stream! {
        while let x @ 1.. = receiver.recv_many(&mut buf, BUFFER_SIZE).await {
            let mut seen = HashSet::with_capacity(x);
            let mut patches = buf.drain(..x).rev()
                .filter(|patch| seen.insert(patch.value().clone()))
                .collect::<Vec<_>>();
            patches.reverse();
            let hydrated = futures::future::try_join_all(patches.into_iter().map(|patch| {
                let user_id = macro_user_id.clone();
                let loader = loader.as_ref();
                async move {
                    match patch {
                        Patch::Updated(entity) => SoupPatch::hydrate_updated(user_id, entity, loader).await,
                        Patch::Deleted(entity) => SoupPatch::deleted(entity).map(Some),
                    }
                }
            })).await.map(|patches| patches.into_iter().flatten().collect::<Vec<_>>());
            match hydrated {
                Ok(patches) if patches.is_empty() => continue,
                result => yield result,
            }
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
    let viewer = macro_user_id.clone();
    let request = input.into_request(macro_user_id)?;
    let sort = *request.cursor.sort_method();
    let filters = request.cursor.filter().clone();
    let grouping = request.grouping.clone();
    // Properties resolve through each entity's property edge, so the page
    // skips Soup's own property read.
    let items: Vec<_> = service
        .get_user_soup_grouped_without_properties(request)
        .await?
        .map(|item| item.map_extra(|()| SoupPropertiesField::default()))
        .collect();
    let mut keys: Vec<String> = items
        .iter()
        .map(|item| item.key.clone())
        .filter(|key| !key.is_empty())
        .collect();
    keys.sort_unstable();
    keys.dedup();
    let labels = service.group_labels(viewer, &grouping.field, &keys).await?;
    let response = build_grouped_response(
        items,
        &grouping.field,
        sort,
        grouping.group_key,
        filters,
        &labels,
    );
    Ok(GroupedSoup::from_response(response))
}

/// Resolve one email thread through the Soup item loader, whose email
/// hydration settles access with entity access receipts: the rule the REST
/// thread route applies, so a thread reached through a team's CRM, a project,
/// or a share opens even though it lives in a teammate's inbox.
///
/// A missing or inaccessible thread is represented as `None`.
#[tracing::instrument(
    name = "soup.resolve_email_thread",
    skip_all,
    fields(thread_id = %thread_id),
    err(Debug)
)]
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

    match GraphqlSoupEntity::<Edges>::new_with_projection(item) {
        GraphqlSoupEntity::EmailThread(thread) => Ok(Some(thread)),
        _ => Err(async_graphql::Error::new(
            "Soup returned a non-email entity for an email-thread request",
        )),
    }
}

/// Resolve email threads, in the given order, through the user-scoped Soup
/// item loader. Missing or inaccessible threads are left out.
pub async fn resolve_soup_email_threads<Edges>(
    ctx: &Context<'_>,
    user_id: MacroUserIdStr<'static>,
    thread_ids: Vec<uuid::Uuid>,
) -> async_graphql::Result<Vec<GraphqlSoupEmailThread<Edges>>>
where
    Edges: SoupEntityEdges,
{
    let loader = ctx.data::<SoupItemDataLoader>()?;
    // Concurrent loads coalesce into one batched Soup request per user.
    let items = futures::future::try_join_all(thread_ids.into_iter().map(|thread_id| {
        loader.load_one((
            user_id.clone(),
            EntityType::EmailThread.with_entity_string(thread_id.to_string()),
        ))
    }))
    .await?;
    let mut threads = Vec::with_capacity(items.len());
    for item in items.into_iter().flatten() {
        match GraphqlSoupEntity::<Edges>::new_with_projection(item) {
            GraphqlSoupEntity::EmailThread(thread) => threads.push(thread),
            _ => {
                return Err(async_graphql::Error::new(
                    "Soup returned a non-email entity for an email-thread request",
                ));
            }
        }
    }
    Ok(threads)
}

/// Fetch one agent session the viewer can see, through the same access
/// filter the Soup list uses, so a session outside their grants reads as
/// absent rather than as an error. Reads the primary: see
/// [`AgentSessionEntityLoader`].
pub async fn resolve_soup_agent_session<Edges>(
    ctx: &Context<'_>,
    user_id: MacroUserIdStr<'static>,
    session_id: uuid::Uuid,
) -> async_graphql::Result<Option<GraphqlSoupAgentSession<Edges>>>
where
    Edges: SoupEntityEdges,
{
    let loader = ctx.data::<AgentSessionEntityLoader>()?;
    load_soup_agent_session(loader, user_id, session_id).await
}

/// [`resolve_soup_agent_session`] for a caller holding the loader, such as a subscription stream,
/// which outlives its request context.
pub async fn load_soup_agent_session<Edges>(
    loader: &AgentSessionEntityLoader,
    user_id: MacroUserIdStr<'static>,
    session_id: uuid::Uuid,
) -> async_graphql::Result<Option<GraphqlSoupAgentSession<Edges>>>
where
    Edges: SoupEntityEdges,
{
    let entity = EntityType::AgentSession.with_entity_string(session_id.to_string());
    let Some(item) = loader.0.load_one((user_id, entity)).await? else {
        return Ok(None);
    };

    match GraphqlSoupEntity::<Edges>::new_with_projection(item) {
        GraphqlSoupEntity::AgentSession(session) => Ok(Some(session)),
        _ => Err(async_graphql::Error::new(
            "Soup returned a non-agent-session entity for an agent-session request",
        )),
    }
}

/// Fetch one Soup entity the viewer can see, through the same access filter
/// the Soup list uses, so an inaccessible or missing entity reads as absent.
/// Reads the primary: see [`PrimarySoupItemLoader`].
pub async fn resolve_soup_entity<Edges>(
    ctx: &Context<'_>,
    user_id: MacroUserIdStr<'static>,
    entity: model_entity::Entity<'static>,
) -> async_graphql::Result<Option<GraphqlSoupEntity<Edges>>>
where
    Edges: SoupEntityEdges,
{
    let loader = &ctx.data::<PrimarySoupItemLoader>()?.0;
    let item = loader.load_one((user_id, entity)).await?;
    Ok(item.map(GraphqlSoupEntity::<Edges>::new_with_projection))
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
        Box::pin(async move {
            let loader = ctx.data::<crate::EmailMutationThreadLoader>()?;
            let Some(thread) = loader.read(user_id, thread_id).await? else {
                return Ok(None);
            };
            match GraphqlSoupEntity::<Edges>::new(models_soup::item::SoupItem::EmailThread(thread))
            {
                GraphqlSoupEntity::EmailThread(thread) => Ok(Some(thread)),
                _ => Err(async_graphql::Error::new("expected an email thread")),
            }
        })
    }
}

/// The Soup service a page with `channelReads: PRIMARY` runs against: the
/// same service as the ordinary one, except that its channel list reads the
/// primary. The schema's context data carries it, typed by the schema's own
/// Soup service (`Arc<_>` in a shared schema); a schema without it rejects
/// such a page instead of quietly reading the replica.
#[derive(Clone)]
pub struct PrimaryChannelSoup<S>(pub S);

/// The error for a `channelReads: PRIMARY` page on a schema without
/// [`PrimaryChannelSoup`].
pub const PRIMARY_CHANNEL_SOUP_MISSING: &str = "channelReads PRIMARY is not served here";

/// The error for a `channelReads: PRIMARY` page that is not a channel
/// directory page (`SoupRequest::is_channel_directory_page`).
pub const PRIMARY_CHANNEL_READS_REFUSED: &str =
    "channelReads PRIMARY serves only channel directory pages";

/// Resolve a page of Soup items for the authenticated user: runs the lazy
/// axum extractors against the request context, converts the GraphQL input
/// into a Soup request, and executes it against the Soup service, or against
/// [`PrimaryChannelSoup`] when the input asks for its channels from the
/// primary and the page is a channel directory page.
///
/// The span records how the page ended as `outcome`, never an error's text:
/// errors here carry submitted filter values, such as a sender's address.
#[tracing::instrument(
    name = "soup.page",
    skip_all,
    fields(
        channel_reads = tracing::field::Empty,
        limit = tracing::field::Empty,
        outcome = tracing::field::Empty,
    )
)]
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
    let result = resolve_soup_page::<S, E, EAS, Auth, St, Edges>(service, ctx, input).await;
    tracing::Span::current().record("outcome", soup_page_outcome(&result));
    result
}

/// How a Soup page ended, for its span: served, refused a primary read, or
/// failed.
fn soup_page_outcome<T>(result: &async_graphql::Result<T>) -> &'static str {
    match result {
        Ok(_) => "ok",
        Err(error) if error.message == PRIMARY_CHANNEL_SOUP_MISSING => "primary_missing",
        Err(error) if error.message == PRIMARY_CHANNEL_READS_REFUSED => "primary_refused",
        Err(_) => "error",
    }
}

/// The page itself, run inside [`resolve_soup`]'s span.
async fn resolve_soup_page<S, E, EAS, Auth, St, Edges>(
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
    let span = tracing::Span::current();
    let channel_reads = input.channel_reads();
    span.record(
        "channel_reads",
        match channel_reads {
            SoupChannelReads::Replica => "replica",
            SoupChannelReads::Primary => "primary",
        },
    );
    let service: &S = match channel_reads {
        SoupChannelReads::Replica => service,
        SoupChannelReads::Primary => {
            &ctx.data::<PrimaryChannelSoup<S>>()
                .map_err(|_| async_graphql::Error::new(PRIMARY_CHANNEL_SOUP_MISSING))?
                .0
        }
    };
    let macro_user_id = require_authorized_user::<Auth, St>(ctx).await?;
    let Cached(MultiEmailLinkExtractor(links, _)) =
        extract_part::<Cached<MultiEmailLinkExtractor<E, Auth>>, St>(ctx).await?;
    let link_ids: Vec<_> = links.into_iter().map(|link| link.id).collect();
    let id_lists = ctx
        .data_opt::<SoupIdLists>()
        .filter(|_| selects_ids_only(ctx));
    let continuation = input.continuation_cursor().map(str::to_owned);
    let (request, sort_key) = match id_lists {
        Some(_) => input.into_keyed_request(macro_user_id, link_ids)?,
        None => (input.into_request(macro_user_id, link_ids)?, None),
    };
    span.record("limit", request.limit);
    if channel_reads == SoupChannelReads::Primary && !request.is_channel_directory_page() {
        return Err(async_graphql::Error::new(PRIMARY_CHANNEL_READS_REFUSED));
    }

    // Always forward the optional team receipt: Soup uses it for all
    // team-scoped foreign entities, not only CRM-scoped filters.
    let Cached(team) = extract_part::<
        Cached<OptionalMacroUserTeamExtractorV2<MemberTeamRole, EAS, Auth>>,
        St,
    >(ctx)
    .await?;
    let team_receipt = team.entity_access_receipt;

    // An ID-only page of a sync stream is a slice of the lane's ordered list.
    if let Some(id_lists) = id_lists
        && let Some(sort_key) = sort_key
    {
        let page = id_lists
            .page(
                service,
                request,
                sort_key,
                continuation.as_deref(),
                team_receipt,
            )
            .await?;
        return Ok(SoupPage::new(page));
    }

    let include_frecency = ctx
        .look_ahead()
        .field("items")
        .field("frecencyScore")
        .exists();

    let page = if include_frecency {
        let page = service
            .get_user_soup_with_frecency_and_projection(request, team_receipt)
            .await?;
        SoupPage::new_from_enriched_with_projection(page.type_erase())
    } else {
        let page = service
            .get_user_soup_with_projection(request, team_receipt)
            .await?;
        SoupPage::new_with_projection(page.type_erase())
    };
    if ctx.data_opt::<SoupPagePrefetch>().is_some() {
        let prefetch = EmailThreadPrefetch::for_soup_items(ctx);
        let thread_ids = page.email_thread_ids();
        if prefetch.any() && !thread_ids.is_empty() {
            prefetch_email_threads::<Edges>(ctx, thread_ids, prefetch).await;
        }
    }
    Ok(page)
}

/// Loads the page's email threads' per-thread data in one batch per loader.
/// Boxed so its loaders' futures get no slot in the resolver's poll frame
/// (see `SoupIdLists::page`).
fn prefetch_email_threads<'a, Edges: SoupEntityEdges>(
    ctx: &'a Context<'_>,
    thread_ids: Vec<uuid::Uuid>,
    prefetch: EmailThreadPrefetch,
) -> Pin<Box<dyn Future<Output = ()> + Send + 'a>> {
    Box::pin(Edges::prefetch_email_threads(ctx, thread_ids, prefetch))
}

#[cfg(test)]
mod tests;
