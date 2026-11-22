//! Per-account ownership, classified reconnects and tracked optional watcher sockets.
use super::*;
use std::time::Duration;
use tokio_util::{sync::CancellationToken, task::TaskTracker};
use tracing::Instrument;

const UNREADABLE_CONFIRMATION: Duration = Duration::from_secs(30);

struct AccountWatchers {
    tasks: TaskTracker,
    stopped: CancellationToken,
    current: Option<super::watchers::Watcher>,
}

impl Engine {
    /// Wake an owned account after a fenced configuration or provider notification.
    pub fn wake_account(&self, link: Uuid) {
        if let Ok(wakeups) = self.wakeups.lock()
            && let Some((_, wake)) = wakeups.get(&link)
        {
            wake.notify_one();
        }
    }
    /// Own a primary and optional watcher until shutdown or permanent credential refusal.
    pub async fn run_account(
        &self,
        binding: Binding,
        cancellation: CancellationToken,
    ) -> Result<(), Error> {
        let owner = Uuid::now_v7();
        let wake = Arc::new(tokio::sync::Notify::new());
        self.wakeups
            .lock()
            .map_err(|_| Error::ConnectionUnavailable)?
            .insert(binding.link_id, (owner, wake.clone()));
        let mut watchers = AccountWatchers {
            tasks: TaskTracker::new(),
            stopped: cancellation.child_token(),
            current: None,
        };
        let result = self
            .account_loop(binding, owner, &cancellation, &wake, &mut watchers)
            .await;
        watchers.stopped.cancel();
        if let Some(watcher) = &watchers.current {
            watcher.stop.cancel();
        }
        watchers.tasks.close();
        let drained = tokio::time::timeout(Duration::from_secs(10), watchers.tasks.wait()).await;
        if let Ok(mut wakeups) = self.wakeups.lock()
            && wakeups
                .get(&binding.link_id)
                .is_some_and(|(stored, _)| *stored == owner)
        {
            wakeups.remove(&binding.link_id);
        }
        // On a failed drain leave the owner lease in place until expiry rather than permit overlapping sockets.
        if drained.is_err() {
            return Err(Error::ConnectionUnavailable);
        }
        self.transport.disconnect(binding).await?;
        let released = self.repository.release_owner(binding, owner).await;
        match result {
            Ok(()) => released,
            Err(error) => Err(error),
        }
    }
    async fn account_loop(
        &self,
        binding: Binding,
        owner: Uuid,
        cancellation: &CancellationToken,
        wake: &Arc<tokio::sync::Notify>,
        watchers: &mut AccountWatchers,
    ) -> Result<(), Error> {
        let mut failures = 0u32;
        let mut credential_refusals = 0u8;
        let mut unreadable_since = None;
        let mut unreadable_attempts = 0u8;
        let mut healthy_since = tokio::time::Instant::now();
        loop {
            if cancellation.is_cancelled() {
                return Ok(());
            }
            let round_span = tracing::info_span!(parent: None, "imap.account_round", link_id = %binding.link_id, retry_count = failures);
            let round_stop = cancellation.child_token();
            let work = async {
                if !self.repository.claim_owner(binding, owner).await? {
                    return Err(Error::Conflict);
                }
                self.execute_owned_sync(binding, owner, &round_stop).await?;
                if !self.repository.claim_owner(binding, owner).await? {
                    return Err(Error::Conflict);
                }
                let (user_id, ciphertext) = self.repository.credentials(binding).await?;
                let credentials = self
                    .cipher
                    .decrypt(binding.link_id, &user_id, &ciphertext)
                    .await?;
                self.refresh_watcher(
                    binding,
                    owner,
                    wake,
                    &watchers.tasks,
                    &watchers.stopped,
                    &mut watchers.current,
                )
                .await?;
                let host = credentials.imap.endpoint.host.clone();
                let host_hash = format!("{:x}", Sha256::digest(host.as_bytes()));
                let previous = self.repository.idle_state(&host_hash).await?;
                let interval = {
                    let mut policy = self
                        .idle_policy
                        .lock()
                        .map_err(|_| Error::ConnectionUnavailable)?;
                    if policy.state(&host).is_none()
                        && let Some(state) = previous
                    {
                        policy.restore(&host, state);
                    }
                    policy.restart_seconds(&host)
                };
                let started = tokio::time::Instant::now();
                let result = tokio::select! {
                    biased;
                    _ = round_stop.cancelled() => return Err(Error::Conflict),
                    _ = wake.notified() => Ok(()),
                    result = self.transport.wait_change(&credentials, interval) => result,
                };
                drop(credentials);
                let elapsed =
                    u64::try_from(started.elapsed().as_millis()).map_err(|_| Error::Invalid)?;
                let observed = match result {
                    Err(
                        Error::ConnectionUnavailable
                        | Error::DnsUnavailable
                        | Error::TcpUnavailable
                        | Error::TlsUnavailable
                        | Error::ConnectionTimedOut,
                    ) => super::super::adaptive_idle::Outcome::Drop {
                        quiet_ms: elapsed,
                        age_ms: elapsed,
                        ran_interval_ms: Some(interval * 1000),
                        idling: true,
                    },
                    _ => super::super::adaptive_idle::Outcome::Stable {
                        age_ms: elapsed,
                        ran_interval_ms: Some(interval * 1000),
                    },
                };
                let state = {
                    let mut policy = self
                        .idle_policy
                        .lock()
                        .map_err(|_| Error::ConnectionUnavailable)?;
                    policy.observe(&host, &observed);
                    policy.state(&host).cloned()
                };
                if let Some(state) = state {
                    self.repository.save_idle_state(&host_hash, &state).await?;
                }
                result
            }
            .instrument(round_span.clone());
            let outcome = {
                tokio::pin!(work);
                // Poll renewals beside the round: a slow database heartbeat must
                // not suspend provider progress or its deadline/lease cleanup.
                let heartbeat = async {
                    let mut renewal = tokio::time::interval_at(
                        tokio::time::Instant::now() + OWNER_RENEW_INTERVAL,
                        OWNER_RENEW_INTERVAL,
                    );
                    renewal.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
                    loop {
                        tokio::select! {
                            biased;
                            _ = round_stop.cancelled() => return,
                            _ = renewal.tick() => {},
                        }
                        match self
                            .repository
                            .claim_owner(binding, owner)
                            .instrument(round_span.clone())
                            .await
                        {
                            Ok(true) => {}
                            Ok(false) => {
                                round_stop.cancel();
                                return;
                            }
                            Err(error) => tracing::warn!(
                                ?error,
                                "IMAP owner renewal failed; retrying next heartbeat"
                            ),
                        }
                    }
                };
                tokio::select! {
                    biased;
                    result = &mut work => result,
                    _ = heartbeat => work.await,
                }
            };
            if cancellation.is_cancelled() {
                return Ok(());
            }
            if !matches!(outcome, Err(Error::CredentialsUnreadable)) {
                unreadable_since = None;
                unreadable_attempts = 0;
            }
            match outcome {
                Ok(()) => {
                    credential_refusals = 0;
                    if healthy_since.elapsed() >= Duration::from_secs(300) {
                        failures = 0;
                    }
                }
                Err(Error::SnapshotTooLarge) => {
                    // The persisted deadline also protects provider bandwidth if
                    // this owner expires or another replica starts an actor.
                    let retry_at = self
                        .repository
                        .read_scoped(binding, StateSelection::Catalog)
                        .await
                        .ok()
                        .and_then(|account| account.state.sync_retry_at);
                    let delay = retry_at
                        .and_then(|retry_at| (retry_at - Utc::now()).to_std().ok())
                        .unwrap_or(Duration::from_secs(3600));
                    tracing::warn!(link_id = %binding.link_id, retry_after_seconds = delay.as_secs_f64(),
                        "Mailbox exceeds sync budget; waiting before retry");
                    tokio::select! {
                        biased;
                        _ = cancellation.cancelled() => return Ok(()),
                        _ = wake.notified() => {},
                        _ = tokio::time::sleep(delay) => {},
                    }
                    continue;
                }
                Err(Error::CredentialsRejected) => {
                    credential_refusals = credential_refusals.saturating_add(1);
                    if credential_refusals >= 2 {
                        if let Ok(mut account) = self
                            .repository
                            .acquire_scoped(binding, StateSelection::Catalog)
                            .await
                        {
                            let saved = self.record_reconnect(&mut account, None).await;
                            let released = self.repository.release(&account).await;
                            saved?;
                            released?;
                        }
                        return Err(Error::CredentialsRejected);
                    }
                    failures = failures.saturating_add(1);
                    healthy_since = tokio::time::Instant::now();
                }
                Err(Error::CredentialsUnreadable) => {
                    let first = unreadable_since.get_or_insert_with(tokio::time::Instant::now);
                    unreadable_attempts = unreadable_attempts.saturating_add(1);
                    if unreadable_attempts >= 2 && first.elapsed() >= UNREADABLE_CONFIRMATION {
                        return match self.deliver_unreadable(binding, owner, cancellation).await {
                            Ok(()) => Err(Error::CredentialsUnreadable),
                            Err(Error::Conflict | Error::Forbidden | Error::NotFound) => Ok(()),
                            Err(error) => Err(error),
                        };
                    }
                    failures = failures.saturating_add(1);
                    healthy_since = tokio::time::Instant::now();
                }
                Err(Error::Conflict | Error::Forbidden | Error::NotFound) => return Ok(()),
                Err(error) => {
                    failures = failures.saturating_add(1);
                    healthy_since = tokio::time::Instant::now();
                    tracing::warn!(
                        ?error,
                        link_id = %binding.link_id,
                        attempt = i64::from(failures),
                        "IMAP reconnect scheduled"
                    );
                }
            }
            if failures > 0 {
                let seconds = 2u64.pow(failures.min(9)).min(900);
                let jitter = u64::try_from(Uuid::now_v7().as_u128() % u128::from(seconds * 1000))
                    .map_err(|_| Error::Invalid)?;
                tokio::select! {
                    biased;
                    _ = cancellation.cancelled() => return Ok(()),
                    _ = wake.notified() => {},
                    _ = tokio::time::sleep(Duration::from_millis(1000 + jitter)) => {},
                }
            }
        }
    }

