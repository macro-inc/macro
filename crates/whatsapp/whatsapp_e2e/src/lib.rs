//! End-to-end tests of WhatsApp linked devices.
//!
//! The tests run the real session service (supervisor, advisory locks,
//! account runners, whatsmeow clients, the Postgres device store) against a
//! [`whatsapp_fake_server::FakeWhatsApp`], and drive the DSS side through the
//! linked-devices domain service, all on one test database.
//!
//! Each [`Replica`] runs on its own Tokio runtime, like a separate process:
//! [`Replica::kill`] drops every task and socket at once (the lock connection
//! closes, so Postgres frees its advisory locks), and [`Replica::drain`] is
//! what SIGTERM does.

#![deny(missing_docs)]
// The account runner future nests the domain, store and client futures.
#![recursion_limit = "256"]

#[cfg(test)]
mod test;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use sqlx::postgres::{PgConnectOptions, PgListener, PgPool, PgPoolOptions};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;
use whatsapp_fake_server::{FakeWhatsApp, test_signal};
use whatsapp_session_service::replica::{self, ReplicaDeps, Timings};
use whatsapp_store_pg::kms::{FakeWhatsAppKms, GeneratedDataKey, WhatsAppKms, WhatsAppKmsError};
use whatsmeow::{Dialer, WebSocketDialer};
use zeroize::Zeroizing;

/// How long a submitted send waits for the server's ack before it is
/// recorded as unknown. Short, so the unknown path runs within a test.
pub const SEND_TIMEOUT: Duration = Duration::from_secs(5);

/// Replica timings shortened so takeovers and timeouts happen within a test.
pub const TIMINGS: Timings = Timings {
    lock_keepalive: Duration::from_secs(1),
    send_timeout: SEND_TIMEOUT,
    rescan_every: Duration::from_secs(1),
    tick_every: Duration::from_secs(1),
    release_timeout: Duration::from_secs(7),
    stop_timeout: Duration::from_secs(5),
    drain_deadline: Duration::from_secs(30),
    health_every: Duration::from_secs(60),
    groups_refresh_interval: Duration::ZERO,
    backfill_timeout: Duration::from_secs(3),
};

/// One fake KMS shared by every replica, as they share the real KMS key.
#[derive(Clone)]
pub struct SharedKms(pub Arc<FakeWhatsAppKms>);

impl SharedKms {
    /// A fresh fake KMS.
    pub fn new() -> SharedKms {
        SharedKms(Arc::new(FakeWhatsAppKms::new("e2e-kms-key")))
    }
}

impl Default for SharedKms {
    fn default() -> Self {
        SharedKms::new()
    }
}

impl WhatsAppKms for SharedKms {
    async fn generate_data_key(
        &self,
        encryption_context: HashMap<String, String>,
    ) -> Result<GeneratedDataKey, WhatsAppKmsError> {
        self.0.generate_data_key(encryption_context).await
    }

    async fn decrypt(
        &self,
        kms_key_id: &str,
        ciphertext: &[u8],
        encryption_context: HashMap<String, String>,
    ) -> Result<Zeroizing<Vec<u8>>, WhatsAppKmsError> {
        self.0
            .decrypt(kms_key_id, ciphertext, encryption_context)
            .await
    }
}

/// A running session-service replica.
pub struct Replica {
    runtime: Option<tokio::runtime::Runtime>,
    shutdown: CancellationToken,
    finished: Option<oneshot::Receiver<Result<(), String>>>,
    /// The Postgres backend of the replica's lock connection.
    pub lock_backend_pid: i32,
}

impl Drop for Replica {
    fn drop(&mut self) {
        if let Some(runtime) = self.runtime.take() {
            runtime.shutdown_background();
        }
    }
}

