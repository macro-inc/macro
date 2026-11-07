//! Archive-only attribution. No roster lookup, contact sync, or email alias normalization.

use std::{collections::BTreeMap, str::FromStr};

use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};

use crate::domain::models::{SlackUserId, ValidationError};

use super::export::MessageContent;

#[cfg(test)]
mod test;

/// Both files contain arrays of `ExportUser`, normalized into one directory.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum UsersFile {
    /// Standard or corporate workspace directory.
    Users,
    /// Enterprise directory (including W-prefixed identities).
    OrgUsers,
}

impl FromStr for UsersFile {
    type Err = ValidationError;

    fn from_str(name: &str) -> Result<Self, Self::Err> {
        match name {
            "users.json" => Ok(Self::Users),
            "org_users.json" => Ok(Self::OrgUsers),
            _ => Err(ValidationError::InvalidId),
        }
    }
}

/// Shared subset of root and per-message user profiles; unknown fields are ignored.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize, Serialize)]
pub struct UserProfile {
    /// Raw source email; only lowercased, never canonicalized.
    pub email: Option<String>,
    /// Preferred nonempty display name.
    pub display_name: Option<String>,
    /// Fallback full name.
    pub real_name: Option<String>,
}

impl UserProfile {
    fn display_name(&self) -> Option<&str> {
        nonempty(self.display_name.as_deref()).or_else(|| nonempty(self.real_name.as_deref()))
    }

    fn macro_user(&self) -> Option<MacroUserIdStr<'static>> {
        // This constructor validates and lowercases without stripping dots/plus aliases.
        MacroUserIdStr::try_from_email(self.email.as_deref()?).ok()
    }
}

/// User record from either supported users filename.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, Serialize)]
pub struct ExportUser {
    /// Slack-local identity; missing directory entries are not invalid message authors.
    pub id: SlackUserId,
    /// Source username.
    pub name: Option<String>,
    /// Legacy top-level full name.
    pub real_name: Option<String>,
    /// Missing/null profiles are common for phantom users.
    pub profile: Option<UserProfile>,
    /// Bot accounts do not become human participants.
    #[serde(default)]
    pub is_bot: bool,
}

impl ExportUser {
    fn display_name(&self) -> Option<&str> {
        self.profile
            .as_ref()
            .and_then(UserProfile::display_name)
            .or_else(|| nonempty(self.real_name.as_deref()))
            .or_else(|| nonempty(self.name.as_deref()))
    }

    fn is_system_author(&self) -> bool {
        self.is_bot || self.id.as_str() == "USLACKBOT"
    }
}

/// Attribution decision. The worker materializes `SystemBot` with
/// `bot_id::MACRO_SYSTEM_BOT_ID`; the parser neither hardcodes nor configures a bot ID.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ResolvedAuthor {
    /// Lowercase raw-email Macro identity, without imported_author.
    User(MacroUserIdStr<'static>),
    /// System-bot sender with the source name retained for imported_author.
    SystemBot {
        /// Slack display/username or source ID when no name is available.
        imported_author: String,
    },
}

/// Bounded by the users payload, not message history. Duplicate emails are allowed;
/// they deliberately resolve to the same Macro identity.
#[derive(Debug, Clone, Default)]
pub struct UserDirectory {
    users: BTreeMap<SlackUserId, ExportUser>,
}

impl UserDirectory {
    /// Combine decoded users/org_users records. Identical repeated IDs are accepted;
    /// conflicting records fail rather than choosing attribution by file order.
    pub fn new(users: impl IntoIterator<Item = ExportUser>) -> Result<Self, ValidationError> {
        let mut directory = Self::default();
        for user in users {
            if let Some(existing) = directory.users.get(&user.id) {
                if existing != &user {
                    return Err(ValidationError::InvalidId);
                }
            } else {
                directory.users.insert(user.id.clone(), user);
            }
        }
        Ok(directory)
    }

    /// Display name for source membership labels, including no-email/unknown members.
    pub fn display_name<'a>(&'a self, id: &'a SlackUserId) -> &'a str {
        self.users
            .get(id)
            .and_then(ExportUser::display_name)
            .unwrap_or_else(|| id.as_str())
    }

    /// Resolve a member/reactor without inventing an email or consulting a roster.
    pub fn participant(&self, id: &SlackUserId) -> Option<MacroUserIdStr<'static>> {
        let user = self.users.get(id)?;
        if user.is_system_author() {
            return None;
        }
        user.profile.as_ref()?.macro_user()
    }

    /// DMs require exactly two source members and two distinct mapped identities.
    /// Missing email, bots and duplicate-email pairs are unsupported, not invitations
    /// to substitute the importing administrator.
    pub fn direct_message_members(
        &self,
        members: &[SlackUserId],
    ) -> Option<[MacroUserIdStr<'static>; 2]> {
        let [first, second] = members else {
            return None;
        };
        let first = self.participant(first)?;
        let second = self.participant(second)?;
        (first != second).then_some([first, second])
    }

    /// Resolve a message author. Directory email takes precedence, then the embedded
    /// profile. Explicit bot_message and USLACKBOT always use the system bot, even
    /// when a payload contains a human user/profile email.
    pub fn author(&self, message: &MessageContent) -> ResolvedAuthor {
        let user = message.user.as_ref().and_then(|id| self.users.get(id));
        let is_bot = message.subtype.as_deref() == Some("bot_message")
            || message
                .user
                .as_ref()
                .is_some_and(|id| id.as_str() == "USLACKBOT")
            || user.is_some_and(ExportUser::is_system_author);
        if !is_bot {
            let mapped = message
                .user
                .as_ref()
                .and_then(|id| self.participant(id))
                .or_else(|| {
                    message
                        .user_profile
                        .as_ref()
                        .and_then(UserProfile::macro_user)
                });
            if let Some(mapped) = mapped {
                return ResolvedAuthor::User(mapped);
            }
        }
        let bot_name = if is_bot {
            nonempty(message.username.as_deref()).or_else(|| {
                message
                    .bot_profile
                    .as_ref()
                    .and_then(|profile| nonempty(profile.name.as_deref()))
            })
        } else {
            None
        };
        let name = bot_name
            .or_else(|| {
                message
                    .user_profile
                    .as_ref()
                    .and_then(UserProfile::display_name)
            })
            .or_else(|| user.and_then(ExportUser::display_name))
            .or_else(|| nonempty(message.username.as_deref()))
            .or_else(|| {
                message
                    .bot_profile
                    .as_ref()
                    .and_then(|profile| nonempty(profile.name.as_deref()))
            })
            .or_else(|| message.user.as_ref().map(SlackUserId::as_str))
            .unwrap_or("Unknown Slack author");
        ResolvedAuthor::SystemBot {
            imported_author: name.to_owned(),
        }
    }
}

fn nonempty(value: Option<&str>) -> Option<&str> {
    value.filter(|value| !value.trim().is_empty())
}
