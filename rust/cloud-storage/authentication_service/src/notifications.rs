//! Notification types for the authentication service.

use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::models::{Notification, RateLimitConfig, RateLimitKey};
use serde::{Deserialize, Serialize};

/// Notification sent when a user is invited to a team.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InviteToTeamNotification {
    /// The user who sent the invitation.
    pub invited_by: MacroUserIdStr<'static>,
    /// The name of the team being invited to.
    pub team_name: String,
    /// The unique identifier of the team.
    pub team_id: String,
    /// Role/permission level in the team (optional).
    pub role: Option<String>,
}

impl Notification for InviteToTeamNotification {
    const TYPE_NAME: &'static str = "invite_to_team";

    fn rate_limit_config() -> Option<RateLimitConfig> {
        None
    }

    fn rate_limit_key(&self) -> Option<RateLimitKey> {
        None
    }
}
