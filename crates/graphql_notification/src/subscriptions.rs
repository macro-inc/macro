#[cfg(test)]
mod test;

use std::sync::Arc;

use async_graphql::{Context, ID, Object, Subscription};
use graphql_common::require_authenticated_user;
use model_notifications::NotifEvent;
use notification::domain::{
    models::queue_message::RealtimeNotif, ports::WebSocketNotificationSubscriptionService,
};
use tokio_stream::{Stream, StreamExt as _, wrappers::ReceiverStream};

use crate::GraphqlNotifEvent;

/// GraphQL representation of a realtime notification.
pub struct GraphqlRealtimeNotification(Arc<RealtimeNotif<NotifEvent>>);

impl From<Arc<RealtimeNotif<NotifEvent>>> for GraphqlRealtimeNotification {
    fn from(value: Arc<RealtimeNotif<NotifEvent>>) -> Self {
        Self(value)
    }
}

/// A notification delivered to the authenticated user in realtime.
#[Object]
impl GraphqlRealtimeNotification {
    /// The notification identifier.
    async fn id(&self) -> ID {
        ID(self.0.notification_id.to_string())
    }

    /// The event that produced the notification.
    async fn event_type(&self) -> &str {
        &self.0.notification_event_type
    }

    /// The type of the associated entity.
    async fn entity_type(&self) -> graphql_common::GraphqlEntityType {
        graphql_common::GraphqlEntityType::new(self.0.entity.entity_type)
    }

    /// The identifier of the associated entity.
    async fn entity_id(&self) -> &str {
        &self.0.entity.entity_id
    }

    /// Whether the notification has been sent.
    async fn sent(&self) -> bool {
        self.0.sent
    }

    /// Whether notification processing is complete.
    async fn done(&self) -> bool {
        self.0.done
    }

    /// Whether the recipient has seen the notification.
    async fn seen(&self) -> bool {
        self.0.viewed_at.is_some()
    }

    /// The notification creation time in RFC 3339 format.
    async fn created_at(&self) -> String {
        self.0.created_at.to_rfc3339()
    }

    /// The time the notification was viewed, in RFC 3339 format.
    async fn viewed_at(&self) -> Option<String> {
        self.0.viewed_at.map(|ts| ts.to_rfc3339())
    }

    /// The notification's last update time in RFC 3339 format.
    async fn updated_at(&self) -> String {
        self.0.updated_at.to_rfc3339()
    }

    /// The identifier of the user who triggered the notification.
    async fn sender_id(&self) -> Option<String> {
        self.0.sender_id.as_ref().map(ToString::to_string)
    }

    /// Event-specific notification metadata.
    async fn metadata(&self) -> GraphqlNotifEvent {
        self.0.notification_metadata.clone().into()
    }
}

/// Subscribe to realtime notifications addressed to the authenticated user.
pub fn subscribe_to_notifications<S>(
    service: &S,
    ctx: &Context<'_>,
) -> async_graphql::Result<impl Stream<Item = GraphqlRealtimeNotification> + Send + 'static>
where
    S: WebSocketNotificationSubscriptionService<RealtimeNotif<NotifEvent>>,
{
    let user_id = require_authenticated_user(ctx)?;
    Ok(ReceiverStream::new(service.subscribe(user_id)).map(Into::into))
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
    ) -> async_graphql::Result<impl Stream<Item = GraphqlRealtimeNotification> + 'static> {
        subscribe_to_notifications(&self.service, ctx)
    }
}
