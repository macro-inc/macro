//! Moves email attachments whose mail is gone to the Trash.
//!
//! MacroDB records a document in `released_email_attachment_documents` when a
//! statement removes its last email link, and notifies
//! [`RELEASED_CHANNEL`]. This task drains that queue on each notification, and
//! on a sweep that covers notifications sent while it was not listening.

use documents_hex::domain::released_attachments::{
    ReleasedAttachmentRepo, ReleasedAttachmentService,
};
use macro_event_broker::MacroEventBroker;
use sqlx::PgPool;
use std::time::Duration;
use tokio::time::MissedTickBehavior;
use tokio_util::sync::CancellationToken;

/// The channel the queue's trigger notifies.
const RELEASED_CHANNEL: &str = "email_attachment_documents_released";

const SWEEP_INTERVAL: Duration = Duration::from_secs(60);

/// Drain the released-attachment queue until the service begins shutdown.
pub(crate) async fn run<R, B>(
    service: ReleasedAttachmentService<R, B>,
    pool: PgPool,
    cancellation: CancellationToken,
) where
    R: ReleasedAttachmentRepo,
    B: MacroEventBroker,
{
    let Some(mut listener) = listen(&pool, &cancellation).await else {
        return;
    };
    let mut sweep = tokio::time::interval(SWEEP_INTERVAL);
    sweep.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => return,
            _ = sweep.tick() => {}
            notification = listener.recv() => {
                let _ = notification.inspect_err(|error| {
                    tracing::warn!(error = ?error, "released attachment listener reconnecting");
                });
            }
        }

        // A batch commits before the next starts, so stopping between them is
        // safe; the rest waits in the queue.
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => return,
            _ = service.drain() => {}
        }
    }
}

/// Listen on [`RELEASED_CHANNEL`], retrying every 5 seconds until it works or
/// the service stops (`None`), which also abandons a connection attempt in
/// progress. `PgListener::recv` re-establishes a dropped connection by itself.
async fn listen(
    pool: &PgPool,
    cancellation: &CancellationToken,
) -> Option<sqlx::postgres::PgListener> {
    loop {
        let listening = async {
            let mut listener = sqlx::postgres::PgListener::connect_with(pool).await?;
            listener.listen(RELEASED_CHANNEL).await?;
            Ok::<_, sqlx::Error>(listener)
        };
        let listened = tokio::select! {
            _ = cancellation.cancelled() => return None,
            listened = listening => listened,
        };
        match listened {
            Ok(listener) => return Some(listener),
            Err(error) => {
                tracing::warn!(error = %error, "released attachment listener will retry");
                tokio::select! {
                    _ = cancellation.cancelled() => return None,
                    _ = tokio::time::sleep(Duration::from_secs(5)) => {}
                }
            }
        }
    }
}
