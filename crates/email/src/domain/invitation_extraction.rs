//! Display extraction at ingestion; errors in calendar content never reject mail.
use super::{
    calendar_invitation_parser::{MAX_INVITATION_COMPONENTS, parse_invitation_parts},
    models::calendar_invitation::CalendarInvitation,
};
use rootcause::Report;
use std::future::Future;
use uuid::Uuid;

/// Calendar MIME part of a synced message.
pub enum InvitationPart<'a> {
    /// Decoded content included in the synced message.
    Inline(&'a [u8]),
    /// Provider attachment key; downloaded only when no part is inline.
    Attachment(&'a str),
}
/// Snapshot persistence.
pub trait InvitationExtractionRepository: Send + Sync {
    /// Save display snapshots; saving the same components again is a no-op.
    fn save(
        &self,
        message_id: Uuid,
        invitations: &[CalendarInvitation],
    ) -> impl Future<Output = Result<(), Report>> + Send;
}
/// Provider reads, never called by a message read operation.
pub trait InvitationAttachmentProvider: Send + Sync {
    /// Download one calendar attachment with existing provider rate limits.
    fn download(
        &self,
        link_id: Uuid,
        message_id: &str,
        attachment_id: &str,
    ) -> impl Future<Output = Result<Vec<u8>, Report>> + Send;
}
/// Extraction policy composed with independent infrastructure adapters.
#[derive(Clone)]
pub struct InvitationExtractionService<R, P> {
    /// Snapshot storage.
    pub repository: R,
    /// Rate-limited provider reads.
    pub provider: P,
}
impl<R: InvitationExtractionRepository, P: InvitationAttachmentProvider>
    InvitationExtractionService<R, P>
{
    /// Parse a synced message's calendar parts once. Attachment-only invitations
    /// are downloaded best-effort; a failed download leaves the message as plain mail.
    pub async fn ingest(
        &self,
        message_id: Uuid,
        link_id: Uuid,
        provider_id: &str,
        parts: &[InvitationPart<'_>],
    ) -> Result<(), Report> {
        let parts = &parts[..parts.len().min(MAX_INVITATION_COMPONENTS)];
        if parts.is_empty() {
            return Ok(());
        }
        let started = std::time::Instant::now();
        let mut downloaded = Vec::new();
        let mut content = parts
            .iter()
            .filter_map(|part| match part {
                InvitationPart::Inline(bytes) => Some(*bytes),
                InvitationPart::Attachment(_) => None,
            })
            .collect::<Vec<_>>();
        // Inline and attached copies of one invitation are identical; skip the download.
        if content.is_empty() {
            for part in parts {
                let InvitationPart::Attachment(attachment_id) = part else {
                    continue;
                };
                match self
                    .provider
                    .download(link_id, provider_id, attachment_id)
                    .await
                {
                    // The parser skips oversized or malformed parts.
                    Ok(bytes) => downloaded.push(bytes),
                    Err(error) => {
                        tracing::warn!(error = ?error, "invitation attachment unavailable")
                    }
                }
            }
            content = downloaded.iter().map(Vec::as_slice).collect();
        }
        let invitations = parse_invitation_parts(&content);
        tracing::info!(
            components = invitations.len(),
            downloaded = downloaded.len(),
            duration_ms = started.elapsed().as_millis() as u64,
            "invitation extraction"
        );
        if invitations.is_empty() {
            return Ok(());
        }
        self.repository.save(message_id, &invitations).await
    }
}

#[cfg(test)]
mod test;
