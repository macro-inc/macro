//! Account ownership on one replica: which accounts it runs, taking free ones,
//! handing them over on drain, and stopping everything when the locks are lost.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::mpsc;
use tokio::task::{AbortHandle, Id, JoinError, JoinSet};
use tokio_util::sync::CancellationToken;
use tracing::Instrument;
use uuid::Uuid;

use super::ports::{
    AccountControl, AccountDirectory, AccountExit, AccountLocks, AccountRunner, AccountSignal,
    LeaseError, Traced,
};

#[cfg(test)]
mod test;

/// Signals for this replica, one per `NOTIFY` (see `outbound::signals`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Signal {
    /// `whatsapp_account_released`: another replica let the account go.
    AccountReleased(Uuid),
    /// `whatsapp_pairing_requested`, carrying the pairing id.
    PairingRequested(Uuid),
    /// `whatsapp_send_requested`.
    SendRequested(Uuid),
    /// `whatsapp_roster_requested`.
    GroupsRequested(Uuid),
    /// `whatsapp_lookup_requested`.
    LookupRequested(Uuid),
    /// `whatsapp_account_changed`.
    AccountChanged(Uuid),
    /// The listener reconnected, so notifications may have been missed.
    Resync,
}

/// Limits and timings.
#[derive(Debug, Clone, Copy)]
pub struct SupervisorConfig {
    /// Most accounts this replica runs at once.
    pub max_accounts: u32,
    /// Accounts released per drain step.
    pub drain_batch: u32,
    /// How often to look for free accounts without a signal.
    pub rescan_every: Duration,
    /// How long a released account may take to finish in-flight sends.
    pub release_timeout: Duration,
    /// How long a stopped account may take to return.
    pub stop_timeout: Duration,
    /// Longest the whole drain may take; what is left is stopped at once.
    pub drain_deadline: Duration,
    /// How often to report fleet health.
    pub health_every: Duration,
}

/// Why the supervisor returned early.
#[derive(Debug, thiserror::Error)]
pub enum SupervisorError {
    /// The lock connection died; every account was stopped.
    #[error("account locks were lost")]
    LocksLost,
    /// The signal listener stopped.
    #[error("the signal listener stopped")]
    SignalsClosed,
}

/// Unread signals per account before new ones are dropped. Every signal makes
/// the runner re-read its state, so dropped duplicates lose nothing.
const ACCOUNT_SIGNAL_CAPACITY: usize = 8;

struct Running {
    signals: mpsc::Sender<Traced<AccountSignal>>,
    release: CancellationToken,
    stop: CancellationToken,
    /// Ends the runner's task when it ignores `stop` for `stop_timeout`.
    abort: AbortHandle,
}

/// Runs the accounts this replica holds locks for.
pub struct Supervisor<Locks, Directory, Runner> {
    locks: Locks,
    directory: Directory,
    runner: Arc<Runner>,
    config: SupervisorConfig,
    accounts: HashMap<Uuid, Running>,
    tasks: JoinSet<AccountExit>,
    task_accounts: HashMap<Id, Uuid>,
}

