//! An account registering an agent session as its work, so viewers of that account see it.
//!
//! Any account may register a session it can edit. Registering shares nothing: a viewer sees a
//! registration only while the viewer can view its session, and registrations of archived
//! sessions are never read. Registrations end on their own (see [`WorkEndReason`]); ending keeps
//! the row, and a later turn does not bring it back.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt};
use futures::{StreamExt as _, stream};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use rootcause::Report;
use tokio_util::task::TaskTracker;
use tracing::Instrument as _;

use super::auto_archive::session_id;
use super::error::Result;
use super::model::{AgentSessionId, AgentSessionRenamed, LogAppended};
use super::ports::{AgentSessionQueueChanged, AgentSessionRealtime, SessionViewAccess};

#[cfg(test)]
mod test;

/// How long a session sits without work, on a turn that is not blocked, before its registrations
/// end. A failed turn counts: nothing more will happen until someone acts.
const IDLE_AFTER: Duration = Duration::from_secs(24 * 60 * 60);

/// How long a session waits on a blocked turn before its registrations end.
const BLOCKED_AFTER: Duration = Duration::from_secs(7 * 24 * 60 * 60);

/// Registrations one sweep ends. A full batch sweeps again right away.
pub const SWEEP_BATCH: u32 = 500;

/// Most registrations one read returns, newest first.
const MAX_REGISTRATIONS_READ: u32 = 200;

/// Access checks one read runs at a time.
const ACCESS_CHECK_CONCURRENCY: usize = 16;

/// How long after a registration ends a change to its session still reports it. Covers a change
/// signal travelling behind the write that ended the registration.
pub const ENDED_REPORT_WINDOW: chrono::Duration = chrono::Duration::minutes(5);

/// Identifies one registration, active or ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct WorkRegistrationId(Uuid);

impl WorkRegistrationId {
    /// A new id, sorting by creation time.
    #[must_use]
    pub fn generate() -> Self {
        Self(macro_uuid::generate_uuid_v7())
    }

    /// The id of a stored registration.
    #[must_use]
    pub fn new_from_uuid(id: Uuid) -> Self {
        Self(id)
    }

    /// The id's uuid.
    #[must_use]
    pub fn as_uuid(&self) -> Uuid {
        self.0
    }
}

impl std::fmt::Display for WorkRegistrationId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
    }
}

/// Why a registration ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr, strum::EnumString)]
#[strum(serialize_all = "snake_case")]
pub enum WorkEndReason {
    /// The account unregistered it.
    Unregistered,
    /// Every pull request linked to the session is merged or closed, and at least one exists.
    PullRequestFinished,
    /// The session was archived, whatever archived it.
    SessionArchived,
    /// The session has not worked for [`IDLE_AFTER`] and its turn is not blocked.
    Idle,
    /// The session's turn has been blocked for [`BLOCKED_AFTER`].
    BlockedTimeout,
}

/// One account's registration of one session as its work.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkRegistration {
    /// The registration.
    pub id: WorkRegistrationId,
    /// The account whose work this is.
    pub account_id: MacroUserIdStr<'static>,
    /// The session registered.
    pub session: AgentSessionId,
    /// When the account registered it.
    pub registered_at: DateTime<Utc>,
}

/// The outcome of asking to register a session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Registered {
    /// The account's active registration of the session.
    pub registration: WorkRegistration,
    /// Whether this call created it, rather than finding it active.
    pub created: bool,
}

/// What a registration's row says about it, for reporting a change to its session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WorkRegistrationState {
    /// The registration.
    pub registration: WorkRegistration,
    /// Whether it has ended.
    pub ended: bool,
    /// Whether its session is archived.
    pub session_archived: bool,
}

/// A registration ended by a sweep.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EndedRegistration {
    /// The session it registered.
    pub session: AgentSessionId,
    /// Why it ended.
    pub reason: WorkEndReason,
}

