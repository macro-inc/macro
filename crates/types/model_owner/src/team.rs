//! Team-link audience policy. Resolving an audience never confers ownership.
//!
//! PostgreSQL's `owner_team` is the set-based implementation of this policy;
//! adapter tests check it against this function for every owner kind.

use uuid::Uuid;

use crate::Owner;

#[cfg(test)]
mod test;

/// Repository-derived membership and bot ownership facts, not caller-supplied teams.
#[derive(Debug, Default, Clone, Copy)]
pub struct OwnerTeamFacts {
    /// The user's membership for a user owner.
    pub user_team: Option<Uuid>,
    /// The bot's explicit team, if it is team-owned.
    pub bot_team: Option<Uuid>,
    /// The owning user's membership, if the bot is user-owned.
    pub bot_user_team: Option<Uuid>,
}

/// Resolve the team-link audience for a typed owner.
///
/// Users retain their current membership; teams are their own audience. A bot's
/// explicit team takes precedence over its owning user's membership. Missing
/// bots and teamless users have no audience. This does not authorize share edits.
#[must_use]
pub fn owner_team(owner: &Owner, facts: OwnerTeamFacts) -> Option<Uuid> {
    match owner {
        Owner::User(_) => facts.user_team,
        Owner::Team(team) => Some(*team),
        Owner::Bot(_) => facts.bot_team.or(facts.bot_user_team),
    }
}
