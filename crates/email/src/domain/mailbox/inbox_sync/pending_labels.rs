use super::InboxSyncRepository;
use futures::future::BoxFuture;
use uuid::Uuid;

/// A read of Gmail's labels for a message, with the labels that had a
/// pending Macro write just before and just after it.
pub struct PendingAroundRead<T> {
    /// Value returned by the provider read.
    pub value: T,
    /// Pending labels observed before the provider read.
    pub before: Vec<String>,
    /// Pending labels observed after the provider read.
    pub after: Vec<String>,
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
pub(super) async fn read_around<R: InboxSyncRepository, T: Send>(
    db: &R,
    message_id: Uuid,
    read: BoxFuture<'_, T>,
) -> Result<PendingAroundRead<T>, R::Err> {
    let before = db.pending_labels(message_id).await?;
    let value = read.await;
    let after = db.pending_labels(message_id).await?;
    Ok(PendingAroundRead {
        value,
        before,
        after,
    })
}
