//! Initiative mutation fields delegating to the owning domain service.

use std::marker::PhantomData;

use async_graphql::{Context, ID, Object};
use graphql_common::{parse_id, require_authenticated_user};
use graphql_soup::{GraphqlSoupInitiative, SoupEntityEdges, SoupItemDataLoader};

use crate::{
    InitiativeGraphqlContext, graphql_error,
    inputs::{CreateInitiativeInput, UpdateInitiativeInput},
    query::load_from_soup,
};

/// Primary-backed canonical Soup reader for initiative detail and mutation replies.
/// List queries and subscriptions retain their replica-backed Soup reader.
#[derive(Clone)]
pub struct InitiativeEntityLoader(pub SoupItemDataLoader);

/// Root initiative mutations composed into the complete schema.
pub struct InitiativeMutationRoot<E: SoupEntityEdges>(PhantomData<E>);

impl<E: SoupEntityEdges> Default for InitiativeMutationRoot<E> {
    fn default() -> Self {
        Self(PhantomData)
    }
}

/// Authenticated initiative lifecycle and sharing mutations. Tasks join a project through
/// their Project property.
#[Object]
impl<E: SoupEntityEdges> InitiativeMutationRoot<E> {
    /// Create an initiative owned by the authenticated user.
    async fn create_initiative(
        &self,
        ctx: &Context<'_>,
        input: CreateInitiativeInput,
    ) -> async_graphql::Result<GraphqlSoupInitiative<E>> {
        let user = require_authenticated_user(ctx)?;
        let detail = ctx
            .data::<InitiativeGraphqlContext>()?
            .0
            .create(user.clone(), input.try_into()?)
            .await
            .map_err(graphql_error)?;
        load_from_soup(
            &ctx.data::<InitiativeEntityLoader>()?.0,
            user,
            detail.id.as_uuid(),
        )
        .await?
        .ok_or_else(|| graphql_error(initiative::domain::models::InitiativeError::NotFound))
    }

    /// Update project fields; owner-only sharing and membership policy remains in the domain.
    async fn update_initiative(
        &self,
        ctx: &Context<'_>,
        initiative_id: ID,
        input: UpdateInitiativeInput,
    ) -> async_graphql::Result<GraphqlSoupInitiative<E>> {
        let user = require_authenticated_user(ctx)?;
        let id = parse_id(initiative_id, "initiativeId")?;
        let detail = ctx
            .data::<InitiativeGraphqlContext>()?
            .0
            .update(user.clone(), id, input.into())
            .await
            .map_err(graphql_error)?;
        load_from_soup(
            &ctx.data::<InitiativeEntityLoader>()?.0,
            user,
            detail.id.as_uuid(),
        )
        .await?
        .ok_or_else(|| graphql_error(initiative::domain::models::InitiativeError::NotFound))
    }

    /// Idempotently ensure the collaborative description surface of an initiative the viewer
    /// can see, returning its id, which is the initiative's id. Call before connecting.
    async fn ensure_initiative_description_surface(
        &self,
        ctx: &Context<'_>,
        initiative_id: ID,
    ) -> async_graphql::Result<ID> {
        let user = require_authenticated_user(ctx)?;
        let id = parse_id(initiative_id, "initiativeId")?;
        ctx.data::<InitiativeGraphqlContext>()?
            .0
            .ensure_description_surface(user, id)
            .await
            .map_err(graphql_error)?;
        Ok(ID(id.to_string()))
    }

    /// Delete an initiative after its owner capability has been verified.
    async fn delete_initiative(
        &self,
        ctx: &Context<'_>,
        initiative_id: ID,
    ) -> async_graphql::Result<bool> {
        let user = require_authenticated_user(ctx)?;
        let id = parse_id(initiative_id, "initiativeId")?;
        ctx.data::<InitiativeGraphqlContext>()?
            .0
            .delete(user, id)
            .await
            .map_err(graphql_error)?;
        Ok(true)
    }
}
