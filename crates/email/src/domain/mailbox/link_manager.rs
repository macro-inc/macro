//! Per-delivery link maintenance, using the existing health and lifecycle services.

/// Physical link deletion and its capability ports.
pub mod deletion;
mod ports;
/// Incremental physical mailbox purge and its persistence contracts.
pub mod purge;
#[cfg(test)]
mod test;

pub use ports::*;

use super::MailboxError;
use super::connection::ConnectionSourceError;
use super::inbox_sync::build_notification_recipients;
use super::lifecycle::InboxLifecycleError;
use crate::domain::events::{EmailMacroEvent, LinkReauthRequiredMetadata};
use anyhow::{Context, anyhow};
use macro_event_broker::MacroEventBroker;
use models_email::service::link::Link;
use models_email::service::pubsub::LinkManagerMessage;
use std::future::Future;
use std::time::Duration;
use uuid::Uuid;

/// The listener's final action, retaining the original processing error.
pub enum LinkManagerDisposition {
    /// The operation completed or its link no longer exists; acknowledge it.
    DoneDelete,
    /// Keep the delivery in flight for the queue's existing redelivery policy.
    LeaveForRedelivery(anyhow::Error),
}

/// Processes link-maintenance deliveries without owning their queue transport.
pub struct LinkManagerService<R, H, L, N, B, D> {
    /// Existing link and delegation facts.
    pub repository: R,
    /// Existing provider-specific health policy.
    pub health: H,
    /// Existing lifecycle preparation and deleted-user policy.
    pub lifecycle: L,
    /// Reauthentication notification delivery.
    pub notifications: N,
    /// Existing non-blocking event publication.
    pub broker: B,
    /// Physical-deletion domain service.
    pub deletion: D,
}

impl<R, H, L, N, B, D> LinkManagerService<R, H, L, N, B, D>
where
    R: LinkManagerRepository,
    H: LinkManagerHealth,
    L: LinkManagerLifecycle,
    N: LinkManagerNotifications,
    B: MacroEventBroker,
    D: LinkDeletion,
{
    /// Decide acknowledgement after decoding and processing one delivery.
    ///
    /// A delivery whose inbox stayed locked past the lock timeout runs again
    /// here a few times before it goes back to the queue: the queue dead-letters
    /// a delivery after five receives, and a busy inbox is no reason to stop
    /// deleting it. Each attempt opens its own transactions, so no connection
    /// waits between them, and all of them fit in one visibility timeout.
    pub async fn process(
        &self,
        message: anyhow::Result<LinkManagerMessage>,
    ) -> LinkManagerDisposition {
        let message = match message {
            Ok(message) => message,
            Err(error) => return LinkManagerDisposition::LeaveForRedelivery(error),
        };
        let mut attempt = 1;
        loop {
            match self.execute(&message).await {
                Ok(()) => return LinkManagerDisposition::DoneDelete,
                Err(error) if attempt < CONTENDED_ATTEMPTS && is_contended(&error) => {
                    tracing::debug!(attempt, "link maintenance waits for its inbox to be free");
                    tokio::time::sleep(CONTENDED_RETRY_DELAY).await;
                    attempt += 1;
                }
                Err(error) => return LinkManagerDisposition::LeaveForRedelivery(error),
            }
        }
    }

    async fn execute(&self, message: &LinkManagerMessage) -> anyhow::Result<()> {
        match message {
            LinkManagerMessage::Refresh { link_id } => {
                within_probe_timeout(self.health.probe(*link_id, true)).await?
            }
            LinkManagerMessage::HealthCheck { link_id } => {
                within_probe_timeout(self.health.probe(*link_id, false)).await?
            }
            LinkManagerMessage::NotifyReauthRequired { link_id } => {
                let link = self.get_link_or_skip(*link_id).await?;
                let Some(link) = link else { return Ok(()) };
                self.handle_notify_reauth_required(&link).await?;
            }
            LinkManagerMessage::DeleteLink {
                link_id,
                deletion_reason,
            } => {
                let link = self.get_link_or_skip(*link_id).await?;
                let Some(link) = link else { return Ok(()) };
                if self
                    .lifecycle
                    .prepare_delete(*link_id, *deletion_reason)
                    .await?
                {
                    self.deletion.delete(&link, deletion_reason).await?;
                }
            }
            LinkManagerMessage::DeleteUser { fusionauth_user_id } => {
                self.lifecycle.deleted_user(fusionauth_user_id).await?;
            }
        }
        Ok(())
    }

    async fn get_link_or_skip(&self, link_id: Uuid) -> anyhow::Result<Option<Link>> {
        let link = self
            .repository
            .link(link_id)
            .await
            .map_err(ConnectionSourceError::into_original)?;
        if link.is_none() {
            tracing::debug!(link_id=%link_id, "Link not found - skipping");
        }
        Ok(link)
    }

    /// Notify the owner and delegates that the link's grant needs reconnecting.
    #[tracing::instrument(skip(self), fields(link = ?link), err)]
    async fn handle_notify_reauth_required(&self, link: &Link) -> anyhow::Result<()> {
        let primaries = self
            .repository
            .primaries(link.macro_id.as_ref(), link.id)
            .await
            .map_err(ConnectionSourceError::into_original)
            .context("Failed to fetch delegated primaries for reauth notification")?;
        let recipient_ids = build_notification_recipients(&link.macro_id, primaries);
        self.notifications
            .send(ReauthNotification {
                owner: link.macro_id.clone(),
                email_address: link.email_address.0.as_ref().to_string(),
                recipient_ids,
            })
            .await
            .map_err(|e| anyhow!("failed to send reauth notification: {e}"))?;

        // This message is enqueued only on the false->true needs_reauth
        // transition, so the event stays edge-triggered.
        let _ = self
            .broker
            .send_event(&EmailMacroEvent::link_reauth_required(
                LinkReauthRequiredMetadata {
                    link_id: link.id,
                    owner: link.macro_id.clone(),
                    email_address: link.email_address.0.as_ref().to_string(),
                    observed_at: link.last_sync_error_at.unwrap_or_else(chrono::Utc::now),
                },
            ))
            .inspect_err(|e| tracing::error!(error=?e, "failed to publish email macro event"));
        Ok(())
    }
}

/// The worker renews a message's visibility for as long as it is processed, so
/// an unbounded probe that stalls would hold its message in flight instead of
/// letting it be redelivered and, after the queue's retry limit, dead-lettered.
/// Only link deletion needs to outlast the queue's visibility timeout.
const PROBE_TIMEOUT: Duration = Duration::from_secs(240);

async fn within_probe_timeout(
    probe: impl Future<Output = Result<(), MailboxError>>,
) -> anyhow::Result<()> {
    tokio::time::timeout(PROBE_TIMEOUT, probe)
        .await
        .context("inbox health probe timed out")??;
    Ok(())
}

/// Attempts a delivery gets while its inbox stays locked, and the wait between
/// them. An attempt waits out at most two 5 s lock timeouts (the snapshot, then
/// the removal), so all of them take at most about 160 s, inside the queue's
/// 300 s visibility timeout.
const CONTENDED_ATTEMPTS: u32 = 6;
const CONTENDED_RETRY_DELAY: Duration = Duration::from_secs(20);

fn is_contended(error: &anyhow::Error) -> bool {
    matches!(
        error.downcast_ref::<InboxLifecycleError>(),
        Some(InboxLifecycleError::Contended)
    )
}
