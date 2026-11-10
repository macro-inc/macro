//! Where a notification is routed before delivery.

use std::collections::{HashMap, HashSet};

use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use uuid::Uuid;

use super::{NotificationLane, TaggedContent};

/// One recipient's routing decision, made once at ingress and stored on
/// their row.
#[derive(Debug, Clone, PartialEq)]
pub struct RecipientRoute {
    /// The lane the recipient's row lands in.
    pub lane: NotificationLane,
    /// The stack holding the row. `None` for a notification its stack released.
    pub stack_id: Option<Uuid>,
    /// Why the router decided this, stored as written.
    pub routing: serde_json::Value,
}

/// Routing decisions by recipient. A recipient without one gets the natural
/// row: the signal lane, no stack, delivered as usual.
pub type RecipientRoutes = HashMap<MacroUserIdStr<'static>, RecipientRoute>;

/// What a router sees of a notification about to be stored.
pub struct RoutedNotification<'a, T> {
    /// The notification's id.
    pub notification_id: Uuid,
    /// The event type name, such as `channel_mention`.
    pub notification_type: &'a str,
    /// The payload. It serializes as `{"tag": <type>, "content": <metadata>}`.
    pub notification: &'a TaggedContent<T>,
    /// The entity the notification is filed under.
    pub entity: &'a Entity<'a>,
    /// The person who caused it. Bots and system senders have none.
    pub sender_id: Option<&'a MacroUserIdStr<'a>>,
    /// Everyone about to receive it, after mutes and preferences.
    pub recipients: &'a HashSet<MacroUserIdStr<'a>>,
}
