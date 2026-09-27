//! Viewer-scoped initiative query resolvers.

use async_graphql::{Context, ID};
use graphql_common::{parse_id, require_authenticated_user};
use graphql_soup::{GraphqlSoupEntity, GraphqlSoupInitiative, SoupEntityEdges, SoupItemDataLoader};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use uuid::Uuid;

use crate::{
    GraphqlInitiativeTasksPage, GraphqlTaskInitiativeReference, InitiativeEntityLoader,
    InitiativeGraphqlContext, InitiativeTasksInput, graphql_error,
};

/// Hydrate the canonical Soup object from the primary for read-after-write consistency.
pub(crate) async fn load_initiative<E: SoupEntityEdges>(
    ctx: &Context<'_>,
    id: Uuid,
) -> async_graphql::Result<Option<GraphqlSoupInitiative<E>>> {
    load_from_soup(
        &ctx.data::<InitiativeEntityLoader>()?.0,
        require_authenticated_user(ctx)?,
        id,
    )
    .await
}

/// Resolve a canonical initiative from a permission-filtered Soup reader.
pub(crate) async fn load_from_soup<E: SoupEntityEdges>(
    loader: &SoupItemDataLoader,
    user: MacroUserIdStr<'static>,
    id: Uuid,
) -> async_graphql::Result<Option<GraphqlSoupInitiative<E>>> {
    let entity = EntityType::Initiative.with_entity_string(id.to_string());
    let Some(item) = loader.load_one((user, entity)).await? else {
        return Ok(None);
    };
    match GraphqlSoupEntity::<E>::new_with_projection(item) {
        GraphqlSoupEntity::Initiative(initiative) => Ok(Some(initiative)),
        _ => Err(async_graphql::Error::new(
            "Soup returned a non-initiative entity for an initiative request",
        )),
    }
}

/// Resolve a project visible to the authenticated viewer without loading its details.
pub async fn resolve_initiative<E: SoupEntityEdges>(
    ctx: &Context<'_>,
    initiative_id: ID,
) -> async_graphql::Result<GraphqlSoupInitiative<E>> {
    let id = parse_id(initiative_id, "initiativeId")?;
    load_initiative(ctx, id)
        .await?
        .ok_or_else(|| graphql_error(initiative::domain::models::InitiativeError::NotFound))
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
