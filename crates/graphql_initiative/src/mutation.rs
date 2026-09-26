//! Initiative mutation fields delegating to the owning domain service.

use std::marker::PhantomData;

use async_graphql::{Context, ID, Object};
use graphql_common::{parse_id, require_authenticated_user};
use graphql_soup::SoupEntityEdges;

use crate::{
    GraphqlInitiative, InitiativeGraphqlContext, graphql_error,
    inputs::{CreateInitiativeInput, UpdateInitiativeInput},
    objects::GraphqlInitiativeTaskAssignment,
};

/// Root initiative mutations composed into the complete schema.
pub struct InitiativeMutationRoot<E: SoupEntityEdges>(PhantomData<E>);

impl<E: SoupEntityEdges> Default for InitiativeMutationRoot<E> {
    fn default() -> Self {
        Self(PhantomData)
    }
}

/// Authenticated initiative lifecycle, sharing, and task relationship mutations.
#[Object]
impl<E: SoupEntityEdges> InitiativeMutationRoot<E> {
    /// Create an initiative owned by the authenticated user.
    async fn create_initiative(
        &self,
        ctx: &Context<'_>,
        input: CreateInitiativeInput,
    ) -> async_graphql::Result<GraphqlInitiative<E>> {
        let user = require_authenticated_user(ctx)?;
        let detail = ctx
            .data::<InitiativeGraphqlContext>()?
            .0
            .create(user, input.into())
            .await
            .map_err(graphql_error)?;
        Ok(GraphqlInitiative::from_detail(detail))
    }

    /// Update project fields; owner-only sharing and membership policy remains in the domain.
    async fn update_initiative(
        &self,
        ctx: &Context<'_>,
        initiative_id: ID,
        input: UpdateInitiativeInput,
    ) -> async_graphql::Result<GraphqlInitiative<E>> {
        let user = require_authenticated_user(ctx)?;
        let id = parse_id(initiative_id, "initiativeId")?;
        let detail = ctx
            .data::<InitiativeGraphqlContext>()?
            .0
            .update(user, id, input.into())
            .await
            .map_err(graphql_error)?;
        Ok(GraphqlInitiative::from_detail(detail))
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

    /// Assign or move tasks, preserving partial task authorization results.
    async fn assign_initiative_tasks(
        &self,
        ctx: &Context<'_>,
        initiative_id: ID,
        task_ids: Vec<ID>,
    ) -> async_graphql::Result<Vec<GraphqlInitiativeTaskAssignment>> {
        let user = require_authenticated_user(ctx)?;
        let id = parse_id(initiative_id, "initiativeId")?;
        let result = ctx
            .data::<InitiativeGraphqlContext>()?
            .0
            .assign(
                user,
                id,
                task_ids.into_iter().map(|id| id.to_string()).collect(),
            )
            .await
            .map_err(graphql_error)?;
        Ok(result.results.into_iter().map(Into::into).collect())
    }

    /// Remove a task using project and task edit capabilities.
    async fn unassign_initiative_task(
        &self,
        ctx: &Context<'_>,
        initiative_id: ID,
        task_id: ID,
    ) -> async_graphql::Result<bool> {
        let user = require_authenticated_user(ctx)?;
        let id = parse_id(initiative_id, "initiativeId")?;
        ctx.data::<InitiativeGraphqlContext>()?
            .0
            .unassign(user, id, task_id.to_string())
            .await
            .map_err(graphql_error)?;
        Ok(true)
    }

    /// Clear a task's project using task edit access, even after project access is revoked.
    async fn clear_task_initiative(
        &self,
        ctx: &Context<'_>,
        task_id: ID,
    ) -> async_graphql::Result<bool> {
        let user = require_authenticated_user(ctx)?;
        ctx.data::<InitiativeGraphqlContext>()?
            .0
            .clear(user, task_id.to_string())
            .await
            .map_err(graphql_error)?;
        Ok(true)
    }
}
