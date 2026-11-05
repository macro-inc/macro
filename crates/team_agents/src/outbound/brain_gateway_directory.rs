//! Key-owner, account and membership facts for brain gateway authorization.

use macro_authorization::domain::ports::UserApiKeyAuthorizer;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use teams::domain::team_repo::TeamRepository;

use crate::domain::{
    gateway::{BrainGatewayAccount, BrainGatewayDirectory, BrainGatewayError},
    models::Credential,
    ports::TeamAgentRepository,
};

/// Reads facts through the owning key, team-agent and team domain ports.
pub struct BrainGatewayDirectoryAdapter<Keys, Agents, Teams> {
    keys: Keys,
    agents: Agents,
    teams: Teams,
}

impl<Keys, Agents, Teams> BrainGatewayDirectoryAdapter<Keys, Agents, Teams> {
    /// Shares the repositories and standard revocable user-key authorizer.
    pub fn new(keys: Keys, agents: Agents, teams: Teams) -> Self {
        Self {
            keys,
            agents,
            teams,
        }
    }
}

impl<Keys: UserApiKeyAuthorizer, Agents: TeamAgentRepository, Teams: TeamRepository>
    BrainGatewayDirectory for BrainGatewayDirectoryAdapter<Keys, Agents, Teams>
{
    #[tracing::instrument(skip_all, err)]
    async fn lookup(
        &self,
        key: &Credential,
    ) -> Result<Option<BrainGatewayAccount>, BrainGatewayError> {
        let Ok(owner) = self.keys.authorize_user_api_key(key.expose()).await else {
            return Ok(None);
        };
        let user_id = MacroUserIdStr::parse_from_str(&owner.user_id)
            .map_err(|_| BrainGatewayError::Unauthorized)?
            .into_owned();
        let agent = self
            .agents
            .get(&user_id)
            .await
            .map_err(|_| BrainGatewayError::Unavailable)?;
        let teams = self
            .teams
            .get_user_teams(&user_id)
            .await
            .map_err(|_| BrainGatewayError::Unavailable)?
            .into_iter()
            .map(|team| *team.id())
            .collect();
        Ok(Some(BrainGatewayAccount {
            user_id,
            agent,
            teams,
        }))
    }
}
