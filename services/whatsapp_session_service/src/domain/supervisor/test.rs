use std::collections::HashSet;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use super::{Signal, Supervisor, SupervisorConfig, SupervisorError};
use crate::domain::ports::{
    AccountControl, AccountDirectory, AccountExit, AccountLocks, AccountRunner, AccountSignal,
    FleetHealth, LeaseError, Traced,
};

/// Locks shared by every fake replica, like advisory locks on one server.
#[derive(Clone, Default)]
struct FakeLocks {
    held: Arc<Mutex<HashSet<Uuid>>>,
    lost: CancellationToken,
}

impl AccountLocks for FakeLocks {
    async fn try_lock(&self, account: Uuid) -> Result<bool, LeaseError> {
        Ok(self.held.lock().unwrap().insert(account))
    }

    async fn unlock(&self, account: Uuid) -> Result<(), LeaseError> {
        self.held.lock().unwrap().remove(&account);
        Ok(())
    }

    fn lost(&self) -> CancellationToken {
        self.lost.clone()
    }
}

struct FakeDirectory {
    candidates: Vec<Uuid>,
    announced: mpsc::UnboundedSender<Uuid>,
}

impl AccountDirectory for FakeDirectory {
    async fn candidates(&self, limit: u32) -> Result<Vec<Uuid>, LeaseError> {
        Ok(self
            .candidates
            .iter()
            .copied()
            .take(limit as usize)
            .collect())
    }

    async fn pairing_account(&self, _pairing: Uuid) -> Result<Option<Uuid>, LeaseError> {
        Ok(None)
    }

    async fn announce_released(&self, account: Uuid) -> Result<(), LeaseError> {
        self.announced.send(account).unwrap();
        Ok(())
    }

