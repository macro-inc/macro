use std::sync::Arc;

use async_graphql::Context;
use axum::extract::FromRef;
use axum_extra::extract::Cached;
use email::{
    domain::ports::EmailService,
    inbound::axum::{axum_impls::MultiEmailLinkExtractor, previews_router::EmailRouterState},
};
use entity_access::{
    domain::{models::MemberTeamRole, ports::EntityAccessService},
    inbound::axum_extractors::OptionalMacroUserTeamExtractor,
};
use graphql_common::extract_part;
use model_user::axum_extractor::MacroUserExtractor;
use models_pagination::TypeEraseCursor;
use soup::domain::ports::SoupService;

use crate::{
    inputs::SoupInput,
    objects::{SoupEntityEdges, SoupPage},
};

/// Resolve a page of Soup items for the authenticated user: runs the lazy
/// axum extractors against the request context, converts the GraphQL input
/// into a Soup request, and executes it against the Soup service.
pub async fn resolve_soup<S, E, EAS, St, Edges>(
    service: &S,
    ctx: &Context<'_>,
    input: SoupInput,
) -> async_graphql::Result<SoupPage<Edges>>
where
    S: SoupService,
    E: EmailService,
    EAS: EntityAccessService,
    St: Clone + Send + Sync + 'static,
    EmailRouterState<E>: FromRef<St>,
    Arc<EAS>: FromRef<St>,
    Edges: SoupEntityEdges,
{
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
    let team_receipt = if effective_filter.requests_crm_scope()
        || effective_filter.requests_crm_admin()
    {
        let Cached(team) =
            extract_part::<Cached<OptionalMacroUserTeamExtractor<MemberTeamRole, EAS>>, St>(ctx)
                .await?;
        team.entity_access_receipt
    } else {
        None
    };

    let page = service.get_user_soup(request, team_receipt).await?;
    Ok(SoupPage::from(page.type_erase()))
}
