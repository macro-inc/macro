//! Translate onboarding's reserved target into the owning channel API.

use crate::ToolChannelMessagesService;
use import::domain::models::ImportTargetReservation;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

#[cfg(test)]
mod test;

pub(crate) async fn create_channel(
    service: &ToolChannelMessagesService,
    user: &MacroUserIdStr<'static>,
    name: &str,
    target: &ImportTargetReservation,
    participant_emails: &[String],
    roster: &[MacroUserIdStr<'static>],
) -> anyhow::Result<Uuid> {
    // Preserve onboarding's best-effort team roster matching, not archive's raw
    // email mapping. Unknown collaborators and bots are not invited here.
    let participants = participant_emails
        .iter()
        .filter_map(|email| {
            roster
                .iter()
                .find(|member| member.email_str().eq_ignore_ascii_case(email))
                .cloned()
        })
        .collect();
    let ensured = service
        .create_reserved_team_channel(
            user.clone(),
            target.channel_id,
            target.key.team_id,
            name.to_string(),
            participants,
        )
        .await
        .map_err(|error| anyhow::anyhow!("failed to ensure imported channel: {error:?}"))?;
    Ok(ensured.id)
}
