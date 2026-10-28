//! User-owned notification mute and snooze preferences.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use rootcause::Report;
use std::future::Future;

/// An item whose notifications are muted, indefinitely or until a deadline.
#[derive(Debug, Clone)]
pub struct ItemNotificationPreference {
    /// The notification's primary entity.
    pub entity: Entity<'static>,
    /// None denotes a permanent mute.
    pub snoozed_until: Option<DateTime<Utc>>,
}

/// Persistence of preferences scoped to their authenticated owner.
pub trait ItemNotificationPreferenceRepository: Send + Sync {
    /// Return only permanent mutes and unexpired snoozes.
    fn list(
        &self,
        user: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<ItemNotificationPreference>, Report>> + Send;
    /// Replace this user's preference for an item.
    fn set(
        &self,
        user: MacroUserIdStr<'_>,
        entity: Entity<'_>,
        until: Option<DateTime<Utc>>,
    ) -> impl Future<Output = Result<(), Report>> + Send;
    /// Resume notifications for this user's item.
    fn remove(
        &self,
        user: MacroUserIdStr<'_>,
        entity: Entity<'_>,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// A rejected preference change.
#[derive(Debug, thiserror::Error)]
pub enum ItemNotificationPreferenceError {
    /// Snoozes must end in the future.
    #[error("Choose a snooze time in the future")]
    InvalidDeadline,
    /// Persistence failed.
    #[error("Could not update notification preference: {0}")]
    Repository(Report),
}

/// Manages personal preferences; these never change another user's delivery or entity access.
#[derive(Clone)]
pub struct ItemNotificationPreferenceService<R> {
    repository: R,
}

impl<R: ItemNotificationPreferenceRepository> ItemNotificationPreferenceService<R> {
    /// Construct with the owning notification repository.
    pub fn new(repository: R) -> Self {
        Self { repository }
    }

    /// List the authenticated user's active preferences.
    pub async fn list(
        &self,
        user: MacroUserIdStr<'_>,
    ) -> Result<Vec<ItemNotificationPreference>, Report> {
        self.repository.list(user).await
    }

    /// Replace a mute or snooze. Only the authenticated user's preference can change.
    pub async fn set(
        &self,
        user: MacroUserIdStr<'_>,
        entity: Entity<'_>,
        until: Option<DateTime<Utc>>,
        now: DateTime<Utc>,
    ) -> Result<(), ItemNotificationPreferenceError> {
        if until.is_some_and(|deadline| deadline <= now) {
            return Err(ItemNotificationPreferenceError::InvalidDeadline);
        }
        self.repository
            .set(user, entity, until)
            .await
            .map_err(ItemNotificationPreferenceError::Repository)
    }

    /// Resume delivery without modifying existing notifications or read state.
    pub async fn remove(&self, user: MacroUserIdStr<'_>, entity: Entity<'_>) -> Result<(), Report> {
        self.repository.remove(user, entity).await
    }
}

#[cfg(test)]
mod test;
