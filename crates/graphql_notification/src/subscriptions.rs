#[cfg(test)]
mod test;

use async_graphql::{Context, ID, OutputType, SimpleObject, Subscription, Union};
use graphql_common::{GraphqlCacheDeletion, require_authenticated_user};
use model_notifications::NotifEvent;
use notification::domain::{
    models::{NotificationLane, NotificationSubscriptionUpdate},
    ports::{WebSocketNotificationSubscriptionExit, WebSocketNotificationSubscriptionService},
};
use tokio_stream::Stream;

use crate::GraphqlNotification;

/// A newly delivered notification patch.
#[derive(SimpleObject)]
pub struct GraphqlNewNotification {
    /// The newly delivered notification.
    pub notification: GraphqlNotification,
}

/// An update to an existing notification.
#[derive(SimpleObject)]
pub struct GraphqlUpdatedNotification {
    /// The updated notification.
    pub notification: GraphqlNotification,
}

/// Realtime notification patch represented as a new, updated, or deleted notification.
#[allow(clippy::large_enum_variant)] // Notification updates already carry shared rows without allocation.
#[derive(Union)]
pub enum GraphqlNotificationPatch {
    /// A notification newly delivered to the user.
    New(GraphqlNewNotification),
    /// An existing notification that was updated.
    Updated(GraphqlUpdatedNotification),
    /// A normalized notification record that must be deleted.
    Deleted(GraphqlCacheDeletion),
}

impl From<NotificationSubscriptionUpdate<NotifEvent>> for GraphqlNotificationPatch {
    fn from(value: NotificationSubscriptionUpdate<NotifEvent>) -> Self {
        match value {
            NotificationSubscriptionUpdate::New(notification) => {
                Self::New(GraphqlNewNotification {
                    notification: GraphqlNotification::from(notification),
                })
            }
            NotificationSubscriptionUpdate::Updated(notification) => {
                Self::Updated(GraphqlUpdatedNotification {
                    notification: GraphqlNotification::from(notification),
                })
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

/// Whether `update` carries a noise row. Deletions name no row and always pass.
fn is_noise(update: &NotificationSubscriptionUpdate<NotifEvent>) -> bool {
    match update {
        NotificationSubscriptionUpdate::New(row) | NotificationSubscriptionUpdate::Updated(row) => {
            row.lane == NotificationLane::Noise
        }
        NotificationSubscriptionUpdate::Deleted(_) => false,
    }
}

/// Subscribe to realtime signal notifications addressed to the authenticated
/// user.
///
/// Noise never reaches this stream. Clients play sounds, raise alerts and
/// mark entities unread from it, including clients released before lanes
/// existed, so the server withholds noise instead of trusting each client to
/// skip it. The Noise view follows the notification inbox subscription.
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
            if is_noise(&update) {
                continue;
            }
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
    /// Subscribe to realtime notifications for the authenticated user. Noise
    /// is never sent here; the notification inbox subscription carries it.
    async fn notification_updates(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<
        impl Stream<Item = async_graphql::Result<GraphqlNotificationPatch>> + 'static,
    > {
        subscribe_to_notifications(&self.service, ctx)
    }
}
