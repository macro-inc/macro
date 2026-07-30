//! Ports used by realtime Soup services.

use std::future::Future;

use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use rootcause::Report;

use super::models::{Patch, SoupRealtimeMessage, SoupRealtimePatch};

/// Inbound use-case port driven by entity update transports.
pub trait SoupRealtimeService: Send + Sync + 'static {
    /// Publishes one entity patch to every current accessor of its access source.
    fn notify_users(&self, patch: SoupRealtimePatch) -> Result<(), Report>;
}

/// Receives recipient-targeted Soup patches.
pub trait SoupRealtimeConsumer: Send + Sync + 'static {
    /// Waits for and returns the next realtime Soup patch.
    fn recv(&self) -> impl Future<Output = Result<SoupRealtimeMessage, Report>> + Send;
}

/// Provides user-scoped subscriptions to received realtime Soup patches.
pub trait SoupRealtimeSubscriptionService: Send + Sync + 'static {
    /// Subscribes to entity patches addressed to `user_id`.
    fn subscribe(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> tokio::sync::mpsc::Receiver<Patch<Entity<'static>>>;
}

impl<S> SoupRealtimeSubscriptionService for std::sync::Arc<S>
where
    S: SoupRealtimeSubscriptionService,
{
    fn subscribe(
        &self,
        user_id: MacroUserIdStr<'static>,
    ) -> tokio::sync::mpsc::Receiver<Patch<Entity<'static>>> {
        self.as_ref().subscribe(user_id)
    }
}

/// No-op subscription service used when only the GraphQL schema shape is needed.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoOpSoupRealtimeSubscriptionService;

impl SoupRealtimeSubscriptionService for NoOpSoupRealtimeSubscriptionService {
    fn subscribe(
        &self,
        _user_id: MacroUserIdStr<'static>,
    ) -> tokio::sync::mpsc::Receiver<Patch<Entity<'static>>> {
        let (_sender, receiver) = tokio::sync::mpsc::channel(1);
        receiver
    }
}

/// Resolves the users who currently have access to an entity.
pub trait UserAccessExpander: Send + Sync + 'static {
    /// Returns all current user accessors for `entity`.
    ///
    /// Implementations may return duplicates; the domain service deduplicates
    /// recipients before publication.
    fn expand_user_access(
        &self,
        entity: &Entity<'static>,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, Report>> + Send;
}

/// Publishes recipient-targeted Soup patches.
pub trait SoupRealtimePublisher: Send + Sync + 'static {
    /// Publishes one realtime Soup patch and awaits delivery.
    fn publish(
        &self,
        message: SoupRealtimeMessage,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}
