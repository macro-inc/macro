//! Capabilities feeds need from the domains that own their data.

use std::collections::HashMap;

use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use rootcause::Report;
use uuid::Uuid;

use super::models::{
    CandidateKeying, CandidatePage, CandidateRequest, FeedNotification, FeedTrigger,
};

/// Lists hydrated, authorized candidates in feed order. A candidate the
/// viewer cannot open, or that the request's filter rejects, is never
/// returned.
pub trait CandidateSource: Send + Sync + 'static {
    /// The hydrated entity carried by each candidate.
    type Entity: Send + Sync + 'static;

    /// Fetch one page of candidates.
    fn page(
        &self,
        request: CandidateRequest,
    ) -> impl Future<Output = Result<CandidatePage<Self::Entity>, Report>> + Send;
}

/// The state a viewer's notifications move to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NotificationTransition {
    /// Read; never reopens a done notification.
    Seen,
    /// Completed.
    Done,
    /// Back from done to seen.
    Undone,
}

/// Reads and transitions the viewer's notifications.
pub trait FeedNotifications: Send + Sync + 'static {
    /// The viewer's active (unseen or seen) notifications about each entity.
    fn active(
        &self,
        user: MacroUserIdStr<'static>,
        entities: Vec<Entity<'static>>,
    ) -> impl Future<Output = Result<HashMap<Entity<'static>, Vec<FeedNotification>>, Report>> + Send;

    /// Move the viewer's notifications through `transition`. Returns the
    /// ids whose state changed.
    fn transition(
        &self,
        user: MacroUserIdStr<'static>,
        notification_ids: Vec<Uuid>,
        transition: NotificationTransition,
    ) -> impl Future<Output = Result<Vec<Uuid>, Report>> + Send;
}

/// Archives email threads; mail's notion of done.
pub trait FeedMail: Send + Sync + 'static {
    /// Archive or unarchive one of the viewer's threads.
    fn set_archived(
        &self,
        user: MacroUserIdStr<'static>,
        thread_id: Uuid,
        archived: bool,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Tells the viewer's other sessions that entries changed in ways their
/// realtime streams do not report, such as notifications completed here.
pub trait FeedSignals: Send + Sync + 'static {
    /// Best effort: failures are logged, never returned.
    fn changed(
        &self,
        user: MacroUserIdStr<'static>,
        entities: Vec<Entity<'static>>,
    ) -> impl Future<Output = ()> + Send;
}

/// Realtime changes that may affect a viewer's entries.
pub trait FeedTriggers: Send + Sync + 'static {
    /// Subscribe to triggers for `user`, keyed the way `keying` keys
    /// candidates. With `own_work`, the viewer's own actions trigger too.
    /// The receiver closes when the underlying streams end; a subscriber that
    /// falls behind receives [`FeedTrigger::Invalidated`] first.
    fn subscribe(
        &self,
        user: MacroUserIdStr<'static>,
        keying: CandidateKeying,
        own_work: bool,
    ) -> tokio::sync::mpsc::Receiver<FeedTrigger>;
}
