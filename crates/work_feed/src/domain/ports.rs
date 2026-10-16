//! Capabilities the work feed needs from the domains that own its data.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use item_filters::ast::EntityFilterAst;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use rootcause::Report;
use uuid::Uuid;

use super::models::{
    FeedNotification, WorkFeedMode, WorkFeedPosition, WorkFeedTrigger, WorkFeedViewer,
};

/// Facts about a candidate's entity that scoping and state depend on.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EntityFacts {
    /// For a channel thread, the channel whose notifications it shares.
    pub thread_channel: Option<Uuid>,
    /// For an email thread, its mailbox state.
    pub mail: Option<MailFacts>,
}

/// An email thread's mailbox state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MailFacts {
    /// The thread is in the inbox (not archived).
    pub inbox_visible: bool,
    /// The thread has no unread mail.
    pub is_read: bool,
}

/// A request for one page of hydrated candidates.
#[derive(Debug, Clone)]
pub struct SourceRequest {
    /// Who the feed is for.
    pub viewer: WorkFeedViewer,
    /// Which reasons admit candidates.
    pub mode: WorkFeedMode,
    /// Candidate entity types to include.
    pub types: Vec<EntityType>,
    /// The membership policy filter.
    pub filter: EntityFilterAst,
    /// Maximum candidates to return.
    pub limit: u16,
    /// Resume after this position; `None` for the first page.
    pub after: Option<WorkFeedPosition>,
    /// Restrict to these candidate keys, for recomputing known items.
    pub only: Option<Vec<Entity<'static>>>,
}

/// One hydrated, authorized candidate.
#[derive(Debug, Clone)]
pub struct SourceItem<E> {
    /// The candidate key.
    pub key: Entity<'static>,
    /// The hydrated entity.
    pub entity: E,
    /// Facts used for scoping and state.
    pub facts: EntityFacts,
    /// The candidate's live attention time, when it has any.
    pub attention_at: Option<DateTime<Utc>>,
    /// The viewer's own-work time, when it has any.
    pub touched_at: Option<DateTime<Utc>>,
    /// Where the candidate sits in the feed.
    pub sort_at: DateTime<Utc>,
}

/// One page of hydrated candidates.
#[derive(Debug)]
pub struct SourcePage<E> {
    /// The page's candidates, newest first.
    pub items: Vec<SourceItem<E>>,
    /// Where the next page starts; `None` once the feed is exhausted.
    pub next: Option<WorkFeedPosition>,
}

/// Lists hydrated, authorized feed candidates in feed order.
pub trait WorkFeedSource: Send + Sync + 'static {
    /// The hydrated entity carried by each candidate.
    type Entity: Send + Sync + 'static;

    /// Fetch one page of candidates.
    fn page(
        &self,
        request: SourceRequest,
    ) -> impl Future<Output = Result<SourcePage<Self::Entity>, Report>> + Send;
}

/// Reads and acknowledges the viewer's notifications.
pub trait WorkFeedNotifications: Send + Sync + 'static {
    /// The viewer's active (unseen or seen) notifications about each entity.
    fn active(
        &self,
        user: MacroUserIdStr<'static>,
        entities: Vec<Entity<'static>>,
    ) -> impl Future<Output = Result<HashMap<Entity<'static>, Vec<FeedNotification>>, Report>> + Send;

    /// Move the viewer's notifications to done, or back from done to seen.
    /// Returns the ids whose state changed.
    fn set_done(
        &self,
        user: MacroUserIdStr<'static>,
        notification_ids: Vec<Uuid>,
        done: bool,
    ) -> impl Future<Output = Result<Vec<Uuid>, Report>> + Send;
}

/// Archives email threads; mail's notion of done.
pub trait WorkFeedMail: Send + Sync + 'static {
    /// Archive or unarchive one of the viewer's threads.
    fn set_archived(
        &self,
        user: MacroUserIdStr<'static>,
        thread_id: Uuid,
        archived: bool,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Tells the viewer's other sessions that items changed in ways their
/// realtime streams do not report, such as notifications completed here.
pub trait WorkFeedSignals: Send + Sync + 'static {
    /// Best effort: failures are logged, never returned.
    fn items_changed(
        &self,
        user: MacroUserIdStr<'static>,
        entities: Vec<Entity<'static>>,
    ) -> impl Future<Output = ()> + Send;
}

/// Realtime changes that may affect a viewer's items.
pub trait WorkFeedTriggers: Send + Sync + 'static {
    /// Subscribe to triggers for `user`. The receiver closes when the
    /// underlying streams end; a subscriber that falls behind receives
    /// [`WorkFeedTrigger::Invalidated`] first.
    fn subscribe(
        &self,
        user: MacroUserIdStr<'static>,
    ) -> tokio::sync::mpsc::Receiver<WorkFeedTrigger>;
}
