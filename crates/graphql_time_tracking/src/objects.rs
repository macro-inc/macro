//! GraphQL objects for time entries, the viewer's timer and mutation replies.

use std::marker::PhantomData;

use async_graphql::{Context, Enum, ID, Object, SimpleObject};
use graphql_common::require_authenticated_user;
use graphql_soup::{GraphqlSoupDocument, GraphqlSoupEntity, SoupEntityEdges, resolve_soup_entity};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::EntityType;
use time_tracking::domain::models::{
    RunningTimer, TimeEntry, TimeEntrySource, TimerState, may_change_entry,
};

/// How a time entry was made.
#[derive(Enum, Copy, Clone, Debug, PartialEq, Eq)]
pub enum GraphqlTimeEntrySource {
    /// Typed by a person.
    Manual,
    /// Saved when a timer stopped.
    Timer,
}

impl From<TimeEntrySource> for GraphqlTimeEntrySource {
    fn from(source: TimeEntrySource) -> Self {
        match source {
            TimeEntrySource::Manual => Self::Manual,
            TimeEntrySource::Timer => Self::Timer,
        }
    }
}

/// Time a person logged on a task.
pub struct GraphqlTimeEntry {
    entry: TimeEntry,
    can_edit: bool,
}

impl GraphqlTimeEntry {
    /// The entry as `viewer` sees it.
    pub(crate) fn new(entry: TimeEntry, viewer: &MacroUserIdStr<'_>) -> Self {
        Self {
            can_edit: may_change_entry(&entry, viewer),
            entry,
        }
    }
}

/// Time a person logged on a task.
#[Object(name = "GraphqlTimeEntry")]
impl GraphqlTimeEntry {
    /// The entry's id; a timer's entry keeps the timer's id.
    async fn id(&self) -> ID {
        ID(self.entry.id.to_string())
    }

    /// The task document the time was spent on.
    async fn task_id(&self) -> ID {
        ID(self.entry.task_id.clone())
    }

    /// The person who logged it.
    async fn user_id(&self) -> &str {
        self.entry.user_id.as_ref()
    }

    /// The logger's own calendar day for the work, `YYYY-MM-DD`.
    async fn date(&self) -> String {
        self.entry.date.to_string()
    }

    /// Length in whole minutes; the truth even when a start and end are given.
    async fn minutes(&self) -> u16 {
        self.entry.minutes
    }

    /// What the time was spent on.
    async fn note(&self) -> Option<&str> {
        self.entry.note.as_deref()
    }

    /// When the work started, RFC 3339, if known.
    async fn started_at(&self) -> Option<String> {
        self.entry.started_at.map(|instant| instant.to_rfc3339())
    }

    /// When the work ended, RFC 3339, given exactly when `startedAt` is.
    async fn ended_at(&self) -> Option<String> {
        self.entry.ended_at.map(|instant| instant.to_rfc3339())
    }

    /// How the entry was made.
    async fn source(&self) -> GraphqlTimeEntrySource {
        self.entry.source.into()
    }

    /// When it was logged, RFC 3339.
    async fn created_at(&self) -> String {
        self.entry.created_at.to_rfc3339()
    }

    /// When it last changed, RFC 3339.
    async fn updated_at(&self) -> String {
        self.entry.updated_at.to_rfc3339()
    }

    /// Whether the authenticated viewer may change or delete it: only its author may.
    async fn can_edit(&self) -> bool {
        self.can_edit
    }
}

/// A page of a task's time entries, newest day first.
#[derive(Default, SimpleObject)]
pub struct GraphqlTimeEntryPage {
    /// Entries of this page.
    pub entries: Vec<GraphqlTimeEntry>,
    /// Pass as `after` for the next page; null on the last page.
    pub next_cursor: Option<String>,
}

