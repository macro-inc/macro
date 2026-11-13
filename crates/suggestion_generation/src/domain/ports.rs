//! What generations need from storage and the harness.

use std::future::Future;

use agent_session::domain::model::AgentSessionId;
use bot_id::BotId;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use suggestions::domain::model::{GenerationTrigger, SessionKind};

use super::generation::{GenerationEvent, OverviewFacts};
use super::model::{AdmissionFacts, AudienceMember, LostGeneration, NewGeneration, StaleSession};
use super::nightly::NightlyOutcome;
use super::session::{CleanupEvent, SessionEnding};

/// Generations, their sessions and who gets a nightly one, in storage.
/// Every status write is guarded by the states its event may leave
/// ([`GenerationEvent::sources`], [`CleanupEvent::sources`]): a write that
/// finds another state changes nothing and says so.
pub trait GenerationRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Whether one of the person's generations is running, and their latest
    /// one of `trigger`.
    fn admission(
        &self,
        user: &MacroUserIdStr<'_>,
        trigger: GenerationTrigger,
    ) -> impl Future<Output = Result<AdmissionFacts, Self::Err>> + Send;

    /// Store `generation` as running, unless one of the person's is running
    /// or one of its trigger started after `generation.after`; whether it
    /// was stored.
    fn insert(
        &self,
        generation: &NewGeneration,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// End running generation `generation` with `event` at `now`; whether
    /// it was running.
    fn end(
        &self,
        generation: Uuid,
        event: GenerationEvent,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Generation `generation` is alive at `now`; whether it is still
    /// running.
    fn beat(
        &self,
        generation: Uuid,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// End as interrupted, at `now`, at most `limit` running generations
    /// whose last heartbeat was before `before`; them.
    fn interrupt_lost(
        &self,
        before: DateTime<Utc>,
        now: DateTime<Utc>,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<LostGeneration>, Self::Err>> + Send;

    /// Let hidden session `session` of `generation`, run as `agent` for the
    /// person, call `kind`'s tools; a routines session suggests for
    /// `surfaces`.
    #[expect(clippy::too_many_arguments, reason = "one row, all of its columns")]
    fn open_session(
        &self,
        session: Uuid,
        generation: Uuid,
        user: &MacroUserIdStr<'_>,
        agent: BotId,
        kind: SessionKind,
        surfaces: &[String],
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Open session `session`'s turn ended so at `now`: it stops taking
    /// its tools and is being cleaned up ([`CleanupEvent::Ended`]); whether
    /// it was open.
    fn end_session(
        &self,
        session: Uuid,
        ending: SessionEnding,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Move ended session `session`'s cleanup by `event` at `now`: deleted,
    /// a failed delete, or given up; whether its state allowed it. A failed
    /// delete counts one more attempt ([`CleanupEvent::counts_attempt`]).
    fn advance_cleanup(
        &self,
        session: Uuid,
        event: CleanupEvent,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// End as interrupted, at `now`, at most `limit` open sessions whose
    /// generation no longer runs or that opened before `stale_before`; them.
    fn end_orphaned_sessions(
        &self,
        stale_before: DateTime<Utc>,
        now: DateTime<Utc>,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<StaleSession>, Self::Err>> + Send;

    /// Claim, at `now`, at most `limit` sessions ended but not deleted since
    /// before `before`, longest waiting first: a delete failed, or the
    /// process deleting them stopped. A claimed session waits again before
    /// another sweep claims it.
    fn claim_stuck_sessions(
        &self,
        before: DateTime<Utc>,
        now: DateTime<Utc>,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<StaleSession>, Self::Err>> + Send;

    /// When the person's last routines session that finished and suggested
    /// something ended.
    fn last_routines_ok(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<DateTime<Utc>>, Self::Err>> + Send;

    /// A routines session of the person's, in `timezone`, finished and
    /// suggested something at `now`. Someone outside the nightly rotation
    /// gets a row outside it, to keep the cadence.
    fn routines_ok(
        &self,
        user: &MacroUserIdStr<'_>,
        timezone: &str,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// What became of the person due a nightly run, at `now`: they are next
    /// due at `next_run`, or out of the rotation until seen again. An outcome
    /// older than the one stored changes nothing.
    fn record_nightly(
        &self,
        user: &MacroUserIdStr<'_>,
        outcome: NightlyOutcome,
        next_run: Option<DateTime<Utc>>,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// The person opened their suggestions at `now` in zone `timezone`.
    /// Their next nightly run becomes `next_run`, unless one is set for the
    /// same zone already.
    fn see(
        &self,
        user: &MacroUserIdStr<'_>,
        timezone: &str,
        now: DateTime<Utc>,
        next_run: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// The person's opaque account id, for traces: never their email-shaped
    /// user id.
    fn account(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Err>> + Send;

    /// Delete at most `limit` change-log entries written before `before`;
    /// how many.
    fn prune_changes(
        &self,
        before: DateTime<Utc>,
        limit: u16,
    ) -> impl Future<Output = Result<u64, Self::Err>> + Send;

    /// Generation `generation` runs in trace `trace_id`.
    fn traced(
        &self,
        generation: Uuid,
        trace_id: &str,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// At most `limit` people whose nightly run is due at `now`, longest
    /// waiting first, with no generation running.
    fn due(
        &self,
        now: DateTime<Utc>,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<AudienceMember>, Self::Err>> + Send;

    /// What the person's generations look like now.
    fn overview(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<OverviewFacts, Self::Err>> + Send;
}

/// Who is on a paid plan: only they get nightly generations. Object-safe:
/// the harness hands in its entitlements.
#[async_trait::async_trait]
pub trait Plans: Send + Sync + 'static {
    /// Whether the person is on a paid plan.
    async fn paid(&self, user: &MacroUserIdStr<'static>) -> Result<bool, rootcause::Report>;
}

/// Whether an agent session is stored, to tell a session that is gone from
/// one that couldn't be deleted. Object-safe: the harness hands in its
/// session store.
#[async_trait::async_trait]
pub trait StoredSessions: Send + Sync + 'static {
    /// Whether `session` is stored.
    async fn exists(&self, session: AgentSessionId) -> Result<bool, rootcause::Report>;
}
