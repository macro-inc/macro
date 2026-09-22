//! Translate provider MIME discovery into the email extraction use case.
use super::context::PubSubContext;
use email::domain::{
    calendar_invitation_parser::{InvitationPart, MAX_INVITATION_COMPONENTS},
    invitation_extraction::PendingInvitationPart,
};
use email_api_client::domain::models::CalendarPart;
use uuid::Uuid;

/// Save inline snapshots and durable attachment work after the email commit.
pub async fn save_discovered(ctx: &PubSubContext, message_id: Uuid, parts: &[CalendarPart]) {
    let inline = parts
        .iter()
        .take(MAX_INVITATION_COMPONENTS)
        .filter_map(|p| {
            p.inline_data.as_ref().map(|bytes| InvitationPart {
                part_id: p.part_id.as_deref().unwrap_or("calendar"),
                attachment_id: p.provider_attachment_id.as_deref(),
                bytes,
            })
        })
        .collect::<Vec<_>>();
    let pending = parts
        .iter()
        .take(MAX_INVITATION_COMPONENTS)
        .filter(|p| p.inline_data.is_none())
        .filter_map(|p| {
            p.provider_attachment_id
                .as_ref()
                .map(|id| PendingInvitationPart {
                    part_id: p.part_id.clone().unwrap_or_else(|| id.clone()),
                    attachment_id: id.clone(),
                })
        })
        .collect::<Vec<_>>();
    if let Err(error) = ctx
        .invitation_extractor
        .ingest(message_id, &inline, &pending)
        .await
    {
        // The message transaction's extraction trigger guarantees durable recovery.
        tracing::warn!(error=?error, "inline invitation extraction deferred");
    }
}
