//! Ports used by realtime Soup fan-out.

use std::future::Future;

use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use models_soup::item::SoupItem;
use rootcause::Report;

use super::models::SoupRealtimeMessage;

/// Inbound use-case port driven by entity update transports.
pub trait SoupRealtimeService: Send + Sync + 'static {
    /// Hydrates one normalized Soup item and publishes it to every current accessor.
    fn notify_users(
        &self,
        entity: Entity<'static>,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Resolves the users who currently have access to an entity.
pub trait UserAccessExpander: Send + Sync + 'static {
    /// Returns all current user accessors for `entity`.
    ///
    /// Implementations may return duplicates; the domain service deduplicates
    /// recipients before hydration.
    fn expand_user_access(
        &self,
        entity: &Entity<'static>,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, Report>> + Send;
}

/// Reads a complete Soup item under an individual user's visibility scope.
pub trait SoupItemReader: Send + Sync + 'static {
    /// Reads `entity` through the visibility scope of `user_id`.
    fn read_for_user(
        &self,
        user_id: MacroUserIdStr<'static>,
        entity: &Entity<'static>,
    ) -> impl Future<Output = Result<Option<SoupItem<()>>, Report>> + Send;
}

/// Publishes complete recipient-targeted Soup messages.
pub trait SoupRealtimePublisher: Send + Sync + 'static {
    /// Publishes one realtime Soup message and awaits delivery.
    fn publish(
        &self,
        message: SoupRealtimeMessage,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}
