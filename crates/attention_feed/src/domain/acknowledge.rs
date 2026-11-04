//! Completing, reading and restoring a viewer's attention.
//!
//! A feed decides which notifications an entry (or a part of one) stands
//! for; the acknowledger moves them, archives inbox email (mail's done),
//! tells the viewer's other sessions, and returns a receipt that undo
//! reverses exactly.

use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use uuid::Uuid;

use super::{
    models::{Acknowledgment, DoneReceipt, FeedKey, FeedViewer},
    ports::{FeedMail, FeedNotifications, FeedSignals, NotificationTransition},
};

#[cfg(test)]
mod test;

/// Moves a viewer's notifications through done, seen and undo.
pub struct Acknowledger<N, M, G> {
    notifications: N,
    mail: M,
    signals: G,
}

/// Values deduplicated in first-seen order.
fn unique<T: PartialEq>(values: impl IntoIterator<Item = T>) -> Vec<T> {
    let mut unique = Vec::new();
    for value in values {
        if !unique.contains(&value) {
            unique.push(value);
        }
    }
    unique
}

impl<N, M, G> Acknowledger<N, M, G>
where
    N: FeedNotifications,
    M: FeedMail,
    G: FeedSignals,
{
    /// Create the acknowledger over its ports.
    pub fn new(notifications: N, mail: M, signals: G) -> Self {
        Self {
            notifications,
            mail,
            signals,
        }
    }

    async fn signal(&self, user: &MacroUserIdStr<'static>, keys: &[FeedKey]) {
        self.signals
            .changed(
                user.clone(),
                keys.iter().map(|key| key.entity().clone()).collect(),
            )
            .await;
    }

    /// Move every acknowledged notification to done and archive the named
    /// threads. Archiving is best effort: the thread's notifications are
    /// already done, which removes its attention on their own.
    #[tracing::instrument(
        name = "attention_feed.acknowledge",
        skip_all,
        fields(user = %viewer.user, keys = acknowledgments.len()),
        err
    )]
    pub async fn acknowledge(
        &self,
        viewer: &FeedViewer,
        acknowledgments: Vec<Acknowledgment>,
    ) -> Result<DoneReceipt, Report> {
        let keys = unique(acknowledgments.iter().map(|ack| ack.key.clone()));
        let notification_ids = unique(
            acknowledgments
                .iter()
                .flat_map(|ack| ack.notification_ids.iter().copied()),
        );
        let threads = unique(acknowledgments.iter().filter_map(|ack| ack.archive_thread));

        let user = viewer.user.clone();
        let changed = if notification_ids.is_empty() {
            Vec::new()
        } else {
            self.notifications
                .transition(user.clone(), notification_ids, NotificationTransition::Done)
                .await?
        };
        let mut archived = Vec::new();
        for thread_id in threads {
            match self.mail.set_archived(user.clone(), thread_id, true).await {
                Ok(()) => archived.push(thread_id),
                Err(error) => {
                    tracing::warn!(error = ?error, %thread_id, "failed to archive feed email")
                }
            }
        }
        self.signal(&user, &keys).await;
        Ok(DoneReceipt {
            keys: keys.iter().map(FeedKey::id).collect(),
            notification_ids: changed,
            archived_threads: archived,
        })
    }

    /// Reverse exactly what one acknowledgment changed. Returns the keys it
    /// touched, for the feed to recompute.
    #[tracing::instrument(name = "attention_feed.undo", skip_all, fields(user = %viewer.user), err)]
    pub async fn undo(
        &self,
        viewer: &FeedViewer,
        receipt: &DoneReceipt,
    ) -> Result<Vec<FeedKey>, Report> {
        let user = viewer.user.clone();
        if !receipt.notification_ids.is_empty() {
            self.notifications
                .transition(
                    user.clone(),
                    receipt.notification_ids.clone(),
                    NotificationTransition::Undone,
                )
                .await?;
        }
        for thread_id in &receipt.archived_threads {
            if let Err(error) = self
                .mail
                .set_archived(user.clone(), *thread_id, false)
                .await
            {
                tracing::warn!(error = ?error, %thread_id, "failed to unarchive feed email");
            }
        }
        let keys = receipt.feed_keys();
        self.signal(&user, &keys).await;
        Ok(keys)
    }

    /// Mark notifications seen for the entries `keys` and tell the viewer's
    /// other sessions. Returns the ids whose state changed.
    #[tracing::instrument(
        name = "attention_feed.seen",
        skip_all,
        fields(user = %viewer.user, notifications = notification_ids.len()),
        err
    )]
    pub async fn mark_seen(
        &self,
        viewer: &FeedViewer,
        keys: &[FeedKey],
        notification_ids: Vec<Uuid>,
    ) -> Result<Vec<Uuid>, Report> {
        let notification_ids = unique(notification_ids);
        if notification_ids.is_empty() {
            return Ok(Vec::new());
        }
        let user = viewer.user.clone();
        let changed = self
            .notifications
            .transition(user.clone(), notification_ids, NotificationTransition::Seen)
            .await?;
        self.signal(&user, keys).await;
        Ok(changed)
    }
}
