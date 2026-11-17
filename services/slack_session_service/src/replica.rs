//! One replica: the signal listeners, the lock connection, the supervisor
//! over Slack account runners, and the sign-in worker. `main.rs` and the
//! end-to-end tests both start replicas with [`start`].

use std::sync::Arc;
use std::time::Duration;

use kms_envelope::kms::EnvelopeKms;
use session_fleet::listener::{ListenError, SIGNAL_CAPACITY, SignalListener};
use session_fleet::locks::{LockNamespace, PgAccountLocks};
use session_fleet::ports::LeaseError;
use session_fleet::supervisor::{FleetNames, Supervisor, SupervisorConfig, SupervisorError};
use slack_client::{SlackEndpoints, SlackError};
use slack_linked::domain::session::SessionService;
use slack_linked::outbound::pg::PgSlackRepository;
use sqlx::PgPool;
use sqlx::postgres::PgConnectOptions;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use tracing::Instrument;

use crate::domain::account::{AccountConfig, SlackAccounts};
use crate::domain::login::Logins;
use crate::outbound::directory::PgAccountDirectory;
use crate::outbound::secrets::KmsSecrets;
use crate::outbound::signals;
use crate::outbound::slack::SlackApi;

/// Every timing a replica uses.
#[derive(Debug, Clone, Copy)]
pub struct Timings {
    /// Ping interval of the lock connection.
    pub lock_keepalive: Duration,
    /// How often to look for free accounts without a signal.
    pub rescan_every: Duration,
    /// How often an account retries deferred changes and looks for missed work.
    pub tick_every: Duration,
    /// How often to look for sign-ins whose signal was missed.
    pub login_sweep_every: Duration,
    /// How long a released account may take to finish.
    pub release_timeout: Duration,
    /// How long a stopped account may take to return.
    pub stop_timeout: Duration,
    /// Longest the whole drain may take.
    pub drain_deadline: Duration,
    /// How often to report fleet health.
    pub health_every: Duration,
}

impl Timings {
    /// Production timings; the drain fits Fargate's 120 s stop timeout.
    pub fn production() -> Self {
        Timings {
            lock_keepalive: Duration::from_secs(5),
            rescan_every: Duration::from_secs(30),
            tick_every: Duration::from_secs(30),
            login_sweep_every: Duration::from_secs(10),
            release_timeout: Duration::from_secs(35),
            stop_timeout: Duration::from_secs(10),
            drain_deadline: Duration::from_secs(100),
            health_every: Duration::from_secs(60),
        }
    }
}

/// What a replica is built from.
pub struct ReplicaDeps<Kms> {
    /// Pooled MacroDB connections.
    pub pool: PgPool,
    /// Direct MacroDB connection options for the locks and `LISTEN`.
    pub lock_options: PgConnectOptions,
    /// Seals and opens Slack secrets.
    pub kms: Kms,
    /// Slack's hosts (production, or a fake's).
    pub endpoints: SlackEndpoints,
    /// Most accounts this replica runs.
    pub max_accounts: u32,
    /// Accounts released per drain step.
    pub drain_batch: u32,
    /// Timings.
    pub timings: Timings,
}

