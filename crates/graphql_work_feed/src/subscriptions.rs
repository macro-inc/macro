use std::{collections::HashSet, marker::PhantomData, time::Duration};

use async_graphql::{Context, Subscription};
use futures::Stream;
use graphql_common::require_authenticated_user;
use graphql_soup::SoupEntityEdges;
use work_feed::domain::models::{WorkFeedItemKey, WorkFeedTrigger};

use crate::{
    context::WorkFeedGraphqlContext, inputs::WorkFeedScopeInput, objects::GraphqlWorkFeedPatch,
};

#[cfg(test)]
mod test;

/// How long triggers are collected before one recompute, so a burst of
/// realtime events (a busy thread, a bulk done) costs one feed lookup.
const COALESCE_WINDOW: Duration = Duration::from_millis(300);

/// The triggers collected for one recompute.
#[derive(Default)]
struct TriggerBatch {
    /// Keys to recompute, in arrival order.
    keys: Vec<WorkFeedItemKey>,
    /// Keys already in `keys`.
    seen: HashSet<WorkFeedItemKey>,
    /// Whether any trigger said changes may have been missed.
    invalidated: bool,
}

impl TriggerBatch {
    /// Add one trigger to the batch.
    fn absorb(&mut self, trigger: WorkFeedTrigger) {
        match trigger {
            WorkFeedTrigger::Changed(entities) => {
                for entity in entities {
                    let key = WorkFeedItemKey::new(entity);
                    if self.seen.insert(key.clone()) {
                        self.keys.push(key);
                    }
                }
            }
            WorkFeedTrigger::Invalidated => self.invalidated = true,
        }
    }
}

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
        let mut triggers = context.triggers.subscribe(user);

        Ok(async_stream::stream! {
            while let Some(first) = triggers.recv().await {
                let mut batch = TriggerBatch::default();
                batch.absorb(first);
                let window = tokio::time::sleep(COALESCE_WINDOW);
                tokio::pin!(window);
                let mut open = true;
                while open {
                    tokio::select! {
                        () = &mut window => break,
                        next = triggers.recv() => match next {
                            Some(trigger) => batch.absorb(trigger),
                            None => open = false,
                        },
                    }
                }

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
