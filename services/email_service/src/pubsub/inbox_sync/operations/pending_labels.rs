use email_db_client::labels::pending_writes::pending_provider_label_ids;
use email_db_client::messages::insert::ResyncSnapshot;
use futures::future::BoxFuture;
use sqlx::PgPool;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// A read of Gmail's labels for a message, with the labels that had a
/// pending Macro write just before and just after it.
pub(in crate::pubsub) struct PendingAroundRead<T> {
    pub value: T,
    before: Vec<String>,
    after: Vec<String>,
}

impl<T> PendingAroundRead<T> {
    /// Labels whose local state the read may not reflect: Gmail may have
    /// answered before applying a write pending at either point.
    pub fn untrusted_labels(&self) -> Vec<String> {
        let mut labels = self.before.clone();
        labels.extend(
            self.after
                .iter()
                .filter(|label| !self.before.contains(label))
                .cloned(),
        );
        labels
    }
}

/// Runs `read` between two reads of the message's pending label writes.
///
/// `read` is boxed: a Gmail read is a large future, and an unoptimized build
/// gives a future passed by value a stack slot in every frame it passes
/// through and another where it is awaited, enough to overflow a worker
/// thread's stack on the inbox sync path in a local build.
pub(in crate::pubsub) async fn read_around<T>(
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
pub(in crate::pubsub) async fn resync_around<T>(
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
