//! Account ownership in Postgres: session-level advisory locks on one
//! dedicated connection, candidate discovery, and release announcements.
//!
//! The lock key of an account is `hashtext('whatsapp-account:' || id)`. Locks
//! live as long as the lock connection: if it dies, Postgres frees them and
//! [`PgAccountLocks::lost`] fires so every account on this replica stops.
//! Fencing (`whatsapp_linked_account.lease_epoch`) is the domain's job; a lock
//! only decides who may bump the epoch.

use std::time::Duration;

use sqlx::postgres::{PgConnectOptions, PgPool};
use sqlx::{ConnectOptions, Connection, PgConnection};
use tokio::sync::{mpsc, oneshot};
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use uuid::Uuid;

use whatsapp_linked::domain::models::LinkedError;
use whatsapp_linked::domain::session::SessionService;

use crate::domain::ports::{AccountDirectory, AccountLocks, FleetHealth, LeaseError};
use crate::domain::supervisor::ACCOUNT_RELEASED;

#[cfg(test)]
mod test;

/// Server-side TCP keepalive settings for the lock connection, so Postgres
/// frees a dead replica's locks within about 25 seconds.
const SERVER_KEEPALIVES: [(&str, &str); 3] = [
    ("tcp_keepalives_idle", "10"),
    ("tcp_keepalives_interval", "5"),
    ("tcp_keepalives_count", "3"),
];

impl From<sqlx::Error> for LeaseError {
    fn from(error: sqlx::Error) -> Self {
        LeaseError::Internal(rootcause::Report::new(error).into_dynamic())
    }
}

enum Command {
    TryLock(Uuid, oneshot::Sender<Result<bool, sqlx::Error>>),
    Unlock(Uuid, oneshot::Sender<Result<bool, sqlx::Error>>),
}

/// Advisory locks held on one dedicated, non-pooled connection.
///
/// The connection is owned by one task; dropping every handle closes it,
/// which releases any lock still held.
#[derive(Clone)]
pub struct PgAccountLocks {
    commands: mpsc::Sender<Command>,
    lost: CancellationToken,
    backend_pid: i32,
}

impl PgAccountLocks {
    /// Opens the lock connection. Every `keepalive` it pings the server; a ping
    /// or lock call that fails or takes longer than `keepalive` counts as a
    /// lost connection.
    pub async fn connect(
        options: &PgConnectOptions,
        keepalive: Duration,
        tracker: &TaskTracker,
    ) -> Result<Self, LeaseError> {
        let mut connection = options.clone().options(SERVER_KEEPALIVES).connect().await?;
        let backend_pid: i32 = sqlx::query_scalar!(r#"SELECT pg_backend_pid() AS "pid!""#)
            .fetch_one(&mut connection)
            .await?;
        let (commands, receiver) = mpsc::channel(64);
        let lost = CancellationToken::new();
        tracker.spawn(hold(connection, receiver, keepalive, lost.clone()));
        Ok(PgAccountLocks {
            commands,
            lost,
            backend_pid,
        })
    }

    /// The server process of the lock connection, for operators and tests.
    pub fn backend_pid(&self) -> i32 {
        self.backend_pid
    }

    async fn call(
        &self,
        command: impl FnOnce(oneshot::Sender<Result<bool, sqlx::Error>>) -> Command,
    ) -> Result<bool, LeaseError> {
        let (reply, response) = oneshot::channel();
        self.commands
            .send(command(reply))
            .await
            .map_err(|_| LeaseError::Lost)?;
        match response.await {
            Ok(Ok(value)) => Ok(value),
            Ok(Err(_)) | Err(_) => Err(LeaseError::Lost),
        }
    }
}

/// Owns the lock connection until it fails or every handle is dropped.
async fn hold(
    mut connection: PgConnection,
    mut commands: mpsc::Receiver<Command>,
    keepalive: Duration,
    lost: CancellationToken,
) {
    let mut ping = tokio::time::interval(keepalive);
    ping.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        let healthy = tokio::select! {
            command = commands.recv() => match command {
                Some(Command::TryLock(account, reply)) => {
                    let result = bounded(keepalive, try_lock(&mut connection, account)).await;
                    let healthy = result.is_ok();
                    let _ = reply.send(result);
                    healthy
                }
                Some(Command::Unlock(account, reply)) => {
                    let result = bounded(keepalive, unlock(&mut connection, account)).await;
                    let healthy = result.is_ok();
                    let _ = reply.send(result);
                    healthy
                }
                None => {
                    // Closing releases every lock this connection holds.
                    if let Err(error) = connection.close().await {
                        tracing::warn!(error = ?error, "Closing the WhatsApp lock connection failed");
                    }
                    return;
                }
            },
            _ = ping.tick() => bounded(keepalive, connection.ping()).await.is_ok(),
        };
        if !healthy {
            tracing::error!("WhatsApp account lock connection lost; stopping every account");
            lost.cancel();
            return;
        }
    }
}

