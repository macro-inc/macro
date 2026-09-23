//! Translate provider MIME discovery into the email extraction use case.
use super::context::PubSubContext;
use email::domain::{
    calendar_invitation_parser::MAX_INVITATION_COMPONENTS,
    invitation_extraction::PendingInvitationPart,
};
use email_api_client::domain::models::CalendarPart;
use uuid::Uuid;

/// Save inline snapshots and durable attachment work after the email commit.
pub async fn save_discovered(ctx: &PubSubContext, message_id: Uuid, parts: &[CalendarPart]) {
    let parts = &parts[..parts.len().min(MAX_INVITATION_COMPONENTS)];
    let inline = parts
        .iter()
        .filter_map(|p| p.inline_data.as_deref())
        .collect::<Vec<_>>();
    let pending = parts
        .iter()
        .filter(|p| p.inline_data.is_none())
        .filter_map(|p| {
            p.provider_attachment_id
                .clone()
                .map(|attachment_id| PendingInvitationPart { attachment_id })
        })
        .collect::<Vec<_>>();
    if let Err(error) = ctx
        .invitation_extractor
        .ingest(message_id, &inline, &pending)
        .await
    {
        // Calendar-flagged threads are rediscovered by the extraction worker.
        tracing::warn!(error=?error, "inline invitation extraction deferred");
    }
}