/// Errors starting or running a replica.
#[derive(Debug, thiserror::Error)]
pub enum ReplicaError {
    /// Subscribing to signals failed.
    #[error(transparent)]
    Listen(#[from] ListenError),
    /// Subscribing to sign-in signals failed.
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    /// Opening the lock connection failed.
    #[error(transparent)]
    Lease(#[from] LeaseError),
    /// Building the Slack client failed.
    #[error(transparent)]
    Slack(#[from] SlackError),
    /// The supervisor stopped early.
    #[error(transparent)]
    Supervisor(#[from] SupervisorError),
    /// The supervisor task panicked.
    #[error("the replica task panicked")]
    Panicked,
}

/// A running replica.
pub struct Replica {
    lock_backend_pid: i32,
    running: JoinHandle<Result<(), SupervisorError>>,
}

impl Replica {
    /// The Postgres backend of the lock connection.
    pub fn lock_backend_pid(&self) -> i32 {
        self.lock_backend_pid
    }

    /// Waits until the replica drained after `shutdown`, or failed.
    pub async fn wait(self) -> Result<(), ReplicaError> {
        self.running.await.map_err(|_| ReplicaError::Panicked)??;
        Ok(())
    }
}

/// Connects the replica and starts supervising; drains when `shutdown` is
/// cancelled.
pub async fn start<Kms: EnvelopeKms + 'static>(
    deps: ReplicaDeps<Kms>,
    shutdown: CancellationToken,
) -> Result<Replica, ReplicaError> {
    let timings = deps.timings;
    let tracker = TaskTracker::new();
    let listener_stop = CancellationToken::new();
    let listener = SignalListener::connect(&deps.lock_options, signals::channels()).await?;
    let (signal_sender, mut fleet_signals) = mpsc::channel(SIGNAL_CAPACITY);
    tracker.spawn(listener.run(signal_sender, listener_stop.clone()));
    let mut login_requests =
        signals::listen_logins(&deps.lock_options, listener_stop.clone()).await?;
    let locks = PgAccountLocks::connect(
        &deps.lock_options,
        LockNamespace("slack-account:"),
        timings.lock_keepalive,
        &tracker,
    )
    .await?;
    let lock_backend_pid = locks.backend_pid();

    let sessions = SessionService::new(Arc::new(PgSlackRepository::new(deps.pool.clone())));
    let sign_in_page = deps.endpoints.sign_in_page().to_string();
    let connector = Arc::new(SlackApi::new(deps.endpoints, tracker.clone())?);
    let secrets = Arc::new(KmsSecrets::new(deps.kms));
    let logins = Logins::new(
        sessions.clone(),
        connector.clone(),
        secrets.clone(),
        sign_in_page,
    );
    tracker.spawn({
        let stop = listener_stop.clone();
        let sessions = sessions.clone();
        async move {
            let mut sweep = tokio::time::interval(timings.login_sweep_every);
            loop {
                tokio::select! {
                    () = stop.cancelled() => return,
                    request = login_requests.recv() => match request {
                        Some(Some(request)) => {
                            let span = request.span.clone();
                            logins.process(request.attempt).instrument(span).await;
                        }
                        Some(None) => sweep.reset_immediately(),
                        None => return,
                    },
                    _ = sweep.tick() => match sessions.waiting_logins(20).await {
                        Ok(waiting) => {
                            for attempt in waiting {
                                logins.process(attempt).await;
                            }
                        }
                        Err(report) => tracing::warn!(error = %report, "Looking for Slack sign-ins failed"),
                    },
                }
            }
        }
    });
    let runner = SlackAccounts::new(
        sessions.clone(),
        connector,
        secrets,
        AccountConfig {
            tick_every: timings.tick_every,
            send_batch: 16,
        },
    );
    let supervisor = Supervisor::new(
        locks,
        PgAccountDirectory::new(sessions),
        Arc::new(runner),
        SupervisorConfig {
            max_accounts: deps.max_accounts,
            drain_batch: deps.drain_batch,
            rescan_every: timings.rescan_every,
            release_timeout: timings.release_timeout,
            stop_timeout: timings.stop_timeout,
            drain_deadline: timings.drain_deadline,
            health_every: timings.health_every,
            names: FleetNames {
                fleet: "slack",
                health_event: "slack_session_health",
                drain_event: "slack_session_drain",
            },
        },
    );
    let running = tokio::spawn(async move {
        let result = supervisor.run(&mut fleet_signals, shutdown).await;
        listener_stop.cancel();
        tracker.close();
        tracker.wait().await;
        result
    });
    Ok(Replica {
        lock_backend_pid,
        running,
    })
}
