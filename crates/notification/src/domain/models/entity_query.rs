//! Filters for an entity's notification edge.

use super::NotificationState;

/// Selection applied independently to each entity before limiting its results.
/// Defaults preserve the historical active-notification edge.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct EntityNotificationQuery {
    /// Exact lifecycle states to include; an empty list matches nothing.
    pub states: Vec<NotificationState>,
    /// Event names to include; an empty list includes every event type.
    pub event_types: Vec<String>,
    /// Maximum records per entity, newest first. None preserves the full edge.
    pub limit: Option<u32>,
}

impl Default for EntityNotificationQuery {
    fn default() -> Self {
        Self {
            states: NotificationState::ACTIVE.to_vec(),
            event_types: Vec::new(),
            limit: None,
        }
    }
}

impl EntityNotificationQuery {
    /// Validate bounded selections before accessing persistence.
    pub fn validate(&self) -> Result<(), rootcause::Report> {
        if self.limit.is_some_and(|limit| !(1..=500).contains(&limit)) {
            rootcause::bail!("notification edge limit must be between 1 and 500");
        }
        Ok(())
    }
}

#[cfg(test)]
mod test;
