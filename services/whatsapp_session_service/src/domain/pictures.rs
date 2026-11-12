//! Profile-picture checks for one account, one at a time and at a gentle
//! pace: WhatsApp bans accounts that query many pictures of strangers. The
//! domain decides what is due and holds the hourly and daily budget in
//! Postgres; this loop spaces the queries and backs off when WhatsApp says
//! the account is querying too much.

use std::time::Duration;

use external_chat::domain::models::ExternalChatError;
use tokio::sync::{Notify, watch};
use tokio_util::sync::CancellationToken;
use tracing::Instrument;
use whatsapp_linked::domain::events::{PictureAnswer, PictureCheck, SessionScope};
use whatsapp_linked::domain::session::SessionService;

use std::sync::Arc;

use super::ports::{SessionError, WhatsAppSession};

/// Pacing of one account's picture queries.
#[derive(Debug, Clone, Copy)]
pub struct PicturePacing {
    /// Least time between two queries ([`PICTURE_SPACING`] in production).
    pub spacing: Duration,
    /// Wait after connecting before the first query, so checks don't pile
    /// onto the login burst ([`PICTURE_WARMUP`]).
    pub warmup: Duration,
    /// The first pause after WhatsApp rate-limits the account; it doubles on
    /// each further limit up to 24 times this ([`PICTURE_BACKOFF`]).
    pub backoff: Duration,
}

/// Production [`PicturePacing::spacing`].
pub const PICTURE_SPACING: Duration = Duration::from_secs(3);
/// Production [`PicturePacing::warmup`].
pub const PICTURE_WARMUP: Duration = Duration::from_secs(60);
/// Production [`PicturePacing::backoff`]: 15 minutes, doubling up to 6 hours.
pub const PICTURE_BACKOFF: Duration = Duration::from_secs(15 * 60);

/// Everything the check loop needs.
pub(crate) struct PictureChecks<Session> {
    pub(crate) sessions: SessionService,
    pub(crate) scope: SessionScope,
    pub(crate) session: Arc<Session>,
    /// Woken when a picture became due (a change notification).
    pub(crate) wake: Arc<Notify>,
    /// Checks only run while connected.
    pub(crate) connected: watch::Receiver<bool>,
    pub(crate) every: Duration,
    pub(crate) pacing: PicturePacing,
    /// Cancelled when a write was fenced.
    pub(crate) fenced: CancellationToken,
}

/// What to do after one check.
enum Pace {
    /// Nothing was due or the budget is spent: wait for a wake or a tick.
    Idle,
    /// Checked one; the next may follow after the spacing.
    Next,
    /// WhatsApp rate-limited the account: pause.
    Limited,
    Fenced,
}

impl<Session: WhatsAppSession> PictureChecks<Session> {
    /// Checks until `stop`.
    pub(crate) async fn run(mut self, stop: CancellationToken) {
        let mut backoff = None;
        let mut warm = false;
        loop {
            let connected = tokio::select! {
                () = stop.cancelled() => return,
                () = self.fenced.cancelled() => return,
                connected = self.connected.wait_for(|connected| *connected) => connected.is_ok(),
            };
            if !connected {
                return;
            }
            if !warm {
                tokio::select! {
                    () = stop.cancelled() => return,
                    () = self.fenced.cancelled() => return,
                    () = tokio::time::sleep(self.pacing.warmup) => {}
                }
                warm = true;
            }
            let wait = match self.check_one().await {
                Pace::Fenced => return,
                Pace::Next => {
                    backoff = None;
                    Some(self.pacing.spacing)
                }
                Pace::Limited => {
                    let pause = backoff.map_or(self.pacing.backoff, |pause: Duration| {
                        (pause * 2).min(self.pacing.backoff * 24)
                    });
                    tracing::warn!(
                        telemetry_event = "whatsapp_picture_rate_limited",
                        account_id = %self.scope.account_id,
                        pause_seconds = pause.as_secs(),
                        "WhatsApp rate-limited profile-picture queries; pausing them"
                    );
                    backoff = Some(pause);
                    Some(pause)
                }
                Pace::Idle => None,
            };
            match wait {
                Some(wait) => tokio::select! {
                    () = stop.cancelled() => return,
                    () = self.fenced.cancelled() => return,
                    () = tokio::time::sleep(wait) => {}
                },
                None => tokio::select! {
                    () = stop.cancelled() => return,
                    () = self.fenced.cancelled() => return,
                    () = self.wake.notified() => {}
                    () = tokio::time::sleep(self.every) => {}
                },
            }
            // A disconnect while waiting starts the warmup over.
            if !*self.connected.borrow() {
                warm = false;
            }
        }
    }

    async fn check_one(&self) -> Pace {
        let claimed = match self.sessions.claim_picture_checks(self.scope, 1).await {
            Ok(claimed) => claimed,
            Err(report) if matches!(report.current_context(), ExternalChatError::Fenced) => {
                self.fenced.cancel();
                return Pace::Fenced;
            }
            Err(report) => {
                tracing::warn!(error = %report, "Claiming WhatsApp picture checks failed");
                return Pace::Idle;
            }
        };
        let Some(check) = claimed.into_iter().next() else {
            return Pace::Idle;
        };
        self.check(&check).await
    }

    async fn check(&self, check: &PictureCheck) -> Pace {
        let span = tracing::info_span!(
            "whatsapp.picture.check",
            account_id = %self.scope.account_id,
            kind = if check.jid.ends_with("@g.us") { "group" } else { "person" },
            offered_existing = check.existing_id.is_some(),
            outcome = tracing::field::Empty,
            bytes = tracing::field::Empty,
        );
        async {
            let answer = match self.session.profile_picture(check).await {
                Ok(answer) => answer,
                Err(SessionError::Fenced) => {
                    self.fenced.cancel();
                    return Pace::Fenced;
                }
                Err(error) => {
                    tracing::warn!(error = %error, "Checking a WhatsApp profile picture failed");
                    PictureAnswer::Failed
                }
            };
            let span = tracing::Span::current();
            span.record(
                "outcome",
                match &answer {
                    PictureAnswer::Unchanged => "unchanged",
                    PictureAnswer::Picture { .. } => "stored",
                    PictureAnswer::Hidden => "hidden",
                    PictureAnswer::NotSet => "not_set",
                    PictureAnswer::RateLimited => "rate_limited",
                    PictureAnswer::Failed => "failed",
                },
            );
            if let PictureAnswer::Picture { bytes, .. } = &answer {
                span.record("bytes", bytes.len());
            }
            match self
                .sessions
                .complete_picture_check(self.scope, &check.jid, &answer)
                .await
            {
                Err(report) if matches!(report.current_context(), ExternalChatError::Fenced) => {
                    self.fenced.cancel();
                    return Pace::Fenced;
                }
                Err(report) => {
                    tracing::warn!(error = %report, "Recording a WhatsApp picture check failed");
                }
                Ok(()) => {}
            }
            match answer {
                PictureAnswer::RateLimited => Pace::Limited,
                _ => Pace::Next,
            }
        }
        .instrument(span)
        .await
    }
}
