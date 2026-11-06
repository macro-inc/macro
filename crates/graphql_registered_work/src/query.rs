use agent_session::domain::work_registration::WorkRegistration;
use async_graphql::{Context, ID};
use futures::future::join_all;
use graphql_soup::{AgentSessionEntityLoader, SoupEntityEdges, load_soup_agent_session};
use macro_user_id::user_id::MacroUserIdStr;

use crate::{
    context::{RegisteredWorkGraphqlContext, to_graphql_error},
    inputs::parse_account_ids,
    objects::GraphqlRegisteredWork,
};

/// Hydrate a registration with its session as `viewer` sees it. `None` when the viewer cannot
/// see the session, it is archived, or it failed to load: one bad row never fails a read.
pub(crate) async fn load_entry<E: SoupEntityEdges>(
    loader: &AgentSessionEntityLoader,
    viewer: &MacroUserIdStr<'static>,
    registration: WorkRegistration,
) -> Option<GraphqlRegisteredWork<E>> {
    let session =
        load_soup_agent_session::<E>(loader, viewer.clone(), registration.session.as_uuid())
            .await
            .inspect_err(|error| {
                tracing::warn!(
                    error = ?error.message,
                    agent.session.id = %registration.session,
                    "failed to load a registered work session"
                );
            })
            .ok()
            .flatten()?;
    if session.archived() {
        return None;
    }
    Some(GraphqlRegisteredWork::new(registration, session))
}

/// Resolve the registered work of `account_ids` that `viewer` can see, newest first.
pub async fn resolve_registered_work<E: SoupEntityEdges>(
    ctx: &Context<'_>,
    viewer: MacroUserIdStr<'static>,
    account_ids: Vec<ID>,
) -> async_graphql::Result<Vec<GraphqlRegisteredWork<E>>> {
    let context = ctx.data::<RegisteredWorkGraphqlContext>()?;
    let loader = ctx.data::<AgentSessionEntityLoader>()?;
    let accounts = parse_account_ids(account_ids)?;
    let registrations = context
        .service
        .visible_registrations(&viewer, &accounts)
        .await
        .map_err(to_graphql_error)?;
    let entries = registrations
        .into_iter()
        .map(|registration| load_entry::<E>(loader, &viewer, registration));
    Ok(join_all(entries).await.into_iter().flatten().collect())
}