    async fn health(&self) -> Result<FleetHealth, LeaseError> {
        Ok(FleetHealth {
            accounts_unowned: 0,
            oldest_unprocessed_inbound_seconds: 0,
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RunnerEvent {
    Started(Uuid),
    Signal(Uuid, AccountSignal),
    Released(Uuid),
    Stopped(Uuid),
}

/// Runs until released or stopped. With `ignore_release`, only a stop ends
/// it, like an account whose in-flight send never gets an acknowledgement;
/// with `ignore_stop` too, nothing does, like a runner stuck in a send.
struct FakeRunner {
    events: mpsc::UnboundedSender<RunnerEvent>,
    ignore_release: bool,
    ignore_stop: bool,
}

impl AccountRunner for FakeRunner {
    async fn run(&self, account: Uuid, mut control: AccountControl) -> AccountExit {
        self.events.send(RunnerEvent::Started(account)).unwrap();
        loop {
            tokio::select! {
                () = control.stop.cancelled(), if !self.ignore_stop => {
                    self.events.send(RunnerEvent::Stopped(account)).unwrap();
                    return AccountExit::Stopped;
                }
                () = control.release.cancelled(), if !self.ignore_release => {
                    self.events.send(RunnerEvent::Released(account)).unwrap();
                    return AccountExit::Released;
                }
                Some(signal) = control.signals.recv() => {
                    self.events.send(RunnerEvent::Signal(account, signal.signal)).unwrap();
                }
            }
        }
    }
}

const CONFIG: SupervisorConfig = SupervisorConfig {
    max_accounts: 2,
    drain_batch: 1,
    rescan_every: Duration::from_secs(30),
    release_timeout: Duration::from_secs(10),
    stop_timeout: Duration::from_secs(5),
    drain_deadline: Duration::from_secs(100),
    health_every: Duration::from_secs(60),
};

#[tokio::test(start_paused = true)]
async fn takes_free_accounts_up_to_its_cap_and_forwards_their_signals() {
    let first = Uuid::from_u128(1);
    let second = Uuid::from_u128(2);
    let third = Uuid::from_u128(3);
    let locks = FakeLocks::default();
    let (announced, _announcements) = mpsc::unbounded_channel();
    let (events, mut runner_events) = mpsc::unbounded_channel();
    let supervisor = Supervisor::new(
        locks.clone(),
        FakeDirectory {
            candidates: vec![first, second, third],
            announced,
        },
        Arc::new(FakeRunner {
            events,
            ignore_release: false,
            ignore_stop: false,
        }),
        CONFIG,
    );
    let (signals, mut receiver) = mpsc::channel(8);
    let shutdown = CancellationToken::new();
    let stop = shutdown.clone();
    let running = tokio::spawn(async move { supervisor.run(&mut receiver, stop).await });

    assert_eq!(
        runner_events.recv().await,
        Some(RunnerEvent::Started(first))
    );
    assert_eq!(
        runner_events.recv().await,
        Some(RunnerEvent::Started(second))
    );
    signals
        .send(Signal::SendRequested(second).into())
        .await
        .unwrap();
    signals
        .send(Signal::SendRequested(third).into())
        .await
        .unwrap();
    signals
        .send(Signal::GroupsRequested(first).into())
        .await
        .unwrap();
    assert_eq!(
        runner_events.recv().await,
        Some(RunnerEvent::Signal(second, AccountSignal::Send))
    );
    assert_eq!(
        runner_events.recv().await,
        Some(RunnerEvent::Signal(first, AccountSignal::Groups))
    );
    assert_eq!(
        *locks.held.lock().unwrap(),
        HashSet::from([first, second]),
        "the third account stays free for another replica"
    );

    shutdown.cancel();
    running.await.unwrap().unwrap();
}

/// Reports that it started, then each signal with the id of the span it
/// arrived in.
struct SpanRunner {
    started: mpsc::UnboundedSender<Uuid>,
    signals: mpsc::UnboundedSender<(AccountSignal, Option<tracing::span::Id>)>,
}

impl AccountRunner for SpanRunner {
    async fn run(&self, account: Uuid, mut control: AccountControl) -> AccountExit {
        self.started.send(account).unwrap();
        loop {
            tokio::select! {
                () = control.stop.cancelled() => return AccountExit::Stopped,
                () = control.release.cancelled() => return AccountExit::Released,
                Some(Traced { signal, span }) = control.signals.recv() => {
                    self.signals.send((signal, span.id())).unwrap();
                }
            }
        }
    }
}

#[tokio::test(start_paused = true)]
async fn a_forwarded_signal_carries_the_span_of_its_notification() {
    let _subscriber = tracing::subscriber::set_default(tracing_subscriber::registry());
    let account = Uuid::from_u128(1);
    let (announced, _announcements) = mpsc::unbounded_channel();
    let (reported, mut received) = mpsc::unbounded_channel();
    let (started, mut starts) = mpsc::unbounded_channel();
    let supervisor = Supervisor::new(
        FakeLocks::default(),
        FakeDirectory {
            candidates: vec![account],
            announced,
        },
        Arc::new(SpanRunner {
            started,
            signals: reported,
        }),
        CONFIG,
    );
    let (signals, mut receiver) = mpsc::channel(8);
    let shutdown = CancellationToken::new();
    let stop = shutdown.clone();
    let running = tokio::spawn(async move { supervisor.run(&mut receiver, stop).await });
    assert_eq!(starts.recv().await, Some(account));

    let notification = tracing::info_span!("whatsapp.signal.receive");
    signals
        .send(Traced {
            signal: Signal::SendRequested(account),
            span: notification.clone(),
        })
        .await
        .unwrap();

    assert_eq!(
        received.recv().await,
        Some((AccountSignal::Send, notification.id()))
    );
    assert!(notification.id().is_some());
    shutdown.cancel();
    running.await.unwrap().unwrap();
}

#[tokio::test(start_paused = true)]
async fn drain_releases_every_account_then_unlocks_and_announces_it() {
    let first = Uuid::from_u128(1);
    let second = Uuid::from_u128(2);
    let locks = FakeLocks::default();
    let (announced, mut announcements) = mpsc::unbounded_channel();
    let (events, mut runner_events) = mpsc::unbounded_channel();
    let supervisor = Supervisor::new(
        locks.clone(),
        FakeDirectory {
            candidates: vec![first, second],
            announced,
        },
        Arc::new(FakeRunner {
            events,
            ignore_release: false,
            ignore_stop: false,
        }),
        CONFIG,
    );
    let (_signals, mut receiver) = mpsc::channel(8);
    let shutdown = CancellationToken::new();
    let stop = shutdown.clone();
    let running = tokio::spawn(async move { supervisor.run(&mut receiver, stop).await });
    assert_eq!(
        runner_events.recv().await,
        Some(RunnerEvent::Started(first))
    );
    assert_eq!(
        runner_events.recv().await,
        Some(RunnerEvent::Started(second))
    );

    shutdown.cancel();
    running.await.unwrap().unwrap();

    let mut released = vec![runner_events.recv().await, runner_events.recv().await];
    released.sort_by_key(|event| format!("{event:?}"));
    assert_eq!(
        released,
        vec![
            Some(RunnerEvent::Released(first)),
            Some(RunnerEvent::Released(second))
        ]
    );
    let mut announced = vec![announcements.recv().await, announcements.recv().await];
    announced.sort();
    assert_eq!(announced, vec![Some(first), Some(second)]);
    assert!(locks.held.lock().unwrap().is_empty());
}

#[tokio::test(start_paused = true)]
async fn drain_stops_an_account_that_does_not_release_in_time_and_still_announces_it() {
    let account = Uuid::from_u128(1);
    let locks = FakeLocks::default();
    let (announced, mut announcements) = mpsc::unbounded_channel();
    let (events, mut runner_events) = mpsc::unbounded_channel();
    let supervisor = Supervisor::new(
        locks.clone(),
        FakeDirectory {
            candidates: vec![account],
            announced,
        },
        Arc::new(FakeRunner {
            events,
            ignore_release: true,
            ignore_stop: false,
        }),
        CONFIG,
    );
    let (_signals, mut receiver) = mpsc::channel(8);
    let shutdown = CancellationToken::new();
    let stop = shutdown.clone();
    let running = tokio::spawn(async move { supervisor.run(&mut receiver, stop).await });
    assert_eq!(
        runner_events.recv().await,
        Some(RunnerEvent::Started(account))
    );

    shutdown.cancel();
    running.await.unwrap().unwrap();

    assert_eq!(
        runner_events.recv().await,
        Some(RunnerEvent::Stopped(account))
    );
    assert_eq!(announcements.recv().await, Some(account));
    assert!(locks.held.lock().unwrap().is_empty());
}

#[tokio::test(start_paused = true)]
async fn drain_aborts_an_account_that_ignores_its_stop_and_still_announces_it() {
    let account = Uuid::from_u128(1);
    let locks = FakeLocks::default();
    let (announced, mut announcements) = mpsc::unbounded_channel();
    let (events, mut runner_events) = mpsc::unbounded_channel();
    let supervisor = Supervisor::new(
        locks.clone(),
        FakeDirectory {
            candidates: vec![account],
            announced,
        },
        Arc::new(FakeRunner {
            events,
            ignore_release: true,
            ignore_stop: true,
        }),
        CONFIG,
    );
    let (_signals, mut receiver) = mpsc::channel(8);
    let shutdown = CancellationToken::new();
    let stop = shutdown.clone();
    let running = tokio::spawn(async move { supervisor.run(&mut receiver, stop).await });
    assert_eq!(
        runner_events.recv().await,
        Some(RunnerEvent::Started(account))
    );

    let started = tokio::time::Instant::now();
    shutdown.cancel();
    running.await.unwrap().unwrap();

    assert_eq!(
        started.elapsed(),
        CONFIG.release_timeout + CONFIG.stop_timeout
    );
    assert_eq!(announcements.recv().await, Some(account));
    assert!(locks.held.lock().unwrap().is_empty());
}

#[tokio::test(start_paused = true)]
async fn losing_the_locks_stops_every_account_without_unlocking_or_announcing() {
    let first = Uuid::from_u128(1);
    let second = Uuid::from_u128(2);
    let locks = FakeLocks::default();
    let (announced, mut announcements) = mpsc::unbounded_channel();
    let (events, mut runner_events) = mpsc::unbounded_channel();
    let supervisor = Supervisor::new(
        locks.clone(),
        FakeDirectory {
            candidates: vec![first, second],
            announced,
        },
        Arc::new(FakeRunner {
            events,
            ignore_release: false,
            ignore_stop: false,
        }),
        CONFIG,
    );
    let (_signals, mut receiver) = mpsc::channel(8);
    let running = tokio::spawn(async move {
        supervisor
            .run(&mut receiver, CancellationToken::new())
            .await
    });
    assert_eq!(
        runner_events.recv().await,
        Some(RunnerEvent::Started(first))
    );
    assert_eq!(
        runner_events.recv().await,
        Some(RunnerEvent::Started(second))
    );

    locks.lost.cancel();

    assert!(matches!(
        running.await.unwrap(),
        Err(SupervisorError::LocksLost)
    ));
    let mut stopped = vec![runner_events.recv().await, runner_events.recv().await];
    stopped.sort_by_key(|event| format!("{event:?}"));
    assert_eq!(
        stopped,
        vec![
            Some(RunnerEvent::Stopped(first)),
            Some(RunnerEvent::Stopped(second))
        ]
    );
    assert!(announcements.try_recv().is_err());
    assert_eq!(
        *locks.held.lock().unwrap(),
        HashSet::from([first, second]),
        "a lost connection's locks are freed by Postgres, not unlocked"
    );
}
