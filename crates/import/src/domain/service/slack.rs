//! Slack creation is fenced by a durable canonical target, not the per-user ledger CAS.

use crate::domain::{
    models::{
        ImportEntity, ImportTargetKey, ImportTargetKind, SlackChannelMeta, SlackConversationId,
    },
    ports::{CanonicalImportRepo, EntityCreator},
};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

#[cfg(test)]
mod test;

pub(super) async fn ensure_channel(
    repo: &impl CanonicalImportRepo,
    creator: &impl EntityCreator,
    user: &MacroUserIdStr<'static>,
    row: &ImportEntity,
    team_id: Uuid,
) -> anyhow::Result<Uuid> {
    let meta: SlackChannelMeta = serde_json::from_value(row.metadata.clone())?;
    // Never guess a source ID from a channel name. Older normalization prefixed
    // G/D IDs with '#'; strip that prefix only when the result is a valid ID.
    let foreign_id = SlackConversationId::new(row.foreign_id.trim_start_matches('#'))
        .ok_or_else(|| anyhow::anyhow!("Slack import requires a stable conversation ID"))?;
    if let Some(metadata_id) = &meta.channel_id {
        anyhow::ensure!(
            metadata_id.trim() == foreign_id.as_str(),
            "Slack metadata does not match the source identity"
        );
    }
    let key = ImportTargetKey {
        team_id,
        foreign_id,
    };
    let target = repo
        .reserve_target(user, &key, ImportTargetKind::Team, None)
        .await?;
    if target.ready {
        return Ok(target.channel_id);
    }
    let emails = meta
        .participants
        .iter()
        .filter_map(|participant| participant.email.clone())
        .collect::<Vec<_>>();
    let channel_id = creator
        .create_channel(user, &meta.name, &target, &emails)
        .await?;
    // Completion validates the persisted ID against the reservation. On retry,
    // either the same pending UUID is ensured again or a ready mapping is reused.
    let completed = repo
        .complete_target(&key, channel_id, ImportTargetKind::Team)
        .await?;
    Ok(completed.channel_id)
}
