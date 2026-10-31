//! One replica's composition: the lock and `LISTEN` connections, the
//! supervisor and the account runner. The binary and end-to-end tests both
//! start replicas through [`start`], injecting WhatsApp, Signal and KMS.

use std::sync::Arc;
use std::time::Duration;

use sqlx::PgPool;
use sqlx::postgres::PgConnectOptions;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use whatsapp_linked::domain::session::SessionService;
use whatsapp_linked::outbound::pg::PgWhatsAppRepository;
use whatsapp_store_pg::kms::WhatsAppKms;
use whatsmeow::{Dialer, Signal};

use crate::domain::account::{
    AccountConfig, AccountSessions, BACKFILL_TIMEOUT, GROUPS_REFRESH_INTERVAL,
};
use crate::domain::ports::LeaseError;
use crate::domain::supervisor::{Supervisor, SupervisorConfig, SupervisorError};
use crate::outbound::lease::{PgAccountDirectory, PgAccountLocks};
use crate::outbound::signals::{ListenError, SIGNAL_CAPACITY, SignalListener};
use crate::outbound::whatsapp::WhatsmeowConnector;

/// Every timing a replica uses.
#[derive(Debug, Clone, Copy)]
pub struct Timings {
    /// Ping interval of the lock connection; a dead one is noticed within it.
    pub lock_keepalive: Duration,
    /// A submitted send without an acknowledgement after this is unknown.
    pub send_timeout: Duration,
    /// How often to look for free accounts without a signal.
    pub rescan_every: Duration,
    /// How often an account looks for sends, deferred events and pairing
    /// expiry without a signal.
    pub tick_every: Duration,
    /// How long a released account may take to finish in-flight sends.
    pub release_timeout: Duration,
    /// How long a stopped account may take to return.
    pub stop_timeout: Duration,
    /// Longest the whole drain may take.
    pub drain_deadline: Duration,
    /// How often to report fleet health.
    pub health_every: Duration,
    /// Least time between requested group refreshes of one account.
    pub groups_refresh_interval: Duration,
    /// A history page request the phone has not answered after this waits
    /// for the owner to start it again.
    pub backfill_timeout: Duration,
}

impl Timings {
    /// Production timings. The drain fits Fargate's 120 s stop timeout with
    /// room to flush telemetry.
    pub fn production() -> Self {
        let send_timeout = Duration::from_secs(30);
        Timings {
            lock_keepalive: Duration::from_secs(5),
            send_timeout,
            rescan_every: Duration::from_secs(30),
            tick_every: Duration::from_secs(30),
            release_timeout: send_timeout + Duration::from_secs(5),
            stop_timeout: Duration::from_secs(10),
            drain_deadline: Duration::from_secs(100),
            health_every: Duration::from_secs(60),
            groups_refresh_interval: GROUPS_REFRESH_INTERVAL,
            backfill_timeout: BACKFILL_TIMEOUT,
        }
    }
}

/// What a replica is built from.
pub struct ReplicaDeps<Kms> {
    /// Pooled MacroDB connections for reads and fenced writes.
    pub pool: PgPool,
    /// Direct (non-pooled) MacroDB connection options for the advisory locks
    /// and `LISTEN`.
    pub lock_options: PgConnectOptions,
    /// Wraps and unwraps account data keys.
    pub kms: Kms,
    /// The Signal implementation for every client.
    pub signal: Arc<dyn Signal>,
    /// Opens WhatsApp websockets.
    pub dialer: Arc<dyn Dialer>,
    /// Sends media transfers to one `scheme://host[:port]` instead of
    /// WhatsApp's media hosts (tests only).
    pub media_base_url: Option<String>,
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
    /// Opening the lock connection failed.
    #[error(transparent)]
    Lease(#[from] LeaseError),
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
    /// The Postgres backend of the lock connection; terminating it takes
    /// every lock from this replica.
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
pub async fn start<Kms: WhatsAppKms + 'static>(
    deps: ReplicaDeps<Kms>,
    shutdown: CancellationToken,
) -> Result<Replica, ReplicaError> {
    let timings = deps.timings;
    let tracker = TaskTracker::new();
    let listener_stop = CancellationToken::new();
    let listener = SignalListener::connect(&deps.lock_options).await?;
    let (signal_sender, mut signals) = mpsc::channel(SIGNAL_CAPACITY);
    tracker.spawn(listener.run(signal_sender, listener_stop.clone()));
    let locks =
        PgAccountLocks::connect(&deps.lock_options, timings.lock_keepalive, &tracker).await?;
    let lock_backend_pid = locks.backend_pid();

    let sessions = SessionService::new(Arc::new(PgWhatsAppRepository::new(deps.pool.clone())));
    let runner = AccountSessions::new(
        sessions.clone(),
        WhatsmeowConnector::new(
            deps.pool.clone(),
            deps.kms,
            deps.signal,
            deps.dialer,
            deps.media_base_url,
            timings.send_timeout,
        ),
        AccountConfig {
            send_timeout: timings.send_timeout,
            send_batch: 16,
            tick_every: timings.tick_every,
            groups_refresh_interval: timings.groups_refresh_interval,
            backfill_timeout: timings.backfill_timeout,
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
        },
    );
    let running = tokio::spawn(async move {
        let result = supervisor.run(&mut signals, shutdown).await;
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