/// What a sweep did, by reason.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct WorkRegistrationSweepReport {
    /// Ended because the session's pull requests finished.
    pub pull_request_finished: u32,
    /// Ended because the session was archived.
    pub session_archived: u32,
    /// Ended because the session went idle.
    pub idle: u32,
    /// Ended because the session stayed blocked.
    pub blocked_timeout: u32,
}

impl WorkRegistrationSweepReport {
    /// How many registrations the sweep ended.
    #[must_use]
    pub fn total(&self) -> u32 {
        self.pull_request_finished + self.session_archived + self.idle + self.blocked_timeout
    }
}

/// What changed for a viewer watching some accounts, after some sessions changed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WorkRegistrationChanges {
    /// Registrations the viewer sees, with their sessions possibly changed.
    pub active: Vec<WorkRegistration>,
    /// Registrations the viewer saw that ended or whose session was archived.
    pub removed: Vec<WorkRegistrationId>,
    /// The viewer cannot view a session with registrations: it may hold entries it should not
    /// see any more, and nothing about them may be named to it. It must refetch.
    pub refetch: bool,
}

/// Storage for registrations. Every write is safe to repeat and across replicas.
pub trait WorkRegistrationRepo: Clone + Send + Sync + 'static {
    /// Register `session` for `account`, or find its active registration. Refuses a session that
    /// is missing or archived, atomically with an archive ending the session's registrations.
    fn register(
        &self,
        account: &MacroUserIdStr<'static>,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<Registered>> + Send;

    /// End `account`'s active registration of `session`. Whether there was one.
    fn unregister(
        &self,
        account: &MacroUserIdStr<'static>,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<bool>> + Send;

    /// Active registrations of `accounts` on unarchived sessions, newest first, at most `limit`.
    fn active_registrations(
        &self,
        accounts: &[MacroUserIdStr<'static>],
        limit: u32,
    ) -> impl Future<Output = Result<Vec<WorkRegistration>>> + Send;

    /// Registrations of `accounts` on `sessions` that are active or ended after `ended_after`.
    fn registration_states(
        &self,
        accounts: &[MacroUserIdStr<'static>],
        sessions: &[AgentSessionId],
        ended_after: DateTime<Utc>,
    ) -> impl Future<Output = Result<Vec<WorkRegistrationState>>> + Send;

    /// Whether `session` has a registration that is active or ended after `ended_after`.
    fn has_current_registrations(
        &self,
        session: AgentSessionId,
        ended_after: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool>> + Send;

    /// End active registrations of the sessions linked to `github_key` whose linked pull requests
    /// are now all merged or closed. The sessions whose registrations ended.
    fn end_for_finished_pull_requests(
        &self,
        github_key: &str,
    ) -> impl Future<Output = Result<Vec<AgentSessionId>>> + Send;

    /// End up to `limit` active registrations that are due, each for the first reason that
    /// applies: finished pull requests, an archived session, then a blocked turn not worked on
    /// since `blocked_before` or any other turn not worked on since `idle_before`.
    fn end_due_registrations(
        &self,
        idle_before: DateTime<Utc>,
        blocked_before: DateTime<Utc>,
        limit: u32,
    ) -> impl Future<Output = Result<Vec<EndedRegistration>>> + Send;
}

/// Tells viewers of a session that its registrations or its list fields changed.
pub trait WorkRegistrationSignal: Clone + Send + Sync + 'static {
    /// Best effort: a viewer that misses a signal catches up when it next refetches.
    fn session_changed(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = std::result::Result<(), Report>> + Send;
}

/// For a process that only reads registrations and so changes nothing to tell viewers about.
#[derive(Debug, Clone, Copy, Default)]
pub struct NoWorkRegistrationSignal;

impl WorkRegistrationSignal for NoWorkRegistrationSignal {
    async fn session_changed(&self, _session: AgentSessionId) -> std::result::Result<(), Report> {
        Ok(())
    }
}

/// Registering work, reading it, and ending it.
pub trait WorkRegistrations: Send + Sync + 'static {
    /// Register the session `access` covers as `account`'s work. Repeating returns the active
    /// registration.
    fn register(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
        account: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<WorkRegistration>> + Send;

    /// End `account`'s own registration of `session`. Repeating does nothing.
    fn unregister(
        &self,
        account: &MacroUserIdStr<'static>,
        session: AgentSessionId,
    ) -> impl Future<Output = Result<()>> + Send;

    /// Active registrations of `accounts` that `viewer` can see, newest first.
    fn visible_registrations(
        &self,
        viewer: &MacroUserIdStr<'static>,
        accounts: &[MacroUserIdStr<'static>],
    ) -> impl Future<Output = Result<Vec<WorkRegistration>>> + Send;

    /// What `sessions` changing means for `viewer` watching `accounts`, reporting registrations
    /// that ended after `ended_after`.
    fn changes(
        &self,
        viewer: &MacroUserIdStr<'static>,
        accounts: &[MacroUserIdStr<'static>],
        sessions: &[AgentSessionId],
        ended_after: DateTime<Utc>,
    ) -> impl Future<Output = Result<WorkRegistrationChanges>> + Send;

    /// The pull request `github_key` changed: end registrations of sessions whose pull requests
    /// are now all finished. Safe to repeat.
    fn pull_request_changed(&self, github_key: &str) -> impl Future<Output = Result<()>> + Send;

    /// End one batch of registrations that are due. Safe to repeat and across replicas.
    fn sweep(&self) -> impl Future<Output = Result<WorkRegistrationSweepReport>> + Send;
}

/// Work registrations over the session store.
#[derive(Clone)]
pub struct WorkRegistrationService<R, S> {
    repo: R,
    view_access: Arc<dyn SessionViewAccess>,
    signal: S,
}

impl<R, S> WorkRegistrationService<R, S> {
    /// Build the service over the store, current view access, and the viewer signal.
    pub fn new(repo: R, view_access: Arc<dyn SessionViewAccess>, signal: S) -> Self {
        Self {
            repo,
            view_access,
            signal,
        }
    }
}

impl<R, S> WorkRegistrationService<R, S>
where
    R: WorkRegistrationRepo,
    S: WorkRegistrationSignal,
{
    async fn tell_viewers(&self, session: AgentSessionId) {
        self.signal
            .session_changed(session)
            .await
            .inspect_err(|error| {
                tracing::warn!(error = ?error, %session, "failed to signal a work registration change");
            })
            .ok();
    }

    /// The sessions among `sessions` that `viewer` can view. A failed check hides the session:
    /// one bad lookup must not fail the read or show what may not be visible.
    async fn viewable_sessions(
        &self,
        viewer: &MacroUserIdStr<'static>,
        sessions: HashSet<AgentSessionId>,
    ) -> HashSet<AgentSessionId> {
        stream::iter(sessions)
            .map(|session| async move {
                let viewable = self
                    .view_access
                    .can_view(viewer, session)
                    .await
                    .inspect_err(|error| {
                        tracing::warn!(error = ?error, %session, "failed to check session view access");
                    })
                    .unwrap_or(false);
                viewable.then_some(session)
            })
            .buffer_unordered(ACCESS_CHECK_CONCURRENCY)
            .filter_map(std::future::ready)
            .collect()
            .await
    }
}

impl<R, S> WorkRegistrations for WorkRegistrationService<R, S>
where
    R: WorkRegistrationRepo,
    S: WorkRegistrationSignal,
{
    #[tracing::instrument(
        name = "agent_session.work_registration.register",
        err,
        skip_all,
        fields(agent.session.id, created)
    )]
    async fn register(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
        account: &MacroUserIdStr<'static>,
    ) -> Result<WorkRegistration> {
        let session = session_id(access)?;
        tracing::Span::current().record("agent.session.id", tracing::field::display(session));
        let registered = self.repo.register(account, session).await?;
        tracing::Span::current().record("created", registered.created);
        if registered.created {
            self.tell_viewers(session).await;
        }
        Ok(registered.registration)
    }

    #[tracing::instrument(
        name = "agent_session.work_registration.unregister",
        err,
        skip(self, account),
        fields(ended)
    )]
    async fn unregister(
        &self,
        account: &MacroUserIdStr<'static>,
        session: AgentSessionId,
    ) -> Result<()> {
        let ended = self.repo.unregister(account, session).await?;
        tracing::Span::current().record("ended", ended);
        if ended {
            self.tell_viewers(session).await;
        }
        Ok(())
    }

    async fn visible_registrations(
        &self,
        viewer: &MacroUserIdStr<'static>,
        accounts: &[MacroUserIdStr<'static>],
    ) -> Result<Vec<WorkRegistration>> {
        let mut registrations = self
            .repo
            .active_registrations(accounts, MAX_REGISTRATIONS_READ)
            .await?;
        let sessions = registrations.iter().map(|row| row.session).collect();
        let viewable = self.viewable_sessions(viewer, sessions).await;
        registrations.retain(|registration| viewable.contains(&registration.session));
        Ok(registrations)
    }

    async fn changes(
        &self,
        viewer: &MacroUserIdStr<'static>,
        accounts: &[MacroUserIdStr<'static>],
        sessions: &[AgentSessionId],
        ended_after: DateTime<Utc>,
    ) -> Result<WorkRegistrationChanges> {
        let states = self
            .repo
            .registration_states(accounts, sessions, ended_after)
            .await?;
        let touched = states.iter().map(|state| state.registration.session);
        let viewable = self.viewable_sessions(viewer, touched.collect()).await;

        let mut changes = WorkRegistrationChanges::default();
        for state in states {
            if !viewable.contains(&state.registration.session) {
                changes.refetch = true;
            } else if state.ended || state.session_archived {
                changes.removed.push(state.registration.id);
            } else {
                changes.active.push(state.registration);
            }
        }
        Ok(changes)
    }

    #[tracing::instrument(
        name = "agent_session.work_registration.pull_request",
        err,
        skip_all,
        fields(ended)
    )]
    async fn pull_request_changed(&self, github_key: &str) -> Result<()> {
        let sessions = self.repo.end_for_finished_pull_requests(github_key).await?;
        tracing::Span::current().record("ended", sessions.len());
        let distinct: HashSet<_> = sessions.into_iter().collect();
        for session in distinct {
            self.tell_viewers(session).await;
        }
        Ok(())
    }

    #[tracing::instrument(
        name = "agent_session.work_registration.sweep",
        err,
        skip_all,
        fields(ended, pull_request_finished, session_archived, idle, blocked_timeout)
    )]
    async fn sweep(&self) -> Result<WorkRegistrationSweepReport> {
        let now = Utc::now();
        let idle_before = before(now, IDLE_AFTER)?;
        let blocked_before = before(now, BLOCKED_AFTER)?;
        let ended = self
            .repo
            .end_due_registrations(idle_before, blocked_before, SWEEP_BATCH)
            .await?;

        let report = report_of(&ended);
        let span = tracing::Span::current();
        span.record("ended", report.total());
        span.record("pull_request_finished", report.pull_request_finished);
        span.record("session_archived", report.session_archived);
        span.record("idle", report.idle);
        span.record("blocked_timeout", report.blocked_timeout);

        let distinct: HashSet<_> = ended.iter().map(|row| row.session).collect();
        for session in distinct {
            self.tell_viewers(session).await;
        }
        Ok(report)
    }
}

