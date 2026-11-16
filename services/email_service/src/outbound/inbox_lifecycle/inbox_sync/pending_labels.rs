use crate::outbound::backfill_jobs::{PgBackfillJobs, worker::PgBackfillWorker};
use email::domain::mailbox::inbox_sync::{read_pending_around, resync_snapshot};
use futures::future::BoxFuture;
use sqlx::PgPool;
use uuid::Uuid;
mod test;

async fn read_around<T: Send>(
    db: &PgPool,
    message: Uuid,
    read: BoxFuture<'_, T>,
) -> Result<
    email::domain::mailbox::inbox_sync::PendingAroundRead<T>,
    email::domain::backfill_jobs::worker::BackfillDatabaseError,
> {
    read_pending_around(
        &PgBackfillWorker {
            jobs: PgBackfillJobs(db.clone()),
        },
        message,
        read,
    )
    .await
}
async fn resync_around<T: Send>(
    db: &PgPool,
    message: Uuid,
    read: BoxFuture<'_, T>,
) -> Result<
    (T, email::domain::mailbox::inbox_sync::InboxSyncResync),
    email::domain::backfill_jobs::worker::BackfillDatabaseError,
> {
    resync_snapshot(
        &PgBackfillWorker {
            jobs: PgBackfillJobs(db.clone()),
        },
        message,
        read,
    )
    .await
}