/// Load a task through the viewer's Soup access, from the primary, so a reply
/// shows the Time logged its write just stored; null when it is hidden or gone.
pub(crate) async fn load_task<E: SoupEntityEdges>(
    ctx: &Context<'_>,
    task_id: &str,
) -> async_graphql::Result<Option<GraphqlSoupDocument<E>>> {
    let user = require_authenticated_user(ctx)?;
    let entity = EntityType::Document.with_entity_string(task_id.to_string());
    match resolve_soup_entity::<E>(ctx, user, entity).await? {
        Some(GraphqlSoupEntity::Document(document)) => Ok(Some(document)),
        Some(_) => Err(async_graphql::Error::new(
            "Soup returned a non-document entity for a task request",
        )),
        None => Ok(None),
    }
}

/// The viewer's running timer.
pub struct GraphqlRunningTimer<E> {
    timer: RunningTimer,
    _edges: PhantomData<fn() -> E>,
}

/// The viewer's running timer.
#[Object(name = "GraphqlRunningTimer")]
impl<E: SoupEntityEdges> GraphqlRunningTimer<E> {
    /// The timer's id, kept by the entry it becomes when it stops.
    async fn id(&self) -> ID {
        ID(self.timer.id.to_string())
    }

    /// The task being timed.
    async fn task_id(&self) -> ID {
        ID(self.timer.task_id.clone())
    }

    /// When it started, RFC 3339, by the server's clock.
    async fn started_at(&self) -> String {
        self.timer.started_at.to_rfc3339()
    }

    /// The task being timed; null when the viewer can no longer see it.
    async fn task(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<GraphqlSoupDocument<E>>> {
        load_task(ctx, &self.timer.task_id).await
    }
}

/// The authenticated viewer's time tracking: their running timer and the
/// server's clock. Its id is the viewer's id; only the viewer's own is served.
pub struct GraphqlTimeTracking<E> {
    user_id: MacroUserIdStr<'static>,
    state: TimerState,
    _edges: PhantomData<fn() -> E>,
}

impl<E> GraphqlTimeTracking<E> {
    pub(crate) fn new(user_id: MacroUserIdStr<'static>, state: TimerState) -> Self {
        Self {
            user_id,
            state,
            _edges: PhantomData,
        }
    }
}

/// The authenticated viewer's time tracking state.
#[Object(name = "GraphqlTimeTracking")]
impl<E: SoupEntityEdges> GraphqlTimeTracking<E> {
    /// The viewer's id: one record per person.
    async fn id(&self) -> ID {
        ID(self.user_id.to_string())
    }

    /// The viewer's running timer; nobody sees another person's.
    async fn running_timer(&self) -> Option<GraphqlRunningTimer<E>> {
        self.state.timer.clone().map(|timer| GraphqlRunningTimer {
            timer,
            _edges: PhantomData,
        })
    }

    /// The server's clock when this response was made, RFC 3339. Compare it
    /// with the device's clock when the response arrives, never from a cached
    /// copy, to count a timer by the server's clock.
    async fn server_now(&self) -> String {
        self.state.server_now.to_rfc3339()
    }
}

/// A logged entry and its task.
pub struct LogTimePayload<E> {
    pub(crate) entry: GraphqlTimeEntry,
    pub(crate) task_id: String,
    pub(crate) _edges: PhantomData<fn() -> E>,
}

/// The reply to `logTime`.
#[Object(name = "LogTimePayload")]
impl<E: SoupEntityEdges> LogTimePayload<E> {
    /// The entry as stored; a replay returns the entry the first request stored.
    async fn entry(&self) -> &GraphqlTimeEntry {
        &self.entry
    }

    /// The task with its new Time logged; null when the viewer can no longer see it.
    async fn task(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<GraphqlSoupDocument<E>>> {
        load_task(ctx, &self.task_id).await
    }
}

/// A changed entry and its task.
pub struct UpdateTimeEntryPayload<E> {
    pub(crate) entry: GraphqlTimeEntry,
    pub(crate) task_id: String,
    pub(crate) _edges: PhantomData<fn() -> E>,
}

/// The reply to `updateTimeEntry`.
#[Object(name = "UpdateTimeEntryPayload")]
impl<E: SoupEntityEdges> UpdateTimeEntryPayload<E> {
    /// The entry as stored.
    async fn entry(&self) -> &GraphqlTimeEntry {
        &self.entry
    }

