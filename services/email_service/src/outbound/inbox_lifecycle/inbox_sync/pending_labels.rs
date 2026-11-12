use email_db_client::labels::pending_writes::pending_provider_label_ids;
use email_db_client::messages::insert::ResyncSnapshot;
use futures::future::BoxFuture;
use sqlx::PgPool;
use uuid::Uuid;

#[cfg(test)]
mod test;

pub(crate) use email::domain::mailbox::inbox_sync::PendingAroundRead;

/// Runs `read` between two reads of the message's pending label writes.
///
/// `read` is boxed: a Gmail read is a large future, and an unoptimized build
/// gives a future passed by value a stack slot in every frame it passes
/// through and another where it is awaited, enough to overflow a worker
/// thread's stack on the inbox sync path in a local build.
pub(crate) async fn read_around<T>(
    db: &PgPool,
    message_id: Uuid,
    read: BoxFuture<'_, T>,
) -> Result<PendingAroundRead<T>, sqlx::Error> {
    let before = pending_provider_label_ids(db, message_id).await?;
    let value = read.await;
    let after = pending_provider_label_ids(db, message_id).await?;
    Ok(PendingAroundRead {
        value,
        before,
        after,
    })
}

/// Runs `read`, a Gmail fetch of a stored message that is about to be
/// re-synced, after reading its stored labels and between two reads of its
/// pending label writes. `read` is boxed for the reason given on
/// [`read_around`].
pub(crate) async fn resync_around<T>(
    db: &PgPool,
    message_id: Uuid,
    read: BoxFuture<'_, T>,
) -> anyhow::Result<(T, ResyncSnapshot)> {
    let stored_labels = email_db_client::labels::get::fetch_message_labels(db, message_id)
        .await?
        .into_iter()
        .map(|label| label.provider_label_id)
        .collect();
    let read = read_around(db, message_id, read).await?;
    let pending_labels = read.untrusted_labels();
    Ok((
        read.value,
        ResyncSnapshot {
            stored_labels,
            pending_labels,
        },
    ))
}
