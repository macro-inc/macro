use std::sync::Arc;

use async_graphql::{Context, ID};
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
use filter_ast::Expr;
use futures::Stream;
use graphql_common::{GraphqlSoupEntityType, extract_part, require_authorized_user};
use item_filters::ast::{
    EmailFilterAst, EntityFilterAst,
    call::CallLiteral,
    channel::{ChannelLiteral, ChannelThreadLiteral},
    chat::ChatLiteral,
    crm_company::CrmCompanyLiteral,
    document::DocumentLiteral,
    email::EmailLiteral,
    foreign_entity::ForeignEntityLiteral,
    project::ProjectLiteral,
};
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use models_pagination::{SimpleSortMethod, TypeEraseCursor};
use soup::domain::{
    models::{SoupQuery, SoupRequest, SoupType, grouping::NestedSoupGroups},
    ports::SoupService,
};
use soup_realtime::domain::ports::SoupRealtimeSubscriptionService;

use crate::{
    inputs::{GroupedSoupInput, SoupInput},
    objects::{GraphqlSoupEntity, GroupedSoup, SoupEntityEdges, SoupPage},
};

/// Subscribe to realtime Soup updates for the authenticated user.
pub async fn resolve_soup_updates<R, Auth, St, Edges>(
    service: &R,
    ctx: &Context<'_>,
) -> async_graphql::Result<impl Stream<Item = GraphqlSoupEntity<Edges>> + Send + 'static>
where
    R: SoupRealtimeSubscriptionService,
    Auth: MacroAuthorizationService,
    MacroAuthorizationState<Auth>: FromRef<St>,
    St: Clone + Send + Sync + 'static,
    Edges: SoupEntityEdges,
{
    let macro_user_id = require_authorized_user::<Auth, St>(ctx).await?;
    let mut receiver = service.subscribe(macro_user_id);

    Ok(async_stream::stream! {
        while let Some(item) = receiver.recv().await {
            yield GraphqlSoupEntity::from(item.as_ref().clone());
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
    Ok(GroupedSoup::from(
        groups.with_next_cursors(sort_method, filters),
    ))
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
        Ok(SoupPage::from(page.type_erase()))
    } else {
        let page = service.get_user_soup(request, team_receipt).await?;
        Ok(SoupPage::from(page.type_erase()))
    }
}

/// Resolve one canonical expanded Soup entity by type and id.
pub async fn resolve_entity<S, E, EAS, Auth, St, Edges>(
    service: &S,
    ctx: &Context<'_>,
    entity_type: GraphqlSoupEntityType,
    id: ID,
) -> async_graphql::Result<Option<GraphqlSoupEntity<Edges>>>
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
    let id = uuid::Uuid::parse_str(id.as_str())
        .map_err(|error| async_graphql::Error::new(format!("invalid entity id: {error}")))?;
    let mut filter = EntityFilterAst::default();
    match entity_type {
        GraphqlSoupEntityType::Document => {
            filter.document_filter = Some(Arc::new(Expr::val(DocumentLiteral::Id(id))));
        }
        GraphqlSoupEntityType::Chat => {
            filter.chat_filter = Some(Arc::new(Expr::val(ChatLiteral::ChatId(id))));
        }
        GraphqlSoupEntityType::Project => {
            filter.project_filter = Some(Arc::new(Expr::val(ProjectLiteral::ProjectIdSelf(id))));
        }
        GraphqlSoupEntityType::EmailThread => {
            filter.email_filter = EmailFilterAst {
                tree: Some(Arc::new(Expr::val(EmailLiteral::ThreadId(id)))),
                crm_scope: None,
            };
        }
        GraphqlSoupEntityType::Channel => {
            filter.channel_filter = Some(Arc::new(Expr::val(ChannelLiteral::ChannelId(id))));
        }
        GraphqlSoupEntityType::ChannelMessage => {
            filter.channel_thread_filter =
                Some(Arc::new(Expr::val(ChannelThreadLiteral::ThreadId(id))));
        }
        GraphqlSoupEntityType::Call => {
            filter.call_filter = Some(Arc::new(Expr::val(CallLiteral::CallId(id))));
        }
        GraphqlSoupEntityType::CrmCompany => {
            filter.crm_company_filter = Some(Arc::new(Expr::val(CrmCompanyLiteral::Id(id))));
        }
        GraphqlSoupEntityType::ForeignEntity => {
            filter.foreign_entity_filter = Some(Arc::new(Expr::val(ForeignEntityLiteral::Id(id))));
        }
    }

    let macro_user_id = require_authorized_user::<Auth, St>(ctx).await?;
    let Cached(MultiEmailLinkExtractor(links, _)) =
        extract_part::<Cached<MultiEmailLinkExtractor<E, Auth>>, St>(ctx).await?;
    // Forward the optional team receipt for team-scoped foreign entities,
    // matching the paginated Soup path.
    let Cached(team) = extract_part::<
        Cached<OptionalMacroUserTeamExtractorV2<MemberTeamRole, EAS, Auth>>,
        St,
    >(ctx)
    .await?;
    let team_receipt = team.entity_access_receipt;
    let request = SoupRequest {
        soup_type: SoupType::Expanded,
        limit: 1,
        cursor: SoupQuery::new_sort_simple(SimpleSortMethod::ViewedAt, filter),
        user: macro_user_id,
        email_preview_view: "all".parse().map_err(async_graphql::Error::new)?,
        link_ids: links.into_iter().map(|link| link.id).collect(),
    };
    let page = service
        .get_user_soup(request, team_receipt)
        .await?
        .type_erase();
    Ok(page.items.into_iter().next().map(GraphqlSoupEntity::from))
}
