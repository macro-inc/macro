//! Composition-root adapters for `agent_permissions`: who may edit an agent
//! comes from the bots service's own rule, an agent's owner and identity
//! (a deleted one's included) from the bots repository, and a session's agent
//! and owner from the session repo, so neither domain crate depends on the
//! other.

use agent_permissions::domain::model::{
    AgentAccess, AgentFacts, AgentOwner, AgentScope, SessionFacts, TeamFacts, TeamRole,
};
use agent_permissions::domain::ports::{AgentDirectory, SessionDirectory, TeamDirectory};
use agent_session::domain::error::AgentSessionError;
use agent_session::domain::model::{AgentSessionId, session_owner_user};
use agent_session::domain::ports::AgentSessionRepo;
use bot_id::BotId;
use bots::domain::models::BotOwner;
use bots::domain::ports::{BotError, BotRepo, BotService};
use macro_user_id::user_id::MacroUserIdStr;

/// [`AgentDirectory`] over the bots service: whoever may edit the agent
/// (`manageable_agent`) may edit its permissions. The repository says who
/// owns an agent and how it is shown, after it was deleted too.
pub struct BotsAgentDirectory<Bots, Repo>(pub Bots, pub Repo);

/// The bots service could not tell.
#[derive(Debug, thiserror::Error)]
#[error("could not look up the agent: {0}")]
pub struct AgentLookupError(String);

fn agent_owner(owner: &BotOwner) -> Result<AgentOwner, AgentLookupError> {
    match owner {
        BotOwner::User { user_id } => MacroUserIdStr::try_from(user_id.clone())
            .map(AgentOwner::User)
            .map_err(|_| AgentLookupError("an agent's owner is not a user id".to_owned())),
        BotOwner::Team { team_id } => Ok(AgentOwner::Team(*team_id)),
    }
}

impl<Bots, Repo> AgentDirectory for BotsAgentDirectory<Bots, Repo>
where
    Bots: BotService + Send + Sync + 'static,
    Repo: BotRepo,
{
    type Err = AgentLookupError;

    async fn access(
        &self,
        user: &MacroUserIdStr<'static>,
        agent: BotId,
    ) -> Result<AgentAccess, AgentLookupError> {
        match self.0.manageable_agent(user.clone(), agent).await {
            Ok(_) => Ok(AgentAccess::Manageable),
            Err(BotError::Unauthorized) => Ok(AgentAccess::NotManageable),
            Err(BotError::NotFound(_)) => Ok(AgentAccess::NotFound),
            Err(error) => Err(AgentLookupError(error.to_string())),
        }
    }

    async fn facts(&self, agent: BotId) -> Result<Option<AgentFacts>, AgentLookupError> {
        let lookup =
            |error: Repo::Err| AgentLookupError(Into::<anyhow::Error>::into(error).to_string());
        let Some(profile) = self
            .1
            .get_owner_profiles(&[agent])
            .await
            .map_err(lookup)?
            .remove(&agent)
        else {
            return Ok(None);
        };
        // A registry system bot has no owner: not an owned agent.
        let Some(owner) = profile.owner.as_ref() else {
            return Ok(None);
        };
        let deleted = profile.deleted_at.is_some();
        // The handle is read from the live row; a deleted agent shows its
        // name only.
        let handle = if deleted {
            None
        } else {
            self.1
                .get_bot(agent)
                .await
                .map_err(lookup)?
                .map(|bot| bot.handle)
        };
        Ok(Some(AgentFacts {
            id: agent,
            owner: agent_owner(owner)?,
            name: profile.name,
            handle,
            avatar_url: profile.avatar_url,
            deleted,
        }))
    }

    async fn source_candidates(
        &self,
        user: &MacroUserIdStr<'static>,
        scope: &AgentScope,
    ) -> Result<Vec<AgentFacts>, AgentLookupError> {
        // The agents the person may edit: their own and their teams'.
        let agents = self
            .0
            .list_agents(user.clone())
            .await
            .map_err(|error| AgentLookupError(error.to_string()))?;
        let mut candidates = Vec::with_capacity(agents.len());
        for agent in agents {
            let bot = agent.bot;
            let Some(owner) = bot.owner.as_ref() else {
                continue;
            };
            let owner = agent_owner(owner)?;
            let in_scope = match (scope, &owner) {
                (AgentScope::Private(_), _) => true,
                (AgentScope::Team(team), AgentOwner::Team(owner)) => team == owner,
                (AgentScope::Team(_), AgentOwner::User(_)) => false,
            };
            if in_scope && bot.deleted_at.is_none() {
                candidates.push(AgentFacts {
                    id: bot.id,
                    owner,
                    name: bot.name,
                    handle: Some(bot.handle),
                    avatar_url: bot.avatar_url,
                    deleted: false,
                });
            }
        }
        Ok(candidates)
    }
}

/// [`SessionDirectory`] over the agent session repo.
pub struct RepoSessionDirectory<Repo>(pub Repo);

impl<Repo: AgentSessionRepo> SessionDirectory for RepoSessionDirectory<Repo> {
    type Err = AgentSessionError;

    async fn facts(
        &self,
        session: AgentSessionId,
    ) -> Result<Option<SessionFacts>, AgentSessionError> {
        let Some(session) = self.0.find(session).await? else {
            return Ok(None);
        };
        Ok(Some(SessionFacts {
            agent: session.bot_id,
            owner: session_owner_user(&session.owner_id)?,
        }))
    }
}

/// [`TeamDirectory`] over the teams repository: a person's role, their teams
/// and a team's name.
pub struct RepoTeamDirectory<Teams>(pub Teams);

/// The teams repository could not tell.
#[derive(Debug, thiserror::Error)]
#[error("could not look up the team: {0}")]
pub struct TeamLookupError(String);

fn team_lookup(error: teams::domain::model::TeamError) -> TeamLookupError {
    TeamLookupError(error.to_string())
}

impl<Teams> TeamDirectory for RepoTeamDirectory<Teams>
where
    Teams: teams::domain::team_repo::TeamRepository,
{
    type Err = TeamLookupError;

    async fn role(
        &self,
        user: &MacroUserIdStr<'static>,
        team: macro_uuid::Uuid,
    ) -> Result<Option<TeamRole>, TeamLookupError> {
        use teams::domain::model::TeamRole as Role;
        Ok(self
            .0
            .get_team_role(&team, user)
            .await
            .map_err(team_lookup)?
            .map(|role| match role {
                Role::Member => TeamRole::Member,
                Role::Admin => TeamRole::Admin,
                Role::Owner => TeamRole::Owner,
            }))
    }

    async fn teams(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> Result<Vec<TeamFacts>, TeamLookupError> {
        Ok(self
            .0
            .get_user_teams(user)
            .await
            .map_err(team_lookup)?
            .iter()
            .map(|team| TeamFacts {
                id: *team.id(),
                name: team.name().to_owned(),
            })
            .collect())
    }

    async fn team(&self, team: macro_uuid::Uuid) -> Result<Option<TeamFacts>, TeamLookupError> {
        match self.0.get_team_name(&team).await {
            Ok(name) => Ok(Some(TeamFacts { id: team, name })),
            Err(teams::domain::model::TeamError::TeamDoesNotExist) => Ok(None),
            Err(error) => Err(team_lookup(error)),
        }
    }
}