impl<Locks, Directory, Runner> Supervisor<Locks, Directory, Runner>
where
    Locks: AccountLocks,
    Directory: AccountDirectory,
    Runner: AccountRunner,
{
    /// A supervisor over one lock connection.
    pub fn new(
        locks: Locks,
        directory: Directory,
        runner: Arc<Runner>,
        config: SupervisorConfig,
    ) -> Self {
        Supervisor {
            locks,
            directory,
            runner,
            config,
            accounts: HashMap::new(),
            tasks: JoinSet::new(),
            task_accounts: HashMap::new(),
        }
    }

    /// Runs until `shutdown` (then drains and returns `Ok`) or until the locks
    /// are lost (then stops every account and returns the error).
    pub async fn run(
        mut self,
        signals: &mut mpsc::Receiver<Traced<Signal>>,
        shutdown: CancellationToken,
    ) -> Result<(), SupervisorError> {
        let lost = self.locks.lost();
        let mut rescan = tokio::time::interval(self.config.rescan_every);
        rescan.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut health = tokio::time::interval(self.config.health_every);
        health.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            let step = tokio::select! {
                biased;
                () = lost.cancelled() => Err(LeaseError::Lost),
                () = shutdown.cancelled() => {
                    return self.drain().await;
                }
                Some(joined) = self.tasks.join_next_with_id() => {
                    self.finished(joined, false).await
                }
                signal = signals.recv() => match signal {
                    // The work a notification causes joins the sender's trace.
                    Some(Traced { signal, span }) => {
                        self.handle(signal, &span).instrument(span.clone()).await
                    }
                    None => {
                        self.stop_all().await;
                        return Err(SupervisorError::SignalsClosed);
                    }
                },
                _ = rescan.tick() => self.rescan().await,
                _ = health.tick() => self.report_health().await,
            };
            match step {
                Ok(()) => {}
                Err(LeaseError::Lost) => {
                    self.stop_all().await;
                    return Err(SupervisorError::LocksLost);
                }
                Err(LeaseError::Internal(report)) => {
                    tracing::warn!(error = %report, "WhatsApp account supervision step failed");
                }
            }
        }
    }

    async fn handle(&mut self, signal: Signal, span: &tracing::Span) -> Result<(), LeaseError> {
        match signal {
            Signal::AccountReleased(account) => self.take(account).await,
            Signal::PairingRequested(pairing) => {
                match self.directory.pairing_account(pairing).await? {
                    Some(account) if self.accounts.contains_key(&account) => {
                        self.forward(account, AccountSignal::Pairing(pairing), span);
                        Ok(())
                    }
                    Some(account) => self.take(account).await,
                    None => Ok(()),
                }
            }
            Signal::SendRequested(account) => {
                self.forward(account, AccountSignal::Send, span);
                Ok(())
            }
            Signal::GroupsRequested(account) => {
                self.forward(account, AccountSignal::Groups, span);
                Ok(())
            }
            Signal::LookupRequested(account) => {
                self.forward(account, AccountSignal::Lookup, span);
                Ok(())
            }
            Signal::AccountChanged(account) if self.accounts.contains_key(&account) => {
                self.forward(account, AccountSignal::Changed, span);
                Ok(())
            }
            Signal::AccountChanged(account) => self.take(account).await,
            Signal::Resync => {
                for running in self.accounts.values() {
                    let _ = running.signals.try_send(AccountSignal::Resync.into());
                }
                self.rescan().await
            }
        }
    }

    fn forward(&self, account: Uuid, signal: AccountSignal, span: &tracing::Span) {
        if let Some(running) = self.accounts.get(&account) {
            // Full means the runner already has work queued; see the capacity.
            let _ = running.signals.try_send(Traced {
                signal,
                span: span.clone(),
            });
        }
    }

    fn at_capacity(&self) -> bool {
        self.accounts.len() >= self.config.max_accounts as usize
    }

    /// Takes the account's lock if it is free and this replica has room.
    async fn take(&mut self, account: Uuid) -> Result<(), LeaseError> {
        if self.accounts.contains_key(&account) || self.at_capacity() {
            return Ok(());
        }
        let span = tracing::info_span!(
            "whatsapp.account.lease",
            account_id = %account,
            acquired = tracing::field::Empty,
            held = self.accounts.len(),
        );
        let acquired = self
            .locks
            .try_lock(account)
            .instrument(span.clone())
            .await?;
        span.record("acquired", acquired);
        if acquired {
            self.start(account);
        }
        Ok(())
    }

    fn start(&mut self, account: Uuid) {
        let (sender, receiver) = mpsc::channel(ACCOUNT_SIGNAL_CAPACITY);
        let release = CancellationToken::new();
        let stop = self.locks.lost().child_token();
        let control = AccountControl {
            signals: receiver,
            cause: tracing::Span::current(),
            release: release.clone(),
            stop: stop.clone(),
        };
        let runner = Arc::clone(&self.runner);
        let abort = self
            .tasks
            .spawn(async move { runner.run(account, control).await });
        self.task_accounts.insert(abort.id(), account);
        self.accounts.insert(
            account,
            Running {
                signals: sender,
                release,
                stop,
                abort,
            },
        );
    }

    /// Unlocks an account whose runner returned, and announces it when it
    /// still needs a session.
    async fn finished(
        &mut self,
        joined: Result<(Id, AccountExit), JoinError>,
        draining: bool,
    ) -> Result<(), LeaseError> {
        let (id, exit) = match joined {
            Ok((id, exit)) => (id, exit),
            // Aborted by the drain after ignoring `stop`: it still needs a
            // session, so it is announced like any stopped account.
            Err(error) if error.is_cancelled() && draining => (error.id(), AccountExit::Stopped),
            Err(error) => {
                tracing::error!(error = %error, "WhatsApp account task panicked");
                (error.id(), AccountExit::Failed)
            }
        };
        let Some(account) = self.task_accounts.remove(&id) else {
            return Ok(());
        };
        self.accounts.remove(&account);
        let announce = exit == AccountExit::Released || (draining && exit == AccountExit::Stopped);
        let span = tracing::info_span!(
            "whatsapp.account.release",
            account_id = %account,
            exit = ?exit,
            announced = announce,
        );
        async {
            self.locks.unlock(account).await?;
            if announce {
                self.directory.announce_released(account).await?;
            }
            Ok(())
        }
        .instrument(span)
        .await
    }

    async fn report_health(&self) -> Result<(), LeaseError> {
        let health = self.directory.health().await?;
        tracing::info!(
            telemetry_event = "whatsapp_session_health",
            accounts_running = self.accounts.len(),
            accounts_unowned = health.accounts_unowned,
            oldest_unprocessed_inbound_seconds = health.oldest_unprocessed_inbound_seconds,
            "WhatsApp session health"
        );
        Ok(())
    }

    async fn rescan(&mut self) -> Result<(), LeaseError> {
        if self.at_capacity() {
            return Ok(());
        }
        let room = self.config.max_accounts - self.accounts.len() as u32;
        let span = tracing::info_span!(
            "whatsapp.account.rescan",
            room,
            candidates = tracing::field::Empty,
        );
        let candidates = self
            .directory
            .candidates(room)
            .instrument(span.clone())
            .await?;
        span.record("candidates", candidates.len());
        for account in candidates {
            self.take(account).await?;
        }
        Ok(())
    }

    /// Hands every account over in batches, so other replicas take them while
    /// the rest keep running. Accounts still running at `drain_deadline` are
    /// stopped together, and a stopped account that has not returned within
    /// `stop_timeout` is aborted, so the whole drain fits the platform's stop
    /// timeout.
    async fn drain(mut self) -> Result<(), SupervisorError> {
        let started = tokio::time::Instant::now();
        let drain_end = started + self.config.drain_deadline;
        let span = tracing::info_span!(
            "whatsapp.drain",
            accounts = self.accounts.len(),
            batch = self.config.drain_batch,
            released = tracing::field::Empty,
            timed_out = tracing::field::Empty,
        );
        let lost = self.locks.lost();
        let mut remaining: Vec<Uuid> = self.accounts.keys().copied().collect();
        let batch_size = self.config.drain_batch.max(1) as usize;
        let mut released = 0u32;
        let mut timed_out = 0u32;
        while !remaining.is_empty() {
            let past_deadline = tokio::time::Instant::now() >= drain_end;
            let take = if past_deadline {
                remaining.len()
            } else {
                batch_size.min(remaining.len())
            };
            let batch: Vec<Uuid> = remaining.drain(..take).collect();
            let mut pending: HashSet<Uuid> = batch
                .iter()
                .copied()
                .filter(|account| self.accounts.contains_key(account))
                .collect();
            for account in &pending {
                if let Some(running) = self.accounts.get(account) {
                    if past_deadline {
                        running.stop.cancel();
                    } else {
                        running.release.cancel();
                    }
                }
            }
            let release_end =
                (tokio::time::Instant::now() + self.config.release_timeout).min(drain_end);
            // Set once the batch is stopped: when to abort what is still running.
            let mut abort_at =
                past_deadline.then(|| tokio::time::Instant::now() + self.config.stop_timeout);
            let mut aborted = false;
            while !pending.is_empty() {
                let step = tokio::select! {
                    biased;
                    () = lost.cancelled() => Err(LeaseError::Lost),
                    joined = self.tasks.join_next_with_id() => {
                        let Some(joined) = joined else { break };
                        let account = match &joined {
                            Ok((id, _)) => self.task_accounts.get(id).copied(),
                            Err(error) => self.task_accounts.get(&error.id()).copied(),
                        };
                        if let Some(account) = account {
                            pending.remove(&account);
                        }
                        let result = self.finished(joined, true).await;
                        if result.is_ok() {
                            released += 1;
                        }
                        result
                    }
                    () = tokio::time::sleep_until(release_end), if abort_at.is_none() => {
                        abort_at = Some(tokio::time::Instant::now() + self.config.stop_timeout);
                        timed_out += pending.len() as u32;
                        for account in &pending {
                            if let Some(running) = self.accounts.get(account) {
                                running.stop.cancel();
                            }
                        }
                        Ok(())
                    }
                    () = tokio::time::sleep_until(abort_at.unwrap_or(release_end)),
                        if abort_at.is_some() && !aborted =>
                    {
                        aborted = true;
                        tracing::error!(
                            parent: &span,
                            count = pending.len(),
                            "WhatsApp accounts did not stop in time; aborting them"
                        );
                        for account in &pending {
                            if let Some(running) = self.accounts.get(account) {
                                running.abort.abort();
                            }
                        }
                        Ok(())
                    }
                };
                match step {
                    Ok(()) => {}
                    Err(LeaseError::Lost) => {
                        span.record("released", released);
                        span.record("timed_out", timed_out);
                        self.stop_all().await;
                        return Err(SupervisorError::LocksLost);
                    }
                    Err(LeaseError::Internal(report)) => {
                        tracing::warn!(parent: &span, error = %report, "Releasing a WhatsApp account failed");
                    }
                }
            }
        }
        span.record("released", released);
        span.record("timed_out", timed_out);
        tracing::info!(
            parent: &span,
            telemetry_event = "whatsapp_session_drain",
            drain_duration_ms = started.elapsed().as_millis() as u64,
            accounts_released = released,
            accounts_timed_out = timed_out,
            "WhatsApp session drain finished"
        );
        Ok(())
    }

    /// The locks are gone: stop every account without another write.
    async fn stop_all(&mut self) {
        for running in self.accounts.values() {
            running.stop.cancel();
        }
        let count = self.accounts.len();
        if tokio::time::timeout(self.config.stop_timeout, async {
            while self.tasks.join_next().await.is_some() {}
        })
        .await
        .is_err()
        {
            tracing::error!(
                count,
                "WhatsApp accounts did not stop in time; aborting them"
            );
            self.tasks.shutdown().await;
        }
        self.accounts.clear();
        self.task_accounts.clear();
    }
}