fn before(now: DateTime<Utc>, age: Duration) -> Result<DateTime<Utc>> {
    let age = chrono::Duration::from_std(age)
        .map_err(|error| anyhow::anyhow!("work registration age out of range: {error}"))?;
    Ok(now - age)
}

fn report_of(ended: &[EndedRegistration]) -> WorkRegistrationSweepReport {
    let mut report = WorkRegistrationSweepReport::default();
    for row in ended {
        match row.reason {
            WorkEndReason::PullRequestFinished => report.pull_request_finished += 1,
            WorkEndReason::SessionArchived => report.session_archived += 1,
            WorkEndReason::Idle => report.idle += 1,
            WorkEndReason::BlockedTimeout => report.blocked_timeout += 1,
            // Only an account unregistering ends a registration for this reason; a sweep never does.
            WorkEndReason::Unregistered => {}
        }
    }
    report
}

/// [`AgentSessionRealtime`] that also tells viewers of registered work when a session's list
/// fields change. Log frames change no list field and only pass through.
///
/// The signal runs off the caller's task on tasks tracked by `tasks`: session log writes publish
/// through here, and a session with no registrations must cost them nothing.
#[derive(Clone)]
pub struct WorkRegistrationRealtime<Inner, R, S> {
    inner: Inner,
    repo: R,
    signal: S,
    tasks: TaskTracker,
}

