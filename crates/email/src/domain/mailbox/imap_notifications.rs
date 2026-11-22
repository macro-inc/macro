//! Fenced wakeups and credential-health notifications from the IMAP engine.

use super::{MailboxError, MailboxKey};
use std::future::Future;

pub trait ImapNotificationRepository: Send + Sync + 'static {
    /// Commit health and wakeups only while this exact active IMAP binding exists.
    fn commit(
        &self,
        mailbox: MailboxKey,
        credentials_rejected: bool,
        revision: Option<i64>,
        mailbox_issue: Option<models_email::service::link::MailboxIssue>,
        retry_at: Option<chrono::DateTime<chrono::Utc>>,
    ) -> impl Future<Output = Result<(), MailboxError>> + Send;
}
pub struct ImapNotificationService<R>(pub R);
impl<R: ImapNotificationRepository> ImapNotificationService<R> {
    #[tracing::instrument(skip_all, fields(mailbox.link_id = %notification.binding.link_id), err)]
    pub async fn receive(
        &self,
        notification: imap_engine::domain::models::Notification,
    ) -> Result<(), MailboxError> {
        let binding = notification.binding;
        if binding.sync_generation < 1
            || binding.grant_generation < 1
            || notification.revision.is_some_and(|revision| revision < 0)
        {
            return Err(MailboxError::Stale);
        }
        self.0
            .commit(
                MailboxKey {
                    link_id: binding.link_id,
                    sync_generation: binding.sync_generation,
                    grant_generation: binding.grant_generation,
                },
                notification.credentials_rejected,
                notification.revision,
                notification.mailbox_issue,
                notification.sync_retry_at,
            )
            .await
    }
}
