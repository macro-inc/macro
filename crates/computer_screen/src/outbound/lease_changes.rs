//! Lease changes from every replica, over one `LISTEN` connection.

use computer_id::ComputerId;
use sqlx::PgPool;
use sqlx::postgres::PgListener;
use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

use super::pg::LEASE_CHANGED_CHANNEL;
use crate::domain::ports::LeaseChanges;

/// How long a failed listener waits before connecting again.
const RECONNECT_DELAY: std::time::Duration = std::time::Duration::from_secs(1);

/// Changes this process hears, its own included (Postgres delivers a
/// `NOTIFY` to the sending session's listeners too). A change sent while
/// the connection is down is lost; waiters re-read on their safety timer.
#[derive(Clone)]
pub struct PgLeaseChanges {
    changed: broadcast::Sender<ComputerId>,
}

impl PgLeaseChanges {
    /// Listen on `pool`'s database until `shutdown`, on a task `tracker`
    /// tracks. Returns once the first attempt to listen has finished, so a
    /// change made after it is heard; a failed attempt is retried in the
    /// background.
    pub async fn listen(pool: PgPool, tracker: &TaskTracker, shutdown: CancellationToken) -> Self {
        let (changed, _) = broadcast::channel(256);
        let sender = changed.clone();
        let first = subscribe(&pool).await;
        tracker.spawn(async move {
            let mut listener = first;
            loop {
                let error = match listener {
                    Ok(listener) => tokio::select! {
                        biased;
                        () = shutdown.cancelled() => return,
                        error = relay(listener, &sender) => error,
                    },
                    Err(error) => error,
                };
                tracing::warn!(error = %error, "screen lease listener failed; reconnecting");
                tokio::select! {
                    biased;
                    () = shutdown.cancelled() => return,
                    () = tokio::time::sleep(RECONNECT_DELAY) => {}
                }
                listener = subscribe(&pool).await;
            }
        });
        Self { changed }
    }
}

async fn subscribe(pool: &PgPool) -> Result<PgListener, sqlx::Error> {
    let mut listener = PgListener::connect_with(pool).await?;
    listener.listen(LEASE_CHANGED_CHANNEL).await?;
    Ok(listener)
}

async fn relay(mut listener: PgListener, changed: &broadcast::Sender<ComputerId>) -> sqlx::Error {
    loop {
        match listener.recv().await {
            Ok(notification) => {
                if let Ok(computer) = ComputerId::parse_uuid_str(notification.payload()) {
                    // Nobody subscribed is not an error: nothing waits.
                    let _ = changed.send(computer);
                }
            }
            Err(error) => return error,
        }
    }
}

impl LeaseChanges for PgLeaseChanges {
    fn subscribe(&self) -> broadcast::Receiver<ComputerId> {
        self.changed.subscribe()
    }
}
