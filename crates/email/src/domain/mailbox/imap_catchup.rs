//! Leased recovery of persisted IMAP cursors; hints improve latency, not ownership.
use super::MailboxError;
use std::future::Future;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::AsRefStr, strum::EnumString)]
#[strum(serialize_all = "snake_case")]
pub enum CatchupMode {
    Startup,
    Pending,
}

#[derive(Debug, Clone)]
pub struct CatchupLease {
    pub id: Uuid,
    pub after: Uuid,
    pub mode: CatchupMode,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CatchupPage {
    pub scanned: u32,
    pub woken: u32,
    pub deferred: u32,
    pub failed: u32,
    pub complete: bool,
    pub deferred_attempts_max: u32,
    pub deferred_age_seconds_max: u64,
}

pub trait ImapCatchupRepository: Send + Sync + 'static {
    /// Coalesce worker startup requests; never restart a page already being processed.
    fn request_startup(
        &self,
        coalesce_seconds: u32,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
    fn claim(
        &self,
        id: Uuid,
        lease_seconds: u32,
    ) -> impl Future<Output = Result<Option<CatchupLease>, MailboxError>> + Send;
    /// At most `limit` indexed stream rows, including skipped/ineligible rows.
    /// Individual row failures advance the cursor and retry in the next cycle.
    fn advance(
        &self,
        lease: &CatchupLease,
        limit: u32,
        idle_seconds: u32,
    ) -> impl Future<Output = Result<CatchupPage, MailboxError>> + Send;
}

pub struct ImapCatchupService<R>(pub R);

#[derive(Debug)]
pub enum CatchupTick {
    Busy,
    Page(CatchupPage),
}

#[derive(strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
enum CatchupOutcome {
    Busy,
    Progress,
    Complete,
    Failed,
}

impl<R: ImapCatchupRepository> ImapCatchupService<R> {
    pub async fn request_startup(&self) -> Result<(), MailboxError> {
        self.0.request_startup(300).await
    }

    #[tracing::instrument(skip_all, name = "email.imap.catch_up", fields(
        catchup.scanned = tracing::field::Empty,
        catchup.woken = tracing::field::Empty,
        catchup.deferred = tracing::field::Empty,
        catchup.failed = tracing::field::Empty,
        catchup.outcome = tracing::field::Empty,
        catchup.needs_attention = tracing::field::Empty,
        catchup.deferred_attempts_max = tracing::field::Empty,
        catchup.deferred_age_seconds_max = tracing::field::Empty,
    ))]
    pub async fn tick(&self) -> Result<CatchupTick, MailboxError> {
        let result = async {
            let Some(lease) = self.0.claim(Uuid::now_v7(), 120).await? else {
                return Ok(CatchupTick::Busy);
            };
            self.0.advance(&lease, 16, 30).await.map(CatchupTick::Page)
        }
        .await;
        let (outcome, counts) = match &result {
            Ok(CatchupTick::Busy) => (CatchupOutcome::Busy, [0; 4]),
            Ok(CatchupTick::Page(page)) => (
                if page.complete {
                    CatchupOutcome::Complete
                } else {
                    CatchupOutcome::Progress
                },
                [page.scanned, page.woken, page.deferred, page.failed],
            ),
            Err(_) => (CatchupOutcome::Failed, [0; 4]),
        };
        let span = tracing::Span::current();
        span.record("catchup.outcome", outcome.as_ref());
        span.record("catchup.scanned", i64::from(counts[0]));
        span.record("catchup.woken", i64::from(counts[1]));
        span.record("catchup.deferred", i64::from(counts[2]));
        span.record("catchup.failed", i64::from(counts[3]));
        let (attempts, age) = match &result {
            Ok(CatchupTick::Page(page)) => {
                (page.deferred_attempts_max, page.deferred_age_seconds_max)
            }
            Ok(CatchupTick::Busy) | Err(_) => (0, 0),
        };
        span.record("catchup.deferred_attempts_max", i64::from(attempts));
        span.record(
            "catchup.deferred_age_seconds_max",
            i64::try_from(age).unwrap_or(i64::MAX),
        );
        span.record(
            "catchup.needs_attention",
            result.is_err() || counts[3] > 0 || age >= 300,
        );
        result
    }
}
