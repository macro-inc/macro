//! Viewer-scoped initiative query resolvers.

use async_graphql::{Context, ID};
use graphql_common::parse_id;
use graphql_soup::SoupEntityEdges;
use macro_user_id::user_id::MacroUserIdStr;

use crate::{
    GraphqlInitiative, GraphqlInitiativePage, GraphqlInitiativeTasksPage,
    GraphqlTaskInitiativeReference, InitiativeGraphqlContext, InitiativePageInput,
    InitiativeTasksInput, graphql_error,
};

/// Resolve a project visible to the authenticated viewer.
pub async fn resolve_initiative<E: SoupEntityEdges>(
    ctx: &Context<'_>,
    user: MacroUserIdStr<'static>,
    initiative_id: ID,
) -> async_graphql::Result<GraphqlInitiative<E>> {
    let id = parse_id(initiative_id, "initiativeId")?;
    let detail = ctx
        .data::<InitiativeGraphqlContext>()?
        .0
        .get(user, id)
        .await
        .map_err(graphql_error)?;
    Ok(GraphqlInitiative::from_detail(detail))
}

/// Resolve the viewer's filtered, paginated initiative collection.
pub async fn resolve_initiatives<E: SoupEntityEdges>(
    ctx: &Context<'_>,
    user: MacroUserIdStr<'static>,
    input: InitiativePageInput,
) -> async_graphql::Result<GraphqlInitiativePage<E>> {
    let page = ctx
        .data::<InitiativeGraphqlContext>()?
        .0
        .page(user, input.into_model()?)
        .await
        .map_err(graphql_error)?;
    Ok(page.into())
}

/// Resolve visible tasks from an authorized initiative.
pub async fn resolve_initiative_tasks(
    ctx: &Context<'_>,
    user: MacroUserIdStr<'static>,
    initiative_id: ID,
    input: InitiativeTasksInput,
) -> async_graphql::Result<GraphqlInitiativeTasksPage> {
    let id = parse_id(initiative_id, "initiativeId")?;
    let page = ctx
        .data::<InitiativeGraphqlContext>()?
        .0
        .tasks(user, id, input.into())
        .await
        .map_err(graphql_error)?;
    Ok(page.into())
}

/// Resolve project chips without exposing inaccessible project identifiers.
pub async fn resolve_task_initiative_references<E: SoupEntityEdges>(
    ctx: &Context<'_>,
    user: MacroUserIdStr<'static>,
    task_ids: Vec<ID>,
) -> async_graphql::Result<Vec<GraphqlTaskInitiativeReference<E>>> {
    let references = ctx
        .data::<InitiativeGraphqlContext>()?
        .0
        .references(
            user,
            task_ids.into_iter().map(|id| id.to_string()).collect(),
        )
        .await
        .map_err(graphql_error)?;
    Ok(references.references.into_iter().map(Into::into).collect())
}