impl<Inner, R, S> WorkRegistrationRealtime<Inner, R, S> {
    /// Publish through `inner`, then signal through `signal` for sessions `repo` has
    /// registrations of.
    pub fn new(inner: Inner, repo: R, signal: S, tasks: TaskTracker) -> Self {
        Self {
            inner,
            repo,
            signal,
            tasks,
        }
    }
}

impl<Inner, R, S> WorkRegistrationRealtime<Inner, R, S>
where
    R: WorkRegistrationRepo,
    S: WorkRegistrationSignal,
{
    fn signal_registered(&self, session: AgentSessionId) {
        let repo = self.repo.clone();
        let signal = self.signal.clone();
        self.tasks.spawn(
            async move {
                let ended_after = Utc::now() - ENDED_REPORT_WINDOW;
                let registered = repo
                    .has_current_registrations(session, ended_after)
                    .await
                    .inspect_err(|error| {
                        tracing::warn!(error = ?error, %session, "failed to look up work registrations");
                    })
                    .unwrap_or(false);
                if !registered {
                    return;
                }
                signal
                    .session_changed(session)
                    .await
                    .inspect_err(|error| {
                        tracing::warn!(error = ?error, %session, "failed to signal a work registration change");
                    })
                    .ok();
            }
            .in_current_span(),
        );
    }
}

