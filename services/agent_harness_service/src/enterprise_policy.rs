//! Composition of team membership with enterprise runtime admission.

use enterprise::domain::{EnterpriseError, Result, RuntimePolicy, TeamDirectory};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use teams::{domain::team_repo::TeamRepository, outbound::team_repo::TeamRepositoryImpl};
use uuid::Uuid;

#[derive(Clone)]
pub(crate) struct EnterpriseTeams(TeamRepositoryImpl);

impl TeamDirectory for EnterpriseTeams {
    async fn team_ids(&self, user: MacroUserIdStr<'static>) -> Result<Vec<Uuid>> {
        self.0
            .get_user_teams(&user)
            .await
            .map(|teams| teams.into_iter().map(|team| *team.id()).collect())
            .map_err(|error| EnterpriseError::Storage(anyhow::Error::new(error)))
    }
}

/// Production agent-session admission over MacroDB and the owning teams repository.
pub fn runtime_policy(
    pool: PgPool,
) -> RuntimePolicy<enterprise::outbound::PgEnterpriseRepository, EnterpriseTeams> {
    RuntimePolicy::new(
        enterprise::outbound::PgEnterpriseRepository::new(pool.clone()),
        EnterpriseTeams(TeamRepositoryImpl::new(pool)),
    )
}
