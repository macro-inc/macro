//! What generations need from storage.

use std::future::Future;

use bot_id::BotId;
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use suggestions::domain::model::{GenerationTrigger, SessionKind};

use super::model::{AudienceMember, StaleSession};

/// Generations, their sessions and who gets a nightly one, in storage.
pub trait GenerationRepo: Send + Sync + 'static {
    /// The error type returned by repository operations.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Start a generation for the person, triggered by `trigger`, at `now`;
    /// its id, or none when none may start: one is running, the person's
    /// onboarding one ran, or a nightly one started after `nightly_since`.
    /// An onboarding run doesn't hold back that night's nightly run: it is
    /// the quick brief, not the full research. A
    /// running one of the same trigger that started before `stale_before`
    /// was interrupted (its process stopped) and starts again; one of the
    /// other trigger is recorded failed, so it holds nothing back.
    fn begin(
        &self,
        user: &MacroUserIdStr<'_>,
        trigger: GenerationTrigger,
        now: DateTime<Utc>,
        stale_before: DateTime<Utc>,
        nightly_since: DateTime<Utc>,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Err>> + Send;

    /// Record how generation `generation` ended.
    fn finish(
        &self,
        generation: Uuid,
        ready: bool,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

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

    /// Close `session`: its tools refuse it from now on.
    fn close_session(&self, session: Uuid) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Sessions opened before `before` and never closed, oldest first, at
    /// most `limit`: left behind by a process that stopped.
    fn stale_sessions(
        &self,
        before: DateTime<Utc>,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<StaleSession>, Self::Err>> + Send;

    /// Whether a routines session opened for the person after `since`.
    fn routines_since(
        &self,
        user: &MacroUserIdStr<'_>,
        since: DateTime<Utc>,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Take the person out of the nightly audience until they are seen again.
    fn forget(
        &self,
        user: &MacroUserIdStr<'_>,
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

    /// The person's next nightly run is due at `at`.
    fn reschedule(
        &self,
        user: &MacroUserIdStr<'_>,
        at: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// At most `limit` people whose nightly run is due at `now`, longest
    /// waiting first, with no generation running since `stale_before` (one
    /// still running from before was interrupted and holds no one back).
    fn due(
        &self,
        now: DateTime<Utc>,
        stale_before: DateTime<Utc>,
        limit: u16,
    ) -> impl Future<Output = Result<Vec<AudienceMember>, Self::Err>> + Send;
}

/// Who is on a paid plan: only they get nightly generations. Object-safe:
/// the harness hands in its entitlements.
#[async_trait::async_trait]
pub trait Plans: Send + Sync + 'static {
    /// Whether the person is on a paid plan.
    async fn paid(&self, user: &MacroUserIdStr<'static>) -> Result<bool, rootcause::Report>;
}
