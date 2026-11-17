//! End-to-end tests of Slack Connect sync: real session-service replicas
//! (supervisor, advisory locks, account runners, `slack_client`) against
//! `slack_fake_server`, and DSS's use cases in-process, on one `#[sqlx::test]`
//! database. Nothing talks to Slack or AWS.

use std::future::Future;
use std::sync::Arc;
use std::time::Duration;

use kms_envelope::kms::FakeKms;
use slack_client::SlackEndpoints;
use slack_fake_server::FakeSlack;
use slack_session_service::replica::{self, ReplicaDeps, Timings};
use sqlx::postgres::{PgConnectOptions, PgListener, PgPool, PgPoolOptions};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

#[cfg(test)]
mod test;

/// Replica timings shortened to fit a test.
pub const TIMINGS: Timings = Timings {
    lock_keepalive: Duration::from_secs(1),
    rescan_every: Duration::from_secs(1),
    tick_every: Duration::from_secs(1),
    login_sweep_every: Duration::from_secs(1),
    release_timeout: Duration::from_secs(5),
    stop_timeout: Duration::from_secs(5),
    drain_deadline: Duration::from_secs(20),
    health_every: Duration::from_secs(60),
};

/// The fake's hosts as `slack_client` endpoints.
pub fn endpoints(slack: &FakeSlack) -> SlackEndpoints {
    let base = url::Url::parse(slack.base_url()).expect("the fake's base URL parses");
    SlackEndpoints {
        slack: base.clone(),
        app: base.clone(),
        edge_api: base,
        websocket: url::Url::parse(&slack.websocket_url())
            .expect("the fake's websocket URL parses"),
        user_agent: "slack_e2e".to_owned(),
    }
}

/// A running session-service replica on its own runtime.
pub struct Replica {
    runtime: Option<tokio::runtime::Runtime>,
    shutdown: CancellationToken,
}

impl Drop for Replica {
    fn drop(&mut self) {
        self.shutdown.cancel();
        if let Some(runtime) = self.runtime.take() {
            runtime.shutdown_background();
        }
    }
}

impl Replica {
    /// Starts a replica with the service's own `replica::start`.
    pub async fn start(
        database: &PgConnectOptions,
        slack: &FakeSlack,
        kms: Arc<FakeKms>,
    ) -> Replica {
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("a replica runtime starts");
        let shutdown = CancellationToken::new();
        let (ready, started) = oneshot::channel();
        let database = database.clone();
        let endpoints = endpoints(slack);
        let stop = shutdown.clone();
        runtime.spawn(async move {
            let started = async {
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
                        endpoints,
                        max_accounts: 10,
                        drain_batch: 5,
                        timings: TIMINGS,
                    },
                    stop,
                )
                .await
                .map_err(|error| error.to_string())
            }
            .await;
            match started {
                Ok(replica) => {
                    let _ = ready.send(Ok(()));
                    let _ = replica.wait().await;
                }
                Err(error) => {
                    let _ = ready.send(Err(error));
                }
            }
        });
        started
            .await
            .expect("the replica task reports its start")
            .expect("the replica starts");
        Replica {
            runtime: Some(runtime),
            shutdown,
        }
    }
}

const CHANGED_CHANNEL: &str = "e2e_changed";

/// Adds the statement triggers [`wait_for_rows`] wakes on.
pub async fn watch_tables(pool: &PgPool) {
    sqlx::raw_sql(include_str!("watch_tables.sql"))
        .execute(pool)
        .await
        .expect("the change triggers are created");
}

/// Waits until `check` finds something, re-running it after every write to
/// a watched table.
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
