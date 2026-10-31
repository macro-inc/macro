//! Viewer-scoped initiative query resolvers.

use async_graphql::{Context, ID};
use graphql_common::{optional_authenticated_user, parse_id};
use graphql_soup::{GraphqlSoupEntity, GraphqlSoupInitiative, SoupEntityEdges, SoupItemDataLoader};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use uuid::Uuid;

use crate::{
    GraphqlInitiativeTasksPage, InitiativeEntityLoader, InitiativeGraphqlContext,
    InitiativeTasksInput, graphql_error,
};

/// Hydrate the canonical Soup object from the primary for read-after-write
/// consistency, for a viewer with or without an account.
pub(crate) async fn load_initiative<E: SoupEntityEdges>(
    ctx: &Context<'_>,
    id: Uuid,
) -> async_graphql::Result<Option<GraphqlSoupInitiative<E>>> {
    load_from_soup(
        &ctx.data::<InitiativeEntityLoader>()?.0,
        optional_authenticated_user(ctx),
        id,
    )
    .await
}

/// Resolve a canonical initiative the viewer may view; Soup hydrates it from
/// an entity access receipt, so a public or team link opens it.
pub(crate) async fn load_from_soup<E: SoupEntityEdges>(
    loader: &SoupItemDataLoader,
    viewer: Option<MacroUserIdStr<'static>>,
    id: Uuid,
) -> async_graphql::Result<Option<GraphqlSoupInitiative<E>>> {
    let entity = EntityType::Initiative.with_entity_string(id.to_string());
    let Some(item) = loader.load_one((viewer, entity)).await? else {
        return Ok(None);
    };
    match GraphqlSoupEntity::<E>::new_with_projection(item) {
        GraphqlSoupEntity::Initiative(initiative) => Ok(Some(initiative)),
        _ => Err(async_graphql::Error::new(
            "Soup returned a non-initiative entity for an initiative request",
        )),
    }
}

/// Resolve a project the viewer may view, signed in or not, without loading its details.
pub async fn resolve_initiative<E: SoupEntityEdges>(
    ctx: &Context<'_>,
    initiative_id: ID,
) -> async_graphql::Result<GraphqlSoupInitiative<E>> {
    let id = parse_id(initiative_id, "initiativeId")?;
    load_initiative(ctx, id)
        .await?
        .ok_or_else(|| graphql_error(initiative::domain::models::InitiativeError::NotFound))
}

/// Resolve the tasks of an initiative that the viewer, signed in or not, may view.
pub async fn resolve_initiative_tasks(
    ctx: &Context<'_>,
    viewer: Option<MacroUserIdStr<'static>>,
    initiative_id: ID,
    input: InitiativeTasksInput,
) -> async_graphql::Result<GraphqlInitiativeTasksPage> {
    let id = parse_id(initiative_id, "initiativeId")?;
    let page = ctx
        .data::<InitiativeGraphqlContext>()?
        .0
        .tasks(viewer, id, input.into())
        .await
        .map_err(graphql_error)?;
    Ok(page.into())
}
