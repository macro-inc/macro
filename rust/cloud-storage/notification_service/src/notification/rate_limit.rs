use anyhow::Context;
use macro_cache_client::MacroCache;
use model_notifications::{Notification, NotificationEventType};

/// Performs a basic rate limit check on the notification
/// If this returns false, the notification can proceed
/// If this returns true, the notification should be skipped.
#[tracing::instrument(skip(macro_cache_client, notification), fields(notification_id=?notification.id, notification_event_type=?notification.notification_event.event_type(), event_item_id=?notification.notification_entity.event_item_id, event_item_type=?notification.notification_entity.event_item_type, sender_id=?notification.sender_id))]
pub async fn rate_limit(
    macro_cache_client: &MacroCache,
    notification: &Notification,
) -> anyhow::Result<bool> {
    match notification.notification_event.event_type() {
        NotificationEventType::ChannelInvite => {
            tracing::trace!("rate limit channel invite");
            let sender_id = notification
                .sender_id
                .as_ref()
                .context("expected sender id to be present in channel invite notification")?;

            let email = sender_id.replace("macro|", "");

            let channel_invite_rate_limit = macro_cache_client
                .get_channel_invite_rate_limit(&email)
                .await
                .context("unable to get channel invite rate limit")?;

            if let Some(channel_invite_rate_limit) = channel_invite_rate_limit
                && channel_invite_rate_limit >= 10
            {
                tracing::error!(email=%email, "rate limit channel invite exceeded");
                return Ok(true);
            }

            tracing::trace!("incrementing channel invite rate limit");
            macro_cache_client
                .increment_channel_invite_rate_limit(&email, 3600) // 1 hour
                .await
                .context("unable to increment channel invite rate limit")?;

            // Return false so we do not silently kill the notification
            Ok(false)
        }
        NotificationEventType::InviteToTeam => {
            tracing::trace!("rate limit invite to team");
            let sender_id = notification
                .sender_id
                .as_ref()
                .context("expected sender id to be present in invite to team notification")?;

            let email = sender_id.replace("macro|", "");

            let invite_to_team_rate_limit = macro_cache_client
                .get_invite_to_team_rate_limit(&email)
                .await
                .context("unable to get invite to team rate limit")?;

            if let Some(invite_to_team_rate_limit) = invite_to_team_rate_limit
                && invite_to_team_rate_limit >= 5
            {
                tracing::error!(email=%email, "rate limit invite to team exceeded");
                return Ok(true);
            }

            tracing::trace!("incrementing invite to team rate limit");
            macro_cache_client
                .increment_invite_to_team_rate_limit(&email, 3600) // 1 hour
                .await
                .context("unable to increment invite to team rate limit")?;

            Ok(false)
        }
        _ => return Ok(false), // No rate limit by default
    }
}
