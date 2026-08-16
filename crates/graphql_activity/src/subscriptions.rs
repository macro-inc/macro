//! Realtime activity subscription for the authenticated user.

#[cfg(test)]
mod test;

use activity::{ActivitySubscriptionExit, ActivitySubscriptionService, ActivitySubscriptionUpdate};
use async_graphql::{Context, ID, OutputType, Subscription, Union};
use graphql_common::{GraphqlCacheDeletion, require_authenticated_user};
use tokio_stream::Stream;

use crate::GraphqlActivityEvent;

/// Realtime activity patch: a recorded event, or a cache deletion for a
/// purged one.
#[allow(clippy::large_enum_variant)] // Updates dominate; deletions are rare purge signals.
#[derive(Union)]
pub enum GraphqlActivityPatch {
    /// An activity event that was durably recorded.
    Updated(GraphqlActivityEvent),
    /// A normalized activity record that must be deleted.
    Deleted(GraphqlCacheDeletion),
}

impl From<ActivitySubscriptionUpdate> for GraphqlActivityPatch {
    fn from(value: ActivitySubscriptionUpdate) -> Self {
        match value {
            ActivitySubscriptionUpdate::Updated(record) => {
                Self::Updated(GraphqlActivityEvent::from(record.as_ref().clone()))
            }
            ActivitySubscriptionUpdate::Deleted(activity_id) => {
                Self::Deleted(GraphqlCacheDeletion::new(
                    <GraphqlActivityEvent as OutputType>::type_name(),
                    ID(activity_id.to_string()),
                ))
            }
        }
    }
}

/// Subscribe to realtime activity whose subject is the authenticated user.
pub fn subscribe_to_activity<S: ActivitySubscriptionService>(
    service: &S,
    ctx: &Context<'_>,
) -> async_graphql::Result<
    impl Stream<Item = async_graphql::Result<GraphqlActivityPatch>> + Send + 'static,
> {
    let user_id = require_authenticated_user(ctx)?;
    let mut subscription = service.subscribe(user_id.clone());

    Ok(async_stream::stream! {
        while let Some(update) = subscription.recv().await {
            yield Ok(GraphqlActivityPatch::from(update));
        }

        match subscription.exit_reason().await {
            ActivitySubscriptionExit::SlowConsumer => {
                yield Err(async_graphql::Error::new(
                    "activity subscription closed because the client was too slow",
                ));
            }
            ActivitySubscriptionExit::Lagging { .. } => {
                yield Err(async_graphql::Error::new(
                    "activity subscription closed after falling behind",
                ));
            }
            ActivitySubscriptionExit::Closed => {}
        }
    })
}

/// Root GraphQL adapter for realtime activity subscriptions.
pub struct ActivitySubscriptionRoot<S> {
    /// User-scoped activity subscription service.
    service: S,
}

impl<S> ActivitySubscriptionRoot<S> {
    /// Creates an activity subscription root backed by `service`.
    pub fn new(service: S) -> Self {
        Self { service }
    }
}

#[Subscription]
impl<S: ActivitySubscriptionService> ActivitySubscriptionRoot<S> {
    /// Subscribe to realtime activity for the authenticated user.
    async fn activity_updates(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<
        impl Stream<Item = async_graphql::Result<GraphqlActivityPatch>> + 'static,
    > {
        subscribe_to_activity(&self.service, ctx)
    }
}
