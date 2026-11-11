use std::marker::PhantomData;

use async_graphql::{Context, Subscription};
use attention_feed::domain::{
    live::{COALESCE_WINDOW, coalesce},
    models::CandidateKeying,
};
use futures::{Stream, StreamExt};
use graphql_common::require_authenticated_user;
use graphql_soup::SoupEntityEdges;

use crate::{
    context::WorkFeedGraphqlContext, inputs::WorkFeedScopeInput, objects::GraphqlWorkFeedPatch,
};

/// Root GraphQL adapter for the work feed subscription.
pub struct WorkFeedSubscriptionRoot<E>(PhantomData<fn() -> E>);

impl<E> Default for WorkFeedSubscriptionRoot<E> {
    fn default() -> Self {
        Self(PhantomData)
    }
}

#[Subscription]
impl<E: SoupEntityEdges> WorkFeedSubscriptionRoot<E> {
    /// Changes to the authenticated user's work feed in `scope`: entries to
    /// insert or move, items to remove, and an invalidation when changes may
    /// have been missed. Each payload is one batch to apply together. Start
    /// it before fetching the first page and refetch after an invalidation;
    /// the stream ends with an error when its sources end, after which the
    /// client resubscribes and refetches.
    async fn work_feed_updates(
        &self,
        ctx: &Context<'_>,
        scope: Option<WorkFeedScopeInput>,
    ) -> async_graphql::Result<
        impl Stream<Item = async_graphql::Result<Vec<GraphqlWorkFeedPatch<E>>>> + 'static,
    > {
        let user = require_authenticated_user(ctx)?;
        let context = ctx.data::<WorkFeedGraphqlContext>()?.clone();
        let scope = scope.unwrap_or_default().into_scope();
        let viewer = context.viewer(user.clone()).await?;
        let triggers =
            context
                .triggers
                .subscribe(user, CandidateKeying::ThreadScoped, scope.mode.own_work());

        Ok(async_stream::stream! {
            let batches = coalesce(triggers, COALESCE_WINDOW);
            futures::pin_mut!(batches);
            while let Some(batch) = batches.next().await {
                if batch.invalidated {
                    yield Ok(vec![GraphqlWorkFeedPatch::invalidated()]);
                    continue;
                }
                match context.service.recompute(viewer.clone(), scope.clone(), batch.keys).await {
                    Ok(changes) if changes.is_empty() => {}
                    Ok(changes) => {
                        yield Ok(changes.into_iter().map(GraphqlWorkFeedPatch::from).collect());
                    }
                    Err(error) => {
                        tracing::error!(error = ?error, "work feed recompute failed");
                        yield Ok(vec![GraphqlWorkFeedPatch::invalidated()]);
                    }
                }
            }
            yield Err(async_graphql::Error::new(
                "work feed subscription ended; resubscribe and refetch the feed",
            ));
        })
    }
}
