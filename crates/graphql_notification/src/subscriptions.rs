#[cfg(test)]
mod test;

use std::sync::Arc;

use async_graphql::{Context, Subscription};
use graphql_common::require_authenticated_user;
use model_notifications::NotifEvent;
use notification::domain::{
    models::queue_message::RealtimeNotif,
    ports::{WebSocketNotificationSubscriptionExit, WebSocketNotificationSubscriptionService},
};
use tokio_stream::Stream;

use crate::GraphqlSoupNotification;

/// Subscribe to realtime notifications addressed to the authenticated user.
pub fn subscribe_to_notifications<S>(
    service: &S,
    ctx: &Context<'_>,
) -> async_graphql::Result<
    impl Stream<Item = async_graphql::Result<GraphqlSoupNotification>> + Send + 'static,
>
where
    S: WebSocketNotificationSubscriptionService<RealtimeNotif<NotifEvent>>,
{
    let user_id = require_authenticated_user(ctx)?;
    let mut subscription = service.subscribe(user_id.clone());

    Ok(async_stream::stream! {
        while let Some(notification) = subscription.recv().await {
            let notification = Arc::unwrap_or_clone(notification);
            yield Ok(GraphqlSoupNotification::from_realtime(user_id.clone(), notification));
        }

        match subscription.exit_reason().await {
            WebSocketNotificationSubscriptionExit::SlowConsumer => {
                yield Err(async_graphql::Error::new(
                    "notification subscription closed because the client was too slow",
                ));
            }
            WebSocketNotificationSubscriptionExit::Lagging { .. } => {
                yield Err(async_graphql::Error::new(
                    "notification subscription closed after falling behind",
                ));
            }
            WebSocketNotificationSubscriptionExit::Closed => {}
        }
    })
}

/// Root GraphQL adapter for realtime notification subscriptions.
pub struct NotificationSubscriptionRoot<S> {
    /// User-scoped notification subscription service.
    service: S,
}

impl<S> NotificationSubscriptionRoot<S> {
    /// Creates a notification subscription root backed by `service`.
    pub fn new(service: S) -> Self {
        Self { service }
    }
}

#[Subscription]
impl<S> NotificationSubscriptionRoot<S>
where
    S: WebSocketNotificationSubscriptionService<RealtimeNotif<NotifEvent>>,
{
    /// Subscribe to realtime notifications for the authenticated user.
    async fn notification_updates(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<
        impl Stream<Item = async_graphql::Result<GraphqlSoupNotification>> + 'static,
    > {
        subscribe_to_notifications(&self.service, ctx)
    }
}
