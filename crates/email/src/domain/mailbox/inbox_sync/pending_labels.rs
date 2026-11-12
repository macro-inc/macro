use super::InboxSyncRepository;
use crate::domain::mailbox::connection::ConnectionSourceError;
use futures::future::BoxFuture;
use uuid::Uuid;

/// Label facts needed around a provider read, shared by live sync and backfill.
pub trait MessageResyncRepository: Send + Sync {
    /// Original persistence failure.
    type ResyncError: ConnectionSourceError;
    /// Provider label identifiers stored before the read.
    fn resync_labels(
        &self,
        message: Uuid,
    ) -> impl Future<Output = Result<Vec<String>, Self::ResyncError>> + Send;
    /// Label writes pending at this point of the read.
    fn resync_pending_labels(
        &self,
        message: Uuid,
    ) -> impl Future<Output = Result<Vec<String>, Self::ResyncError>> + Send;
}

impl<R: InboxSyncRepository> MessageResyncRepository for R {
    type ResyncError = R::Err;
    async fn resync_labels(&self, message: Uuid) -> Result<Vec<String>, Self::ResyncError> {
        Ok(self
            .labels(message)
            .await?
            .into_iter()
            .map(|label| label.provider_label_id)
            .collect())
    }
    async fn resync_pending_labels(&self, message: Uuid) -> Result<Vec<String>, Self::ResyncError> {
        self.pending_labels(message).await
    }
}

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
pub async fn read_around<R: MessageResyncRepository, T: Send>(
    db: &R,
    message_id: Uuid,
    read: BoxFuture<'_, T>,
) -> Result<PendingAroundRead<T>, R::ResyncError> {
    let before = db.resync_pending_labels(message_id).await?;
    let value = read.await;
    let after = db.resync_pending_labels(message_id).await?;
    Ok(PendingAroundRead {
        value,
        before,
        after,
    })
}

/// Read stored and pending labels around a provider read for a message resync.
pub async fn resync_snapshot<R: MessageResyncRepository, T: Send>(
    db: &R,
    message: Uuid,
    read: futures::future::BoxFuture<'_, T>,
) -> Result<(T, super::InboxSyncResync), R::ResyncError> {
    let stored_labels = db.resync_labels(message).await?;
    let read = read_around(db, message, read).await?;
    let pending_labels = read.untrusted_labels();
    Ok((
        read.value,
        super::InboxSyncResync {
            stored_labels,
            pending_labels,
        },
    ))
}