    /// Parking is separate from a provider rejection. Keep notification delivery
    /// retryable when the email host is still starting, without reopening mail sockets.
    async fn deliver_unreadable(
        &self,
        binding: Binding,
        owner: Uuid,
        cancellation: &CancellationToken,
    ) -> Result<(), Error> {
        let mut attempts = 0u32;
        loop {
            let delivery = async {
                if !self.repository.claim_owner(binding, owner).await? {
                    return Err(Error::Conflict);
                }
                let mut account = self
                    .repository
                    .acquire_scoped(binding, StateSelection::Catalog)
                    .await?;
                let result = self
                    .record_reconnect(
                        &mut account,
                        Some(models_email::service::link::MailboxIssue::CredentialsUnreadable),
                    )
                    .await;
                let released = self.repository.release(&account).await;
                let delivered = result?;
                released?;
                Ok(delivered)
            }
            .instrument(tracing::info_span!("imap.credentials.reconnect", link_id = %binding.link_id, retry_count = attempts))
            .await;
            match delivery {
                Ok(true) => return Ok(()),
                Err(Error::Conflict | Error::Forbidden | Error::NotFound) => {
                    return Err(Error::Conflict);
                }
                Err(error) => tracing::warn!(?error, "Mailbox reconnect health remains pending"),
                Ok(false) => {}
            }
            attempts = attempts.saturating_add(1);
            let delay = Duration::from_secs((5 * u64::from(attempts)).min(60));
            tokio::select! {
                biased;
                _ = cancellation.cancelled() => return Err(Error::Conflict),
                _ = tokio::time::sleep(delay) => {},
            }
        }
    }

    async fn record_reconnect(
        &self,
        account: &mut Account,
        issue: Option<models_email::service::link::MailboxIssue>,
    ) -> Result<bool, Error> {
        if !account.state.needs_reauth || account.state.mailbox_issue != issue {
            account.state.needs_reauth = true;
            account.state.mailbox_issue = issue;
            account.state.sync_retry_at = None;
            account.state.notification_pending = true;
            self.repository.save_health(account).await?;
        }
        self.notify(account).await?;
        Ok(!account.state.notification_pending || self.notifier.is_none())
    }
}
