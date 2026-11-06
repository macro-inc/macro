//! User-owned notification mute and snooze preferences.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use rootcause::Report;
use std::{collections::HashMap, future::Future};

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
    /// Atomically replace this user's preferences for all items.
    fn set_bulk(
        &self,
        user: MacroUserIdStr<'_>,
        entities: &[Entity<'_>],
        until: Option<DateTime<Utc>>,
    ) -> impl Future<Output = Result<(), Report>> + Send;
    /// Atomically resume notifications for all items belonging to this user.
    fn remove_bulk(
        &self,
        user: MacroUserIdStr<'_>,
        entities: &[Entity<'_>],
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
    /// Requests contain at most 500 items.
    #[error("Too many notification preference items (maximum 500)")]
    TooManyItems,
    /// An item ID cannot refer to different entity types in one request.
    #[error("Conflicting entity types for the same item ID")]
    ConflictingTypes,
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

    /// Atomically mute or snooze items for the authenticated user.
    #[tracing::instrument(skip_all, fields(item_count = entities.len()), err)]
    pub async fn set_bulk(
        &self,
        user: MacroUserIdStr<'_>,
        entities: Vec<Entity<'static>>,
        until: Option<DateTime<Utc>>,
        now: DateTime<Utc>,
    ) -> Result<(), ItemNotificationPreferenceError> {
        if until.is_some_and(|deadline| deadline <= now) {
            return Err(ItemNotificationPreferenceError::InvalidDeadline);
        }

        let entities = Self::validate_bulk(entities)?;

        self.repository
            .set_bulk(user, &entities, until)
            .await
            .map_err(ItemNotificationPreferenceError::Repository)
    }

    /// Atomically resume delivery for the authenticated user's items.
    #[tracing::instrument(skip_all, fields(item_count = entities.len()), err)]
    pub async fn remove_bulk(
        &self,
        user: MacroUserIdStr<'_>,
        entities: Vec<Entity<'static>>,
    ) -> Result<(), ItemNotificationPreferenceError> {
        let entities = Self::validate_bulk(entities)?;

        self.repository
            .remove_bulk(user, &entities)
            .await
            .map_err(ItemNotificationPreferenceError::Repository)
    }

    fn validate_bulk(
        entities: Vec<Entity<'static>>,
    ) -> Result<Vec<Entity<'static>>, ItemNotificationPreferenceError> {
        if entities.len() > 500 {
            return Err(ItemNotificationPreferenceError::TooManyItems);
        }

        let mut seen: HashMap<String, EntityType> = HashMap::new();
        let mut unique = Vec::with_capacity(entities.len());

        for entity in entities {
            match seen.get(entity.entity_id.as_ref()) {
                Some(entity_type) if *entity_type != entity.entity_type => {
                    return Err(ItemNotificationPreferenceError::ConflictingTypes);
                }
                Some(_) => continue,
                None => {
                    seen.insert(entity.entity_id.to_string(), entity.entity_type);
                    unique.push(entity);
                }
            }
        }

        Ok(unique)
    }

    /// Resume delivery without modifying existing notifications or read state.
    pub async fn remove(&self, user: MacroUserIdStr<'_>, entity: Entity<'_>) -> Result<(), Report> {
        self.repository.remove(user, entity).await
    }
}

#[cfg(test)]
mod test;
