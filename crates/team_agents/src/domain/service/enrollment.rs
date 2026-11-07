//! One-time bootstrap issuance; the fleet owns claimed-generation fencing.

use std::collections::BTreeMap;

use hosted_runtimes::domain::{
    ids::ComputerId,
    persona_credentials::{
        EnrollmentGeneration, PersonaCredentialError, PersonaCredentials, PersonaEnrollment,
    },
    ports::PersonaCredentialSource,
};

use super::{TeamAgentServiceImpl, config_keys};
use crate::domain::{
    enrollment::{EnrollmentAccounts, EnrollmentComputers},
    models::PersonaConfigKey,
    ports::{AgentApiKeys, AgentRepos},
};

impl<R, M, K, I, C, G, F> PersonaCredentialSource for TeamAgentServiceImpl<R, M, K, I, C, G, F>
where
    R: EnrollmentAccounts,
    M: Send + Sync + 'static,
    K: AgentApiKeys,
    I: Send + Sync + 'static,
    C: EnrollmentComputers,
    G: AgentRepos,
    F: Send + Sync + 'static,
{
    #[tracing::instrument(name = "team_agents.enrollment.issue", skip_all, fields(%computer, generation = generation.get()), err)]
    async fn issue(
        &self,
        computer: ComputerId,
        generation: EnrollmentGeneration,
    ) -> Result<PersonaEnrollment, PersonaCredentialError> {
        let saved = self.computers.enrollment_computer(computer).await?;
        let candidate = saved
            .persona
            .as_ref()
            .and_then(|p| p.config.get(config_keys::AGENT_USER_ID))
            .map(|id| {
                macro_user_id::user_id::MacroUserIdStr::parse_from_str(id)
                    .map_err(|_| PersonaCredentialError::NotFound)
            })
            .transpose()?;
        let context = self
            .repository
            .enrollment_context(computer, candidate.as_ref(), saved.team_id)
            .await?;
        // Refresh generation after the account lock, so a delayed request cannot
        // rotate credentials for a newer guest.
        let saved = self.computers.enrollment_computer(computer).await?;
        if saved.enrollment_generation != generation {
            return Err(PersonaCredentialError::NotFound);
        }
        if saved.persona.is_none() && context.agent.is_none() {
            return Ok(PersonaEnrollment::default());
        }
        let persona = saved
            .persona
            .as_ref()
            .ok_or(PersonaCredentialError::NotFound)?;
        let agent = context
            .agent
            .as_ref()
            .ok_or(PersonaCredentialError::NotFound)?;
        if !agent.is_agent
            || agent.team_id != saved.team_id
            || persona
                .config
                .get(config_keys::AGENT_USER_ID)
                .map(String::as_str)
                != Some(agent.user_id.as_ref())
            || !lazy_regex::regex_is_match!(
                r"^agent-[a-z0-9][a-z0-9_-]{0,24}$",
                persona.os_user.as_str()
            )
        {
            return Err(PersonaCredentialError::NotFound);
        }
        // Resolve before rotating credentials, so invalid deployment config has no effects.
        let environment = self
            .enrollment_environment
            .as_ref()
            .ok_or(PersonaCredentialError::Unavailable)?;
        let mut env = environment.environment()?.as_map().clone();
        // Hold context.guard across BOTH providers. replace_key and create_repo
        // store only hashes and revoke the previous bootstrap credentials.
        let api_key = self
            .api_keys
            .mint(&agent.user_id)
            .await
            .map_err(|_| PersonaCredentialError::IssuanceFailed)?;
        let repo = self
            .repos
            .create(&agent.user_id, agent.team_id, &agent.seed)
            .await
            .map_err(|_| PersonaCredentialError::IssuanceFailed)?;
        env.insert(
            PersonaConfigKey::parse(config_keys::REPO_URL)?,
            repo.url.clone(),
        );
        let env = hosted_runtimes::domain::persona_credentials::PersonaEnv::new(env)?;
        let secrets = PersonaCredentials::new(BTreeMap::from([
            (
                PersonaConfigKey::parse(config_keys::API_KEY)?,
                api_key.expose().to_owned(),
            ),
            (
                PersonaConfigKey::parse(config_keys::ANTHROPIC_AUTH_TOKEN)?,
                api_key.expose().to_owned(),
            ),
            (
                PersonaConfigKey::parse(config_keys::REPO_TOKEN)?,
                repo.token.expose().to_owned(),
            ),
        ]))?;
        self.repository
            .finish_enrollment(context.guard, computer, &agent.user_id)
            .await?;
        Ok(PersonaEnrollment { secrets, env })
    }
}
