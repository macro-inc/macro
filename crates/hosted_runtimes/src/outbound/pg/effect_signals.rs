//! Wakes the fleet worker as soon as an effect is queued for it, instead of
//! at its next tick.

use std::sync::Arc;

use sqlx::PgPool;
use sqlx::postgres::PgListener;
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;

/// `pg_notify` channel of the effect outbox. The payload is the worker the
/// effect waits for (`fleet` or `billing`), sent when its transaction commits.
pub(super) const EFFECT_QUEUED_CHANNEL: &str = "hosted_runtime_effect_queued";

/// How long a failed listener waits before connecting again.
const RECONNECT_DELAY: std::time::Duration = std::time::Duration::from_secs(1);

/// Effect-queued notifications from the outbox, over one `LISTEN`
/// connection. A notification sent while the connection is down is lost; the
/// worker's tick still finds that effect.
#[derive(Clone)]
pub struct PgEffectSignals {
    fleet: Arc<Notify>,
}

impl PgEffectSignals {
    /// Listen on `pool`'s database until `shutdown`, on a task `tracker`
    /// tracks. Returns once the first attempt to listen has finished, so an
    /// effect queued after it is heard; a failed attempt is retried in the
    /// background.
    pub async fn listen(pool: PgPool, tracker: &TaskTracker, shutdown: CancellationToken) -> Self {
        let fleet = Arc::new(Notify::new());
        let first = subscribe(&pool).await;
        let woken = Arc::clone(&fleet);
        tracker.spawn(async move {
            let mut listener = first;
            loop {
                let error = match listener {
                    Ok(listener) => tokio::select! {
                        biased;
                        () = shutdown.cancelled() => return,
                        error = relay(listener, &woken) => error,
                    },
                    Err(error) => error,
                };
                tracing::warn!(error = %error, "computer effect listener failed; reconnecting");
                tokio::select! {
                    biased;
                    () = shutdown.cancelled() => return,
                    () = tokio::time::sleep(RECONNECT_DELAY) => {}
                }
                listener = subscribe(&pool).await;
            }
        });
        Self { fleet }
    }

    /// Resolves once a fleet effect has been queued since the previous call
    /// returned, at once if one already was.
    pub async fn fleet_effect_queued(&self) {
        self.fleet.notified().await;
    }
}

async fn subscribe(pool: &PgPool) -> Result<PgListener, sqlx::Error> {
    let mut listener = PgListener::connect_with(pool).await?;
    listener.listen(EFFECT_QUEUED_CHANNEL).await?;
    Ok(listener)
}

/// Relay fleet notifications until the connection fails for good.
async fn relay(mut listener: PgListener, fleet: &Notify) -> sqlx::Error {
    loop {
        match listener.recv().await {
            Ok(notification) => {
                if notification.payload() == "fleet" {
                    // Stores a permit when the worker is busy, so it runs
                    // again right after its current pass.
                    fleet.notify_one();
                }
            }
            Err(error) => return error,
        }
    }
}
