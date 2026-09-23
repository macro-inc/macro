//! Durable display extraction; errors in calendar content never reject mail.
use super::{
    calendar_invitation_parser::{MAX_INVITATION_BYTES, parse_invitation_parts},
    models::calendar_invitation::{InvitationExtractionStatus, ParsedInvitations},
};
use rootcause::Report;
use serde::{Deserialize, Serialize};
use std::future::Future;
use uuid::Uuid;

/// Attachment content still required after inline extraction.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingInvitationPart {
    /// Provider attachment key.
    pub attachment_id: String,
}
/// Calendar MIME content discovered during durable recovery/backfill.
pub struct DiscoveredInvitationPart {
    /// Attachment identity, if content is not inline.
    pub attachment_id: Option<String>,
    /// Decoded inline bytes.
    pub bytes: Option<Vec<u8>>,
}
/// Durable extraction work with message and connected inbox identity.
pub struct InvitationExtractionJob {
    /// Saved email message.
    pub message_id: Uuid,
    /// Owning inbox, used only for provider downloads during ingestion.
    pub link_id: Uuid,
    /// Provider message key.
    pub provider_id: String,
    /// Parts awaiting download.
    pub parts: Vec<PendingInvitationPart>,
    /// MIME reinspection required after failed ingestion or historical backfill.
    pub discover: bool,
    /// Content is complete; only refresh delivery remains.
    pub notification_only: bool,
    /// Fencing token; an expired worker cannot overwrite a newer claim.
    pub generation: i64,
}
/// Persistence boundary for extraction and durable retry claims.
pub trait InvitationExtractionRepository: Send + Sync {
    /// Whether this immutable message already has work for this parser version.
    fn is_processed(&self, message_id: Uuid) -> impl Future<Output = Result<bool, Report>> + Send;
    /// Replace snapshots on parser upgrades, append retries, and fence expired leases.
    /// Returns whether a refresh is due: snapshots changed now or earlier without delivery.
    fn save(
        &self,
        message_id: Uuid,
        parsed: &ParsedInvitations,
        pending: &[PendingInvitationPart],
        generation: Option<i64>,
    ) -> impl Future<Output = Result<bool, Report>> + Send;
    /// Lease due work and enqueue a bounded batch of recent historical invites.
    fn claim(&self) -> impl Future<Output = Result<Vec<InvitationExtractionJob>, Report>> + Send;
    /// Acknowledge refresh delivery for the current lease.
    fn notified(
        &self,
        message_id: Uuid,
        generation: i64,
    ) -> impl Future<Output = Result<(), Report>> + Send;
}
/// Provider reads, never called by a message read operation.
pub trait InvitationAttachmentProvider: Send + Sync {
    /// Reinspect MIME for ingestion recovery or historical backfill only.
    fn discover(
        &self,
        link_id: Uuid,
        message_id: &str,
    ) -> impl Future<Output = Result<Vec<DiscoveredInvitationPart>, Report>> + Send;
    /// Download only a discovered attachment with existing provider rate limits.
    fn download(
        &self,
        link_id: Uuid,
        message_id: &str,
        attachment_id: &str,
    ) -> impl Future<Output = Result<Vec<u8>, Report>> + Send;
}
/// Publish completion through the normal email refresh path.
pub trait InvitationExtractionNotifier: Send + Sync {
    /// Invalidate the owning inbox after committed extraction.
    fn completed(&self, link_id: Uuid) -> impl Future<Output = Result<(), Report>> + Send;
}
/// Extraction policy composed with independent infrastructure adapters.
#[derive(Clone)]
pub struct InvitationExtractionService<R, P, N> {
    /// Snapshot and durable retry storage.
    pub repository: R,
    /// Rate-limited provider reads.
    pub provider: P,
    /// Existing email refresh notification.
    pub notifier: N,
}
impl<
    R: InvitationExtractionRepository,
    P: InvitationAttachmentProvider,
    N: InvitationExtractionNotifier,
> InvitationExtractionService<R, P, N>
{
    /// Parse inline bytes once and save attachment work for the retry worker.
    /// Messages without calendar parts keep no extraction state.
    pub async fn ingest(
        &self,
        message_id: Uuid,
        inline: &[&[u8]],
        pending: &[PendingInvitationPart],
    ) -> Result<(), Report> {
        if inline.is_empty() && pending.is_empty() {
            return Ok(());
        }
        if self.repository.is_processed(message_id).await? {
            return Ok(());
        }
        let started = std::time::Instant::now();
        let parsed = parse_invitation_parts(inline);
        tracing::info!(components = parsed.invitations.len(), status = ?parsed.status, duration_ms = started.elapsed().as_millis() as u64, "invitation extraction");
        self.repository
            .save(message_id, &parsed, pending, None)
            .await?;
        Ok(())
    }
    /// One bounded batch. Failures are isolated per message and retried durably.
    #[tracing::instrument(skip_all, err)]
    pub async fn run_once(&self) -> Result<(), Report> {
        for job in self.repository.claim().await? {
            if let Err(error) = self.process(job).await {
                tracing::warn!(error=?error, "invitation extraction retry");
            }
        }
        Ok(())
    }
    async fn process(&self, job: InvitationExtractionJob) -> Result<(), Report> {
        if job.notification_only {
            self.notifier.completed(job.link_id).await?;
            return self
                .repository
                .notified(job.message_id, job.generation)
                .await;
        }
        let mut work = job.parts;
        let mut downloaded = Vec::new();
        if job.discover {
            for part in self
                .provider
                .discover(job.link_id, &job.provider_id)
                .await?
            {
                if let Some(bytes) = part.bytes {
                    downloaded.push(bytes);
                } else if let Some(attachment_id) = part.attachment_id {
                    work.push(PendingInvitationPart { attachment_id });
                }
            }
        }
        let mut pending = Vec::new();
        let mut unsupported = false;
        for part in work {
            match self
                .provider
                .download(job.link_id, &job.provider_id, &part.attachment_id)
                .await
            {
                Ok(bytes) if bytes.len() <= MAX_INVITATION_BYTES => downloaded.push(bytes),
                Ok(_) => {
                    unsupported = true;
                    tracing::warn!(reason = "oversized", "invitation extraction skipped");
                }
                Err(_) => {
                    tracing::warn!(
                        reason = "attachment_unavailable",
                        "invitation extraction retry"
                    );
                    pending.push(part);
                }
            }
        }
        let parts = downloaded.iter().map(Vec::as_slice).collect::<Vec<_>>();
        let mut parsed = parse_invitation_parts(&parts);
        if unsupported && parsed.invitations.is_empty() {
            parsed.status = InvitationExtractionStatus::Unsupported;
        }
        if self
            .repository
            .save(job.message_id, &parsed, &pending, Some(job.generation))
            .await?
        {
            self.notifier.completed(job.link_id).await?;
            self.repository
                .notified(job.message_id, job.generation)
                .await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod test;
