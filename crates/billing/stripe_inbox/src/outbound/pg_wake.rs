//! Wakes the worker when the webhook stores an event (`NOTIFY stripe_inbox`).

use std::sync::Arc;
use std::time::Duration;

use sqlx::PgPool;
use sqlx::postgres::PgListener;
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

use super::pg::WAKE_CHANNEL;

/// How long to wait before listening again after the connection drops.
const RECONNECT_DELAY: Duration = Duration::from_secs(5);

/// Listens for wake-ups until `stop`, notifying `wake` on each. A dropped
/// connection reconnects; the worker's poll covers the gap.
pub async fn listen(pool: PgPool, wake: Arc<Notify>, stop: CancellationToken) {
    loop {
        let listened = tokio::select! {
            () = stop.cancelled() => return,
            listened = listen_once(&pool, &wake) => listened,
        };
        if let Err(error) = listened {
            tracing::warn!(error = ?error, "stripe inbox wake listener dropped; reconnecting");
        }
        tokio::select! {
            () = stop.cancelled() => return,
            () = tokio::time::sleep(RECONNECT_DELAY) => {}
        }
    }
}

async fn listen_once(pool: &PgPool, wake: &Notify) -> Result<(), sqlx::Error> {
    let mut listener = PgListener::connect_with(pool).await?;
    listener.listen(WAKE_CHANNEL).await?;
    loop {
        listener.recv().await?;
        wake.notify_one();
    }
}
