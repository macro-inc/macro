use serde::{Deserialize, Serialize};

use crate::ids::{AppId, BotId, EnterpriseId, TeamId, UserId};

/// A Slack user. External (Slack Connect) users come with a partial profile,
/// their own `team_id`, and `is_stranger` when they share no channel with you.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct User {
    /// The user.
    pub id: UserId,
    /// The user's home workspace, which differs from yours for external users.
    #[serde(default, deserialize_with = "crate::ids::empty_as_none")]
    pub team_id: Option<TeamId>,
    /// The handle.
    #[serde(default)]
    pub name: String,
    /// Deactivated.
    #[serde(default)]
    pub deleted: bool,
    /// Full name.
    pub real_name: Option<String>,
    /// IANA time zone.
    pub tz: Option<String>,
    /// Profile fields.
    #[serde(default)]
    pub profile: UserProfile,
    /// A bot user.
    #[serde(default)]
    pub is_bot: bool,
    /// An app user.
    #[serde(default)]
    pub is_app_user: bool,
    /// Workspace admin.
    #[serde(default)]
    pub is_admin: bool,
    /// Workspace owner.
    #[serde(default)]
    pub is_owner: bool,
    /// Multi-channel guest.
    #[serde(default)]
    pub is_restricted: bool,
    /// Single-channel guest.
    #[serde(default)]
    pub is_ultra_restricted: bool,
    /// An external user who shares no conversation with the caller.
    #[serde(default)]
    pub is_stranger: bool,
    /// Present on Enterprise Grid.
    pub enterprise_user: Option<EnterpriseUser>,
    /// Last profile change (unix seconds), for cache invalidation.
    pub updated: Option<i64>,
}

/// A user's profile.
#[derive(Clone, Debug, Default, PartialEq, Deserialize, Serialize)]
pub struct UserProfile {
    /// Display name; empty when the user never set one.
    #[serde(default)]
    pub display_name: String,
    /// Full name.
    #[serde(default)]
    pub real_name: String,
    /// First name.
    pub first_name: Option<String>,
    /// Last name.
    pub last_name: Option<String>,
    /// Job title.
    pub title: Option<String>,
    /// Email; hidden for most external users.
    pub email: Option<String>,
    /// Status text.
    pub status_text: Option<String>,
    /// Status emoji (`:palm_tree:`).
    pub status_emoji: Option<String>,
    /// Avatar hash, changes with the avatar.
    pub avatar_hash: Option<String>,
    /// 72px avatar.
    pub image_72: Option<String>,
    /// 192px avatar.
    pub image_192: Option<String>,
    /// 512px avatar.
    pub image_512: Option<String>,
    /// Original avatar upload.
    pub image_original: Option<String>,
    /// The profile's team.
    #[serde(default, deserialize_with = "crate::ids::empty_as_none")]
    pub team: Option<TeamId>,
    /// The bot behind a bot user.
    #[serde(default, deserialize_with = "crate::ids::empty_as_none")]
    pub bot_id: Option<BotId>,
}

/// Grid membership of a user.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct EnterpriseUser {
    /// The user's org-wide id.
    #[serde(default, deserialize_with = "crate::ids::empty_as_none")]
    pub id: Option<UserId>,
    /// The org.
    #[serde(default, deserialize_with = "crate::ids::empty_as_none")]
    pub enterprise_id: Option<EnterpriseId>,
    /// The org's name.
    pub enterprise_name: Option<String>,
    /// Workspaces in the org the user belongs to.
    #[serde(default)]
    pub teams: Vec<TeamId>,
}

/// A bot's profile, embedded in bot messages.
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct BotProfile {
    /// The bot.
    pub id: BotId,
    /// The bot's app.
    #[serde(default, deserialize_with = "crate::ids::empty_as_none")]
    pub app_id: Option<AppId>,
    /// Display name.
    #[serde(default)]
    pub name: String,
    /// The bot's workspace.
    #[serde(default, deserialize_with = "crate::ids::empty_as_none")]
    pub team_id: Option<TeamId>,
    /// Deactivated.
    #[serde(default)]
    pub deleted: bool,
}

/// A workspace (`team.info`, `client.userBoot`'s `team`).
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
pub struct Team {
    /// The workspace.
    pub id: TeamId,
    /// Name.
    #[serde(default)]
    pub name: String,
    /// `acme` in `acme.slack.com`.
    #[serde(default)]
    pub domain: String,
    /// Web URL.
    pub url: Option<String>,
    /// The Grid org, if any.
    #[serde(default, deserialize_with = "crate::ids::empty_as_none")]
    pub enterprise_id: Option<EnterpriseId>,
    /// The Grid org's name.
    pub enterprise_name: Option<String>,
    /// Icon.
    pub icon: Option<TeamIcon>,
}

/// A workspace icon.
#[derive(Clone, Debug, Default, PartialEq, Deserialize, Serialize)]
pub struct TeamIcon {
    /// 88px.
    pub image_88: Option<String>,
    /// 230px.
    pub image_230: Option<String>,
    /// Original.
    pub image_original: Option<String>,
    /// No custom icon.
    #[serde(default)]
    pub image_default: bool,
}
