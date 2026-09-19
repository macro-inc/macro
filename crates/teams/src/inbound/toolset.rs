//! Toolset inbound adapter for teams.

mod list_team_members;

#[cfg(test)]
mod test;

use crate::domain::team_repo::TeamMembersService;
use ai_toolset::AsyncToolCollection;
use entity_access::domain::ports::EntityAccessService;
use list_team_members::ListTeamMembers;
use std::sync::Arc;

/// Service context for team AI tools.
pub struct TeamToolContext<TSvc, ESvc>
where
    TSvc: TeamMembersService,
    ESvc: EntityAccessService,
{
    /// The team service used to read team membership data.
    pub service: Arc<TSvc>,
    /// The entity access service used to resolve the caller's team membership.
    pub entity_access_service: Arc<ESvc>,
}

impl<TSvc, ESvc> Clone for TeamToolContext<TSvc, ESvc>
where
    TSvc: TeamMembersService,
    ESvc: EntityAccessService,
{
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
        }
    }
}

impl<TSvc, ESvc> TeamToolContext<TSvc, ESvc>
where
    TSvc: TeamMembersService,
    ESvc: EntityAccessService,
{
    /// Create a new team tool context.
    pub fn new(service: TSvc, entity_access_service: ESvc) -> Self {
        Self {
            service: Arc::new(service),
            entity_access_service: Arc::new(entity_access_service),
        }
    }
}

/// Create a team toolset.
pub fn team_toolset<TSvc, ESvc>() -> AsyncToolCollection<TeamToolContext<TSvc, ESvc>>
where
    TSvc: TeamMembersService,
    ESvc: EntityAccessService,
{
    AsyncToolCollection::new().add_tool::<ListTeamMembers, TeamToolContext<TSvc, ESvc>>()
}
