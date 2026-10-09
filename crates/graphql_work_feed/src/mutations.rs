use std::marker::PhantomData;

use async_graphql::{Context, ID, Object, SimpleObject};
use graphql_common::require_authenticated_user;
use graphql_soup::SoupEntityEdges;
use work_feed::domain::models::WorkFeedDoneReceipt;

use crate::{
    context::{WorkFeedGraphqlContext, to_graphql_error},
    inputs::{MarkWorkFeedItemsDoneInput, UndoWorkFeedItemsDoneInput},
    objects::GraphqlWorkFeedPatch,
};

/// The result of marking work feed items done.
#[derive(SimpleObject)]
pub struct MarkWorkFeedItemsDonePayload {
    /// The completed items; remove them from every feed. Items that were
    /// already gone are included.
    item_ids: Vec<ID>,
    /// Opaque token that reverses exactly this operation.
    undo_token: String,
}

/// The result of undoing a mark-done.
#[derive(SimpleObject)]
pub struct UndoWorkFeedItemsDonePayload<E: SoupEntityEdges> {
    /// The restored items' places in the requested feed.
    patches: Vec<GraphqlWorkFeedPatch<E>>,
}

/// Root GraphQL adapter for work feed mutations.
pub struct WorkFeedMutationRoot<E>(PhantomData<fn() -> E>);

impl<E> Default for WorkFeedMutationRoot<E> {
    fn default() -> Self {
        Self(PhantomData)
    }
}

#[Object]
impl<E: SoupEntityEdges> WorkFeedMutationRoot<E> {
    /// Mark work feed items done for the authenticated user: acknowledge the
    /// notifications each entry showed and archive inbox email.
    /// Notifications newer than an entry's `revision` stay active. Own work
    /// is not acknowledged, so an item the user also worked on stays in the
    /// work feed, seen. Tasks, discussions and pull requests themselves are
    /// not completed.
    async fn mark_work_feed_items_done(
        &self,
        ctx: &Context<'_>,
        input: MarkWorkFeedItemsDoneInput,
    ) -> async_graphql::Result<MarkWorkFeedItemsDonePayload> {
        let user = require_authenticated_user(ctx)?;
        let context = ctx.data::<WorkFeedGraphqlContext>()?;
        let targets = input.into_targets()?;
        let viewer = context.viewer(user).await?;
        let outcome = context
            .service
            .mark_done(viewer, targets)
            .await
            .map_err(to_graphql_error)?;
        Ok(MarkWorkFeedItemsDonePayload {
            item_ids: outcome.items.iter().map(|key| ID(key.id())).collect(),
            undo_token: outcome.receipt.encode(),
        })
    }

    /// Reverse one mark-done for the authenticated user without overwriting
    /// anything that happened since, and return the restored items' places
    /// in the requested feed.
    async fn undo_work_feed_items_done(
        &self,
        ctx: &Context<'_>,
        input: UndoWorkFeedItemsDoneInput,
    ) -> async_graphql::Result<UndoWorkFeedItemsDonePayload<E>> {
        let user = require_authenticated_user(ctx)?;
        let context = ctx.data::<WorkFeedGraphqlContext>()?;
        let receipt = WorkFeedDoneReceipt::decode(&input.undo_token)
            .map_err(|_| async_graphql::Error::new("invalid work feed undo token"))?;
        let scope = input.scope.unwrap_or_default().into_scope();
        let viewer = context.viewer(user).await?;
        let changes = context
            .service
            .undo_done(viewer, scope, receipt)
            .await
            .map_err(to_graphql_error)?;
        Ok(UndoWorkFeedItemsDonePayload {
            patches: changes
                .into_iter()
                .map(GraphqlWorkFeedPatch::from)
                .collect(),
        })
    }
}
