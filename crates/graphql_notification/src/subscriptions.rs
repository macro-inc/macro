#[cfg(test)]
mod test;

use async_graphql::{Context, ID, OutputType, Subscription, Union};
use graphql_common::{GraphqlCacheDeletion, require_authenticated_user};
use model_notifications::NotifEvent;
use notification::domain::{
    models::NotificationSubscriptionUpdate,
    ports::{WebSocketNotificationSubscriptionExit, WebSocketNotificationSubscriptionService},
};
use tokio_stream::Stream;

use crate::GraphqlNotification;

/// Realtime notification patch represented as either an update or cache deletion.
#[allow(clippy::large_enum_variant)] // Notification updates already carry shared rows without allocation.
#[derive(Union)]
pub enum GraphqlNotificationPatch {
    /// A notification that was created or updated.
    Updated(GraphqlNotification),
    /// A normalized notification record that must be deleted.
    Deleted(GraphqlCacheDeletion),
}

impl From<NotificationSubscriptionUpdate<NotifEvent>> for GraphqlNotificationPatch {
    fn from(value: NotificationSubscriptionUpdate<NotifEvent>) -> Self {
        match value {
            NotificationSubscriptionUpdate::Updated(notification) => {
                Self::Updated(GraphqlNotification::from(notification))
            }
            NotificationSubscriptionUpdate::Deleted(notification_id) => {
                Self::Deleted(GraphqlCacheDeletion::new(
                    <GraphqlNotification as OutputType>::type_name(),
                    ID(notification_id.to_string()),
                ))
            }
        }
    }
}

/// Subscribe to realtime notifications addressed to the authenticated user.
pub fn subscribe_to_notifications<S>(
    service: &S,
    ctx: &Context<'_>,
) -> async_graphql::Result<
    impl Stream<Item = async_graphql::Result<GraphqlNotificationPatch>> + Send + 'static,
>
where
    S: WebSocketNotificationSubscriptionService<NotificationSubscriptionUpdate<NotifEvent>>,
{
    let user_id = require_authenticated_user(ctx)?;
    let mut subscription = service.subscribe(user_id.clone());

    Ok(async_stream::stream! {
        while let Some(update) = subscription.recv().await {
            yield Ok(GraphqlNotificationPatch::from(update));
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
    S: WebSocketNotificationSubscriptionService<NotificationSubscriptionUpdate<NotifEvent>>,
{
    /// Subscribe to realtime notifications for the authenticated user.
    async fn notification_updates(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<
        impl Stream<Item = async_graphql::Result<GraphqlNotificationPatch>> + 'static,
    > {
        subscribe_to_notifications(&self.service, ctx)
    }
}