impl Replica {
    /// Starts a replica against the test database and the fake server, the
    /// with the service's own `replica::start`.
    pub async fn start(
        database: &PgConnectOptions,
        whatsapp: &FakeWhatsApp,
        kms: &SharedKms,
    ) -> Replica {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("a replica runtime starts");
        let shutdown = CancellationToken::new();
        let (ready, started) = oneshot::channel();
        let (done, finished) = oneshot::channel();
        let database = database.clone();
        let dialer: Arc<dyn Dialer> = Arc::new(WebSocketDialer {
            url: whatsapp.websocket_url(),
        });
        let media_base_url = whatsapp.media_base_url();
        let kms = kms.clone();
        let stop = shutdown.clone();
        runtime.spawn(async move {
            let result = run_replica(database, dialer, media_base_url, kms, stop, ready).await;
            let _ = done.send(result);
        });
        let lock_backend_pid = started
            .await
            .expect("the replica reports startup")
            .expect("the replica starts");
        Replica {
            runtime: Some(runtime),
            shutdown,
            finished: Some(finished),
            lock_backend_pid,
        }
    }

    /// SIGTERM: drain every account and wait for the supervisor to return.
    pub async fn drain(mut self, timeout: Duration) -> Result<(), String> {
        self.shutdown.cancel();
        let finished = self.finished.take().expect("a replica drains once");
        let result = tokio::time::timeout(timeout, finished)
            .await
            .map_err(|_| "the replica did not finish draining".to_owned())?
            .map_err(|_| "the replica task died".to_owned())?;
        if let Some(runtime) = self.runtime.take() {
            runtime.shutdown_background();
        }
        result
    }

    /// Process death: every task, websocket and database connection of the
    /// replica goes away at once.
    pub fn kill(mut self) {
        if let Some(runtime) = self.runtime.take() {
            runtime.shutdown_background();
        }
    }
}

async fn run_replica(
    database: PgConnectOptions,
    dialer: Arc<dyn Dialer>,
    media_base_url: String,
    kms: SharedKms,
    shutdown: CancellationToken,
    ready: oneshot::Sender<Result<i32, String>>,
) -> Result<(), String> {
    let started = async {
        // CI runs these beside the whole workspace's database tests on one
        // Postgres (max_connections = 100); two accounts need only a few.
        let pool = PgPoolOptions::new()
            .max_connections(4)
            .connect_with(database.clone())
            .await
            .map_err(|error| error.to_string())?;
        replica::start(
            ReplicaDeps {
                pool,
                lock_options: database,
                kms,
                signal: test_signal(),
                dialer,
                media_base_url: Some(media_base_url),
                max_accounts: 50,
                drain_batch: 20,
                timings: TIMINGS,
            },
            shutdown,
        )
        .await
        .map_err(|error| error.to_string())
    }
    .await;
    let running = match started {
        Ok(running) => {
            let _ = ready.send(Ok(running.lock_backend_pid()));
            running
        }
        Err(error) => {
            let _ = ready.send(Err(error.clone()));
            return Err(error);
        }
    };
    running.wait().await.map_err(|error| error.to_string())
}

/// The channel the test triggers notify on.
const CHANGED_CHANNEL: &str = "e2e_changed";

/// Makes the linked-device tables `NOTIFY e2e_changed` on every write, so
/// tests can wait for rows the service writes without polling. Test
/// databases only.
pub async fn watch_tables(pool: &PgPool) {
    sqlx::raw_sql(include_str!("watch_tables.sql"))
        .execute(pool)
        .await
        .expect("the change triggers are created");
}

/// Waits until `check` finds something, re-running it after every write to
/// a watched table (see [`watch_tables`]).
pub async fn wait_for_rows<Found, Check, Checking>(
    pool: &PgPool,
    timeout: Duration,
    check: Check,
) -> Option<Found>
where
    Check: Fn() -> Checking,
    Checking: Future<Output = Option<Found>>,
{
    let mut listener = PgListener::connect_with(pool)
        .await
        .expect("a change listener connects");
    listener
        .listen(CHANGED_CHANNEL)
        .await
        .expect("the change listener subscribes");
    let wait = async {
        loop {
            if let Some(found) = check().await {
                return found;
            }
            listener.recv().await.expect("the change listener stays up");
        }
    };
    tokio::time::timeout(timeout, wait).await.ok()
}
