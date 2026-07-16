//! GraphQL inbound adapter for the notification domain: the notification
//! object type and the DataLoader-backed entity notification edge.
#![deny(missing_docs)]
#![deny(clippy::missing_docs_in_private_items)]

/// DataLoader implementations for notification edges.
mod loaders;
/// GraphQL notification object and edge resolver.
mod objects;

pub use loaders::{
    EntityNotificationsLoader, NoOpSoupNotificationEdgeReader, SoupNotificationEdgeReader,
    entity_notifications_loader,
};
pub use objects::{GraphqlSoupNotification, load_entity_notifications};
