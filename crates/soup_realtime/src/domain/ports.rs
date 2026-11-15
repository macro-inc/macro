//! Ports used by realtime Soup services.

use std::future::Future;

use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use rootcause::Report;

use super::models::{Delivery, Patch, SharedAccess, SoupRealtimeMessage, SoupRealtimePatch};

/// Inbound use-case port driven by entity update transports.
pub trait SoupRealtimeService: Send + Sync + 'static {
    /// Publishes each patch to every current accessor of its access source.
    ///
    /// Resolves the recipients of the whole batch in one access lookup, so callers
    /// bound the batch size. Patches are published in order: every recipient of a
    /// patch is sent it before the next patch is published. Waits for capacity and
    /// returns success only after all publications succeed. Failures may occur after
    /// partial delivery, so retries can produce duplicates.
    fn notify_users(
        &self,
        patches: Vec<SoupRealtimePatch>,
    ) -> impl Future<Output = Result<Delivery, Report>> + Send;
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

/// Resolves the users who currently have access to entities.
pub trait UserAccessExpander: Send + Sync + 'static {
    /// Returns the current user accessors of `entities`, grouping entities whose
    /// accessors are the same.
    ///
    /// Entities without accessors may be left out. Implementations may return
    /// duplicate users; the domain service deduplicates recipients before publication.
    fn expand_user_access(
        &self,
        entities: &[Entity<'static>],
    ) -> impl Future<Output = Result<Vec<SharedAccess>, Report>> + Send;
}

/// Publishes recipient-targeted Soup patches.
pub trait SoupRealtimePublisher: Send + Sync + 'static {
    /// Publishes one realtime Soup patch and awaits delivery.
    fn publish(
        &self,
        message: SoupRealtimeMessage,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Finds session entities whose displayed PR metadata depends on a pull request.
pub trait PullRequestSessions: Send + Sync + 'static {
    /// Return linked sessions; recipients must still be resolved using each session's access.
    fn linked_sessions(
        &self,
        github_key: &str,
    ) -> impl Future<Output = Result<Vec<Entity<'static>>, Report>> + Send;
}