async fn bounded<Value>(
    limit: Duration,
    operation: impl Future<Output = Result<Value, sqlx::Error>>,
) -> Result<Value, sqlx::Error> {
    tokio::time::timeout(limit, operation)
        .await
        .unwrap_or_else(|_| Err(sqlx::Error::Io(std::io::ErrorKind::TimedOut.into())))
}

async fn try_lock(connection: &mut PgConnection, account: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar!(
        r#"SELECT pg_try_advisory_lock(hashtext('whatsapp-account:' || $1::uuid::text)) AS "locked!""#,
        account
    )
    .fetch_one(connection)
    .await
}

async fn unlock(connection: &mut PgConnection, account: Uuid) -> Result<bool, sqlx::Error> {
    sqlx::query_scalar!(
        r#"SELECT pg_advisory_unlock(hashtext('whatsapp-account:' || $1::uuid::text)) AS "unlocked!""#,
        account
    )
    .fetch_one(connection)
    .await
}

impl AccountLocks for PgAccountLocks {
    async fn try_lock(&self, account: Uuid) -> Result<bool, LeaseError> {
        self.call(|reply| Command::TryLock(account, reply)).await
    }

    async fn unlock(&self, account: Uuid) -> Result<(), LeaseError> {
        let held = self.call(|reply| Command::Unlock(account, reply)).await?;
        if !held {
            tracing::warn!(account_id = %account, "Unlocked a WhatsApp account this replica did not hold");
        }
        Ok(())
    }

    fn lost(&self) -> CancellationToken {
        self.lost.clone()
    }
}

/// Discovery through the linked-devices domain, and release announcements
/// (the service's own `NOTIFY` channel) over the shared pool.
#[derive(Clone)]
pub struct PgAccountDirectory {
    pool: PgPool,
    sessions: SessionService,
}

impl PgAccountDirectory {
    /// Wraps the shared pool and the domain service.
    pub fn new(pool: PgPool, sessions: SessionService) -> Self {
        PgAccountDirectory { pool, sessions }
    }
}

fn domain_error(report: rootcause::Report<LinkedError>) -> LeaseError {
    LeaseError::Internal(report.into_dynamic())
}

impl AccountDirectory for PgAccountDirectory {
    async fn candidates(&self, limit: u32) -> Result<Vec<Uuid>, LeaseError> {
        self.sessions
            .discoverable_accounts(i64::from(limit))
            .await
            .map_err(domain_error)
    }

    async fn pairing_account(&self, pairing: Uuid) -> Result<Option<Uuid>, LeaseError> {
        Ok(self
            .sessions
            .pairing_work(pairing)
            .await
            .map_err(domain_error)?
            .map(|work| work.account_id))
    }

    async fn announce_released(&self, account: Uuid) -> Result<(), LeaseError> {
        sqlx::query!(
            "SELECT pg_notify($1, $2)",
            ACCOUNT_RELEASED,
            account.to_string()
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn health(&self) -> Result<FleetHealth, LeaseError> {
        let health = self.sessions.fleet_health().await.map_err(domain_error)?;
        Ok(FleetHealth {
            accounts_unowned: health.accounts_unowned,
            oldest_unprocessed_inbound_seconds: health.oldest_unprocessed_inbound_seconds,
        })
    }
}
