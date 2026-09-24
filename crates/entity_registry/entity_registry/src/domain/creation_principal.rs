//! Who an authenticated caller creates entities as.
//!
//! Resolving a creation principal decides the recorded owner. It does not
//! grant access; [`super::owner_grant_policy`] expands the owner into grants.

#[cfg(test)]
mod test;

use bot_id::NonSystemBotId;
use macro_authorization::{BotAuthentication, BotScope, MacroAuthorization};
use model_owner::CreationPrincipal;

/// Whether a creation may be owned by something other than a user.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum NonUserOwners {
    /// Every creation is owned by a user.
    Disabled,
    /// A team-scoped bot with no acting user owns what it creates.
    Enabled,
}

/// Why a caller cannot create entities.
#[derive(Clone, Copy, Debug, Eq, PartialEq, thiserror::Error)]
pub enum CreationPrincipalError {
    /// A system bot has no sponsor, so it must act for a user.
    #[error("a system bot must act for a user")]
    SystemBotWithoutUser,
    /// A user-scoped bot must act for a user.
    #[error("a user-scoped bot must act for a user")]
    UserScopeWithoutUser,
    /// A team-scoped bot must belong to a verified team.
    #[error("a team-scoped bot has no verified team")]
    MissingTeam,
    /// Bot ownership is not enabled.
    #[error("non-user owners are disabled")]
    NonUserOwnersDisabled,
    /// An internal caller must act for a user.
    #[error("an internal caller must act for a user")]
    InternalWithoutUser,
    /// A harness cannot create entities.
    #[error("a harness cannot create entities")]
    Harness,
}

/// Resolve who `authorization` creates entities as.
///
/// A verified acting user always owns the result. Only a non-system bot in
/// team scope with a verified team and no acting user owns what it creates,
/// and only while `non_user_owners` is enabled.
pub fn resolve_creation_principal(
    authorization: &MacroAuthorization,
    non_user_owners: NonUserOwners,
) -> Result<CreationPrincipal, CreationPrincipalError> {
    match authorization {
        MacroAuthorization::User(user) | MacroAuthorization::Internal(Some(user)) => {
            Ok(CreationPrincipal::User(user.macro_user_id.clone()))
        }
        MacroAuthorization::Bot(bot) => resolve_bot(bot, non_user_owners),
        MacroAuthorization::Internal(None) => Err(CreationPrincipalError::InternalWithoutUser),
        MacroAuthorization::Harness(_) => Err(CreationPrincipalError::Harness),
    }
}

fn resolve_bot(
    bot: &BotAuthentication,
    non_user_owners: NonUserOwners,
) -> Result<CreationPrincipal, CreationPrincipalError> {
    if let Some(user) = &bot.acting_user {
        return Ok(CreationPrincipal::BotForUser {
            bot: bot.bot_id,
            user: user.macro_user_id.clone(),
        });
    }
    let owner =
        NonSystemBotId::new(bot.bot_id).ok_or(CreationPrincipalError::SystemBotWithoutUser)?;
    match (bot.bot_scope, bot.team_id, non_user_owners) {
        (BotScope::User, _, _) => Err(CreationPrincipalError::UserScopeWithoutUser),
        (BotScope::Team, None, _) => Err(CreationPrincipalError::MissingTeam),
        (BotScope::Team, Some(_), NonUserOwners::Disabled) => {
            Err(CreationPrincipalError::NonUserOwnersDisabled)
        }
        (BotScope::Team, Some(team), NonUserOwners::Enabled) => {
            Ok(CreationPrincipal::TeamBot { bot: owner, team })
        }
    }
}
