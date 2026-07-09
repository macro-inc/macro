//! GraphQL inbound adapter for the notification domain: the notification
//! object type and the DataLoader-backed entity notification edge.
#![deny(missing_docs)]

mod loaders;
mod objects;

pub use loaders::{
    EntityNotificationsKey, EntityNotificationsLoader, SoupNotificationEdgeReader,
    entity_notifications_loader,
};
pub use objects::{GraphqlSoupNotification, load_entity_notifications};
