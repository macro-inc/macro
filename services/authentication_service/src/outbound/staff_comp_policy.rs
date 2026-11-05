//! Adapt shared verified-admin eligibility to the computer comp policy.

use hosted_runtimes::domain::ports::CompPolicy;
use team_agents::domain::{
    included::{INCLUDED_REASON, is_included_team},
    models::TeamAgentError,
    ports::{TeamAgentRepository, TeamMembership},
};
use uuid::Uuid;

/// Team eligibility shared by agent seats and direct computer purchases.
pub struct MacroStaffCompPolicy<R, M> {
    repository: R,
    membership: M,
    domain: String,
}

impl<R, M> MacroStaffCompPolicy<R, M> {
    pub fn new(repository: R, membership: M, domain: String) -> Self {
        Self {
            repository,
            membership,
            domain,
        }
    }
}

impl<R: TeamAgentRepository, M: TeamMembership> CompPolicy for MacroStaffCompPolicy<R, M> {
    type Err = TeamAgentError;

    async fn comp_reason(&self, team_id: Uuid) -> Result<Option<String>, Self::Err> {
        Ok(
            is_included_team(&self.repository, &self.membership, team_id, &self.domain)
                .await?
                .then(|| INCLUDED_REASON.to_owned()),
        )
    }
}
