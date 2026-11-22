//! Durable host hints retry independently of provider scans and IDLE intervals.
use super::*;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Copy, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub(super) enum HintOutcome {
    NotPending,
    Acknowledged,
    Pending,
    Busy,
    Unavailable,
}

pub(super) fn notification(account: &Account) -> Notification {
    Notification {
        binding: account.binding,
        revision: Some(account.revision),
        credentials_rejected: account.state.needs_reauth
            && account.state.mailbox_issue
                != Some(models_email::service::link::MailboxIssue::CredentialsUnreadable),
        mailbox_issue: account.state.mailbox_issue,
        sync_retry_at: account.state.sync_retry_at,
    }
}

impl Engine {
    pub(super) async fn retry_host_hints(
        &self,
        binding: Binding,
        owner: Uuid,
        stopped: &CancellationToken,
        changed: &Arc<tokio::sync::Notify>,
    ) -> Result<(), Error> {
        if self.notifier.is_none() {
            stopped.cancelled().await;
            return Ok(());
        }
        let mut attempts = 1u32;
        let mut acked_revision = None;
        let mut pending_since = None;
        let mut reported = false;
        loop {
            if stopped.is_cancelled() {
                return Ok(());
            }
            let mut pending_age = pending_since
                .map(|at: tokio::time::Instant| at.elapsed().as_secs())
                .unwrap_or(0);
            let result = self
                .flush_host_hint_once(
                    binding,
                    owner,
                    attempts,
                    &mut pending_age,
                    &mut acked_revision,
                )
                .await;
            let pending = match result {
                Ok(HintOutcome::NotPending | HintOutcome::Acknowledged) => false,
                Ok(HintOutcome::Pending | HintOutcome::Busy | HintOutcome::Unavailable) => true,
                Err(Error::Conflict | Error::Forbidden | Error::NotFound) => {
                    return Ok(());
                }
                Err(error) => {
                    tracing::warn!(?error, "IMAP host hint delivery will retry");
                    true
                }
            };
            if pending {
                pending_since.get_or_insert_with(tokio::time::Instant::now);
                if pending_age >= 300 && !reported {
                    tracing::warn!(link_id = %binding.link_id, notification.pending_seconds = pending_age,
                        "IMAP host hint has remained pending for five minutes");
                    reported = true;
                }
                let delay = std::time::Duration::from_secs(
                    (5 * 2u64.pow(attempts.saturating_sub(1).min(4))).min(60),
                );
                attempts = attempts.saturating_add(1);
                // New mail cannot bypass a callback outage's bounded backoff.
                tokio::select! {
                    biased;
                    _ = stopped.cancelled() => return Ok(()),
                    _ = tokio::time::sleep(delay) => {},
                }
            } else {
                attempts = 1;
                pending_since = None;
                reported = false;
                tokio::select! {
                    biased;
                    _ = stopped.cancelled() => return Ok(()),
                    _ = changed.notified() => {},
                    _ = tokio::time::sleep(std::time::Duration::from_secs(60)) => {},
                }
            }
        }
    }

    #[tracing::instrument(skip_all, name = "imap.host_notification.flush", fields(
        link_id = %binding.link_id,
        notification.attempts = attempts,
        notification.pending_seconds = tracing::field::Empty,
        notification.pending_too_long = tracing::field::Empty,
        notification.outcome = tracing::field::Empty,
    ))]
    pub(super) async fn flush_host_hint_once(
        &self,
        binding: Binding,
        owner: Uuid,
        attempts: u32,
        pending_age: &mut u64,
        acked_revision: &mut Option<i64>,
    ) -> Result<HintOutcome, Error> {
        let mut durable_pending_age = *pending_age;
        let result = async {
            if !self.repository.claim_owner(binding, owner).await? {
                return Err(Error::Conflict);
            }
            let observed = self
                .repository
                .read_scoped(binding, StateSelection::Catalog)
                .await?;
            if !observed.state.notification_pending {
                return Ok(HintOutcome::NotPending);
            }
            let Some(notifier) = &self.notifier else {
                return Ok(HintOutcome::NotPending);
            };
            if let Some(since) = observed.state.notification_pending_since {
                durable_pending_age =
                    u64::try_from((Utc::now() - since).num_seconds().max(0)).unwrap_or(u64::MAX);
            }
            // An ACK survives local contention while clearing the durable bit.
            // No command lease or DB connection is retained across HTTP IO.
            if *acked_revision != Some(observed.revision) {
                notifier.notify(notification(&observed)).await?;
                *acked_revision = Some(observed.revision);
            }
            let mut current = self
                .repository
                .acquire_scoped(binding, StateSelection::Catalog)
                .await?;
            let mut outcome = HintOutcome::Pending;
            let saved = if !current.state.notification_pending {
                outcome = HintOutcome::Acknowledged;
                Ok(())
            } else if current.revision == observed.revision {
                current.state.clear_notification_pending();
                outcome = HintOutcome::Acknowledged;
                self.repository.save_health(&mut current).await
            } else {
                // An ACK for an older state must not clear a newer snapshot's hint.
                Ok(())
            };
            let released = self.repository.release(&current).await;
            saved?;
            released?;
            Ok(outcome)
        }
        .await;
        let outcome = match &result {
            Ok(outcome) => *outcome,
            Err(Error::AccountBusy) => HintOutcome::Busy,
            Err(_) => HintOutcome::Unavailable,
        };
        let span = tracing::Span::current();
        span.record("notification.outcome", outcome.as_ref());
        span.record("notification.pending_seconds", durable_pending_age);
        *pending_age = durable_pending_age;
        span.record(
            "notification.pending_too_long",
            durable_pending_age >= 300
                && !matches!(outcome, HintOutcome::Acknowledged | HintOutcome::NotPending),
        );
        result
    }
}
