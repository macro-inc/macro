//! Filters for an entity's notification edge.

use super::NotificationState;

/// Selection applied independently to each entity before limiting its results.
/// Defaults return the 20 newest active notifications per entity.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct EntityNotificationQuery {
    /// Exact lifecycle states to include; an empty list matches nothing.
    pub states: Vec<NotificationState>,
    /// Event names to include; an empty list includes every event type.
    pub event_types: Vec<String>,
    /// Only notifications about channel messages outside a thread, including mentions
    /// but excluding reactions. Apply before limiting so replies cannot hide unread roots.
    pub top_level_messages_only: bool,
    /// Scope channel edges to their feed row, excluding notifications assigned to
    /// thread/mention stacks. Active seen reasons participate in scoping too;
    /// duplicate sends/replies represented by mentions stay in the feed. Other
    /// entity edges are unchanged. Applied before the per-entity limit.
    pub channel_feed_only: bool,
    /// Maximum records per entity, newest first.
    pub limit: u32,
}

impl Default for EntityNotificationQuery {
    fn default() -> Self {
        Self {
            states: NotificationState::ACTIVE.to_vec(),
            event_types: Vec::new(),
            top_level_messages_only: false,
            channel_feed_only: false,
            limit: 20,
        }
    }
}

impl EntityNotificationQuery {
    /// Validate bounded selections before accessing persistence.
    pub fn validate(&self) -> Result<(), rootcause::Report> {
        if !(1..=500).contains(&self.limit) {
            rootcause::bail!("notification edge limit must be between 1 and 500");
        }
        Ok(())
    }
}

#[cfg(test)]
mod test;
