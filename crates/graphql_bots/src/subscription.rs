#[cfg(test)]
mod test;

use std::sync::Arc;

use async_graphql::{Context, Subscription};
use bots::domain::bot_updates::{BotUpdateSubscriptions, BotUpdatesExit};
use futures::Stream;
use graphql_common::require_authenticated_user;

use crate::GraphqlBot;

/// The bot update subscriptions, type-erased for request data.
#[derive(Clone)]
pub struct BotUpdatesGraphqlContext {
    subscriptions: Arc<dyn BotUpdateSubscriptions>,
}

impl BotUpdatesGraphqlContext {
    /// Bot updates served from `subscriptions`.
    pub fn new<S: BotUpdateSubscriptions>(subscriptions: Arc<S>) -> Self {
        Self { subscriptions }
    }
}

/// Root of the bot subscriptions.
#[derive(Default)]
pub struct BotsSubscriptionRoot;

#[Subscription]
impl BotsSubscriptionRoot {
    /// Bots the authenticated user sees, each time one is created, renamed,
    /// given a new picture or deleted, as it is now. Each payload is a batch
    /// of bots, each once. The stream ends with an error when it falls
    /// behind, after which the client resubscribes and refetches the bots it
    /// shows.
    async fn bot_updates(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<impl Stream<Item = async_graphql::Result<Vec<GraphqlBot>>> + 'static>
    {
        let viewer = require_authenticated_user(ctx)?;
        let context = ctx.data::<BotUpdatesGraphqlContext>()?;
        let mut subscription = context.subscriptions.subscribe(viewer);

        Ok(async_stream::stream! {
            while let Some(first) = subscription.recv().await {
                let mut batch = vec![first];
                while let Some(next) = subscription.try_recv() {
                    // The later identity of a bot replaces the earlier one.
                    batch.retain(|identity| identity.id != next.id);
                    batch.push(next);
                }
                yield Ok(batch.into_iter().map(GraphqlBot::from).collect());
            }
            match subscription.exit_reason().await {
                BotUpdatesExit::Closed => {}
                BotUpdatesExit::SlowConsumer | BotUpdatesExit::Lagging { .. } => {
                    yield Err(async_graphql::Error::new(
                        "bot updates fell behind; resubscribe and refetch",
                    ));
                }
            }
        })
    }
}