impl<Inner, R, S> AgentSessionRealtime for WorkRegistrationRealtime<Inner, R, S>
where
    Inner: AgentSessionRealtime + Sync,
    R: WorkRegistrationRepo,
    S: WorkRegistrationSignal,
{
    fn publish(
        &self,
        event: LogAppended,
    ) -> impl Future<Output = std::result::Result<(), Report>> + Send {
        self.inner.publish(event)
    }

    async fn publish_updated(&self, session: AgentSessionId) -> std::result::Result<(), Report> {
        let published = self.inner.publish_updated(session).await;
        self.signal_registered(session);
        published
    }

    async fn publish_renamed(&self, event: AgentSessionRenamed) -> std::result::Result<(), Report> {
        let session = event.agent_session_id;
        let published = self.inner.publish_renamed(event).await;
        self.signal_registered(session);
        published
    }

    fn publish_queue_changed(
        &self,
        event: AgentSessionQueueChanged,
    ) -> impl Future<Output = std::result::Result<(), Report>> + Send {
        self.inner.publish_queue_changed(event)
    }

    fn publish_changes_updated(
        &self,
        session: AgentSessionId,
    ) -> impl Future<Output = std::result::Result<(), Report>> + Send {
        self.inner.publish_changes_updated(session)
    }
}