    /// The task with its new Time logged; null when the viewer can no longer see it.
    async fn task(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<GraphqlSoupDocument<E>>> {
        load_task(ctx, &self.task_id).await
    }
}

/// A deleted entry and its task.
pub struct DeleteTimeEntryPayload<E> {
    pub(crate) deleted_entry_id: ID,
    pub(crate) task_id: String,
    pub(crate) _edges: PhantomData<fn() -> E>,
}

/// The reply to `deleteTimeEntry`.
#[Object(name = "DeleteTimeEntryPayload")]
impl<E: SoupEntityEdges> DeleteTimeEntryPayload<E> {
    /// The entry that no longer exists.
    async fn deleted_entry_id(&self) -> &ID {
        &self.deleted_entry_id
    }

    /// The task with its new Time logged; null when the viewer can no longer see it.
    async fn task(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<GraphqlSoupDocument<E>>> {
        load_task(ctx, &self.task_id).await
    }
}

/// A started timer, and the entry saved for the timer it replaced.
pub struct StartTimerPayload<E> {
    pub(crate) time_tracking: GraphqlTimeTracking<E>,
    pub(crate) stopped_entry: Option<GraphqlTimeEntry>,
    pub(crate) stopped_task_id: Option<String>,
}

/// The reply to `startTimer`.
#[Object(name = "StartTimerPayload")]
impl<E: SoupEntityEdges> StartTimerPayload<E> {
    /// The viewer's time tracking, with the new timer running.
    async fn time_tracking(&self) -> &GraphqlTimeTracking<E> {
        &self.time_tracking
    }

    /// The entry saved for the timer this start stopped; null when none ran
    /// or the start was a replay.
    async fn stopped_entry(&self) -> Option<&GraphqlTimeEntry> {
        self.stopped_entry.as_ref()
    }

    /// The stopped timer's task with its new Time logged.
    async fn stopped_task(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<GraphqlSoupDocument<E>>> {
        match &self.stopped_task_id {
            Some(task_id) => load_task(ctx, task_id).await,
            None => Ok(None),
        }
    }
}

/// A stopped timer's entry and its task.
pub struct StopTimerPayload<E> {
    pub(crate) time_tracking: GraphqlTimeTracking<E>,
    pub(crate) entry: Option<GraphqlTimeEntry>,
}

/// The reply to `stopTimer`.
#[Object(name = "StopTimerPayload")]
impl<E: SoupEntityEdges> StopTimerPayload<E> {
    /// The viewer's time tracking after the stop.
    async fn time_tracking(&self) -> &GraphqlTimeTracking<E> {
        &self.time_tracking
    }

    /// The saved entry; a timer stopped before returns the entry it saved,
    /// and a discarded one returns null.
    async fn entry(&self) -> Option<&GraphqlTimeEntry> {
        self.entry.as_ref()
    }

    /// The entry's task with its new Time logged; null without an entry or
    /// when the viewer can no longer see it.
    async fn task(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<Option<GraphqlSoupDocument<E>>> {
        match &self.entry {
            Some(entry) => load_task(ctx, &entry.entry.task_id).await,
            None => Ok(None),
        }
    }
}

/// The viewer's time tracking after a discard.
pub struct DiscardTimerPayload<E> {
    pub(crate) time_tracking: GraphqlTimeTracking<E>,
}

/// The reply to `discardTimer`.
#[Object(name = "DiscardTimerPayload")]
impl<E: SoupEntityEdges> DiscardTimerPayload<E> {
    /// The viewer's time tracking after the discard.
    async fn time_tracking(&self) -> &GraphqlTimeTracking<E> {
        &self.time_tracking
    }
}
