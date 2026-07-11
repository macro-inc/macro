use std::sync::Arc;

use async_graphql::Context;
use axum::extract::FromRef;
use axum_extra::extract::Cached;
use email::{
    domain::ports::EmailService,
    inbound::axum::{axum_impls::MultiEmailLinkExtractor, previews_router::EmailRouterState},
};
use entity_access::{
    domain::{
        models::{EntityAccessReceipt, MemberTeamRole},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::OptionalMacroUserTeamExtractor,
};
use graphql_common::extract_part;
use model_user::axum_extractor::MacroUserExtractor;
use models_pagination::TypeEraseCursor;
use soup::domain::{models::SoupRequest, ports::SoupService};

use crate::{inputs::SoupInput, objects::SoupPage};

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

/// Resolve a page of Soup items for the authenticated user: runs the lazy
/// axum extractors against the request context, converts the GraphQL input
/// into a Soup request, and executes it against the Soup service.
pub async fn resolve_soup<S, E, EAS, St>(
    service: &S,
    ctx: &Context<'_>,
    input: SoupInput,
) -> async_graphql::Result<SoupPage>
where
    S: SoupService,
    E: EmailService,
    EAS: EntityAccessService,
    St: Clone + Send + Sync + 'static,
    EmailRouterState<E>: FromRef<St>,
    Arc<EAS>: FromRef<St>,
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
