//! GraphQL inbound adapter for the notification domain: the notification
//! object type and the DataLoader-backed entity notification edge.
#![deny(missing_docs)]
#![deny(clippy::missing_docs_in_private_items)]

/// DataLoader implementations for notification edges.
mod loaders;
/// GraphQL notification mutation adapter.
mod mutations;
/// Typed GraphQL notification event output models.
mod notification_event;
/// GraphQL notification object and edge resolver.
mod objects;
/// GraphQL realtime notification subscription adapter.
mod subscriptions;

pub use loaders::{
    EntityNotificationsLoader, NoOpSoupNotificationEdgeReader, SoupNotificationEdgeReader,
    entity_notifications_loader,
};
pub use mutations::{
    GraphqlNotificationUpdateOperation, NoOpNotificationMutationService, NotificationMutationRoot,
    NotificationMutationService, UpdateNotificationsInput,
};
pub use notification_event::GraphqlNotifEvent;
pub use objects::{GraphqlNotification, load_entity_notifications};
pub use subscriptions::{
    GraphqlNotificationPatch, NotificationSubscriptionRoot, subscribe_to_notifications,
};
