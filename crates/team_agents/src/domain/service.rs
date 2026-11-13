//! The agent teammates service.

use std::collections::BTreeMap;

use entity_access::domain::models::{
    AdminTeamRole, EntityAccessReceipt, MemberTeamRole, RequiredPermission,
};
use feature_flags::FeatureFlags;
use hosted_runtimes::domain::{
    agent::{AgentEnrollment, AgentEnrollmentError, AgentEnv, AgentEnvKey},
    enrollment::EnrollmentGeneration,
};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::models::{
    AGENT_EMAIL_DOMAIN, ComputerId, ComputerPurchase, CreateTeamAgent, MAX_NAME_CHARS,
    MAX_PROFILE_CHARS, NewAgentAccount, PersonaSeed, TeamAgent, TeamAgentError, TeamAgentRecord,
    TeamAgentStatus, TeamAgents,
};
use super::ports::{
    AgentApiKeys, AgentRepos, Computers, EnrollmentEnvironment, TeamAgentRepository,
    TeamAgentService, TeamMembership,
};
use super::voice::AgentVoice;

#[cfg(test)]
mod test;

/// The PostHog flag for agent teammates, shared with the web app. Off, or
/// unreadable, means no agent teammates for that admin.
pub use agent_credentials::AGENT_TEAMMATES_FLAG;

/// Variables the brain reads from its enrollment, besides the addresses an
/// [`EnrollmentEnvironment`] supplies.
pub mod env_keys {
    /// The agent's Macro API key: the credential every Macro call uses.
    pub const API_KEY: &str = "MACRO_API_KEY";
    /// The agent's Macro user id.
    pub const AGENT_USER_ID: &str = "MACRO_AGENT_USER_ID";
    /// The agent's display name; its workspace commits carry it.
    pub const AGENT_NAME: &str = "MACRO_AGENT_NAME";
    /// The agent's team.
    pub const TEAM_ID: &str = "MACRO_TEAM_ID";
    /// The computer the brain runs on.
    pub const COMPUTER_ID: &str = "MACRO_COMPUTER_ID";
    /// The workspace repository's clone URL, without credentials.
    pub const REPO_URL: &str = "MACRO_REPO_URL";
    /// The workspace repository token (HTTP Basic password).
    pub const REPO_TOKEN: &str = "MACRO_REPO_TOKEN";
    /// The token Claude calls through Macro's Anthropic gateway with: the
    /// agent's API key, so usage is attributed to it.
    pub const ANTHROPIC_AUTH_TOKEN: &str = "ANTHROPIC_AUTH_TOKEN";
}

/// The agent teammates service, over its ports.
pub struct TeamAgentServiceImpl<Repository, Membership, ApiKeys, Repos, Computer, Flags> {
    repository: Repository,
    membership: Membership,
    api_keys: ApiKeys,
    repos: Repos,
    computers: Computer,
    flags: Option<Flags>,
    environment: Box<dyn EnrollmentEnvironment>,
}

impl<Repository, Membership, ApiKeys, Repos, Computer, Flags>
    TeamAgentServiceImpl<Repository, Membership, ApiKeys, Repos, Computer, Flags>
{
    /// Build the service. Without `flags`, agent teammates stay off.
    pub fn new(
        repository: Repository,
        membership: Membership,
        api_keys: ApiKeys,
        repos: Repos,
        computers: Computer,
        flags: Option<Flags>,
        environment: impl EnrollmentEnvironment,
    ) -> Self {
        Self {
            repository,
            membership,
            api_keys,
            repos,
            computers,
            flags,
            environment: Box::new(environment),
        }
    }
}

/// Lowercase ASCII letters and digits of `name`, joined by `-`, at most 24
/// characters; `agent` when nothing is left.
fn slug(name: &str) -> String {
    let mut slug = String::new();
    for word in name
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|word| !word.is_empty())
    {
        if !slug.is_empty() {
            slug.push('-');
        }
        slug.push_str(&word.to_ascii_lowercase());
    }
    slug.truncate(24);
    let slug = slug.trim_end_matches('-').to_owned();
    if slug.is_empty() {
        "agent".to_owned()
    } else {
        slug
    }
}

fn validate(request: CreateTeamAgent) -> Result<CreateTeamAgent, TeamAgentError> {
    let name = request.name.trim().to_owned();
    if name.is_empty() || name.chars().count() > MAX_NAME_CHARS {
        return Err(TeamAgentError::InvalidName);
    }
    let job_description = request.job_description.trim().to_owned();
    let personality = request.personality.trim().to_owned();
    for profile in [&job_description, &personality] {
        if profile.is_empty() || profile.chars().count() > MAX_PROFILE_CHARS {
            return Err(TeamAgentError::InvalidProfile);
        }
    }
    if let Some(avatar) = &request.avatar_url
        && !avatar.starts_with("https://")
    {
        return Err(TeamAgentError::InvalidAvatar);
    }
    Ok(CreateTeamAgent {
        purchase_key: request.purchase_key,
        name,
        job_description,
        personality,
        size: request.size,
        avatar_url: request.avatar_url,
        voice: request.voice,
    })
}

fn team_id<Permission: RequiredPermission>(
    receipt: &EntityAccessReceipt<Permission>,
) -> Result<Uuid, TeamAgentError> {
    Uuid::parse_str(&receipt.entity().entity_id).map_err(TeamAgentError::internal)
}

fn acting_user<Permission: RequiredPermission>(
    receipt: &EntityAccessReceipt<Permission>,
) -> Result<MacroUserIdStr<'static>, TeamAgentError> {
    receipt
        .acting_user_id()
        .cloned()
        .ok_or(TeamAgentError::NotEnabled)
}

/// The agent teammates rollout for `caller`. Fails closed: no flag provider,
/// a failed load or the flag off all refuse.
pub(crate) async fn ensure_enabled<Flags: FeatureFlags>(
    flags: Option<&Flags>,
    caller: &MacroUserIdStr<'_>,
) -> Result<(), TeamAgentError> {
    let Some(flags) = flags else {
        return Err(TeamAgentError::NotEnabled);
    };
    let enabled = flags
        .load(caller)
        .await
        .inspect_err(|error| {
            tracing::warn!(error = ?error, "could not load feature flags; agent teammates stay off");
        })
        .is_ok_and(|snapshot| snapshot.is_enabled(AGENT_TEAMMATES_FLAG));
    if enabled {
        Ok(())
    } else {
        Err(TeamAgentError::NotEnabled)
    }
}

fn env_entry(
    values: &mut BTreeMap<AgentEnvKey, String>,
    key: &str,
    value: String,
) -> Result<(), AgentEnrollmentError> {
    let key = AgentEnvKey::new(key).map_err(|_| AgentEnrollmentError::IssuanceFailed)?;
    values.insert(key, value);
    Ok(())
}

/// What a failed invite must take back, newest first.
#[derive(Default)]
struct Undo {
    account: Option<MacroUserIdStr<'static>>,
    joined_team: bool,
    repo: bool,
}

impl<Repository, Membership, ApiKeys, Repos, Computer, Flags>
    TeamAgentServiceImpl<Repository, Membership, ApiKeys, Repos, Computer, Flags>
where
    Repository: TeamAgentRepository,
    Membership: TeamMembership,
    ApiKeys: AgentApiKeys,
    Repos: AgentRepos,
    Computer: Computers,
    Flags: FeatureFlags + 'static,
{
    async fn ensure_enabled(&self, caller: &MacroUserIdStr<'_>) -> Result<(), TeamAgentError> {
        ensure_enabled(self.flags.as_ref(), caller).await
    }

    /// The receipt team's agent, or `NotFound`.
    async fn team_record(
        &self,
        receipt: &EntityAccessReceipt<AdminTeamRole>,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<TeamAgentRecord, TeamAgentError> {
        let team_id = team_id(receipt)?;
        self.repository
            .get(agent)
            .await
            .map_err(TeamAgentError::internal)?
            .filter(|record| record.team_id == team_id)
            .ok_or(TeamAgentError::NotFound)
    }

    async fn undo(&self, receipt: EntityAccessReceipt<AdminTeamRole>, undo: Undo) {
        let Some(agent) = &undo.account else {
            return;
        };
        if undo.repo {
            let _ = self.repos.delete(agent).await.inspect_err(|error| {
                tracing::error!(error = ?error, "could not delete a partly invited agent's repository");
            });
        }
        if undo.joined_team {
            let _ = self
                .membership
                .undo_add_agent(receipt, agent)
                .await
                .inspect_err(|error| {
                    tracing::error!(error = ?error, "could not take a partly invited agent off its team");
                });
        }
        let _ = self
            .repository
            .delete_account(agent)
            .await
            .inspect_err(|error| {
                tracing::error!(error = ?error, "could not delete a partly invited agent's account");
            });
    }

    /// Everything before the purchase, recording each step in `undo`.
    async fn prepare(
        &self,
        receipt: &EntityAccessReceipt<AdminTeamRole>,
        created_by: &MacroUserIdStr<'static>,
        request: &CreateTeamAgent,
        undo: &mut Undo,
    ) -> Result<(MacroUserIdStr<'static>, PersonaSeed), TeamAgentError> {
        let team_id = team_id(receipt)?;
        // A short suffix keeps two agents with the same name apart.
        let suffix: String = Uuid::now_v7()
            .simple()
            .to_string()
            .chars()
            .rev()
            .take(6)
            .collect();
        let email = format!("{}-{suffix}@{AGENT_EMAIL_DOMAIN}", slug(&request.name));
        let user_id = MacroUserIdStr::parse_from_str(&format!("macro|{email}"))
            .map_err(|_| TeamAgentError::InvalidName)?
            .into_owned();
        tracing::Span::current().record(
            "agent_user_id",
            tracing::field::display(agent_credentials::telemetry_id(user_id.as_ref())),
        );
        let seed = PersonaSeed {
            creator_id: Some(created_by.clone()),
            name: request.name.clone(),
            job_description: request.job_description.clone(),
            personality: request.personality.clone(),
            voice: request.voice.clone(),
        };

        self.repository
            .create_account(&NewAgentAccount {
                user_id: user_id.clone(),
                email,
                team_id,
                created_by: created_by.clone(),
                name: request.name.clone(),
                avatar_url: request.avatar_url.clone(),
                persona_seed: seed.clone(),
            })
            .await
            .map_err(TeamAgentError::internal)?;
        undo.account = Some(user_id.clone());

        self.membership.add_agent(receipt.clone(), &user_id).await?;
        undo.joined_team = true;

        self.repos.create(&user_id, team_id, &seed).await?;
        undo.repo = true;

        Ok((user_id, seed))
    }

    async fn team_agent(&self, record: TeamAgentRecord) -> Result<TeamAgent, TeamAgentError> {
        let computer_id = self
            .computers
            .computer_for_agent(record.team_id, &record.user_id)
            .await?;
        let status = match computer_id {
            Some(computer_id) => self
                .computers
                .state(record.team_id, computer_id)
                .await?
                .into(),
            // The account exists but its purchase never completed.
            None => TeamAgentStatus::Failed,
        };
        Ok(TeamAgent {
            user_id: record.user_id,
            team_id: record.team_id,
            name: record.persona_seed.name,
            job_description: record.persona_seed.job_description,
            personality: record.persona_seed.personality,
            created_by: record.created_by,
            computer_id,
            status,
            created_at: record.created_at,
        })
    }
}

impl<Repository, Membership, ApiKeys, Repos, Computer, Flags> TeamAgentService
    for TeamAgentServiceImpl<Repository, Membership, ApiKeys, Repos, Computer, Flags>
where
    Repository: TeamAgentRepository,
    Membership: TeamMembership,
    ApiKeys: AgentApiKeys,
    Repos: AgentRepos,
    Computer: Computers,
    Flags: FeatureFlags + 'static,
{
    #[tracing::instrument(
        name = "team_agents.create",
        skip_all,
        fields(team_id = %receipt.entity().entity_id, agent_user_id = tracing::field::Empty, computer_id = tracing::field::Empty),
        err
    )]
    async fn create(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        request: CreateTeamAgent,
    ) -> Result<TeamAgent, TeamAgentError> {
        let created_by = acting_user(&receipt)?;
        self.ensure_enabled(&created_by).await?;
        let request = validate(request)?;
        let team_id = team_id(&receipt)?;

        let mut undo = Undo::default();
        let (user_id, seed) = match self
            .prepare(&receipt, &created_by, &request, &mut undo)
            .await
        {
            Ok(prepared) => prepared,
            Err(error) => {
                self.undo(receipt, undo).await;
                return Err(error);
            }
        };

        let purchase = ComputerPurchase {
            purchase_key: request.purchase_key.clone(),
            team_id,
            created_by: created_by.clone(),
            agent: user_id.clone(),
            size: request.size,
            name: request.name.clone(),
        };
        let computer_id = match self.computers.purchase(purchase).await {
            Ok(computer_id) => computer_id,
            Err(error) => {
                // A refused or failed purchase charged nothing (hosted_runtimes
                // keeps an unknown outcome as a pending computer instead).
                self.undo(receipt, undo).await;
                return Err(error);
            }
        };
        tracing::Span::current().record("computer_id", tracing::field::display(computer_id));

        Ok(TeamAgent {
            user_id,
            team_id,
            name: seed.name,
            job_description: seed.job_description,
            personality: seed.personality,
            created_by: Some(created_by),
            computer_id: Some(computer_id),
            status: TeamAgentStatus::Provisioning,
            created_at: chrono::Utc::now(),
        })
    }

    #[tracing::instrument(name = "team_agents.list", skip_all, fields(team_id = %receipt.entity().entity_id), err)]
    async fn list(
        &self,
        receipt: EntityAccessReceipt<MemberTeamRole>,
    ) -> Result<TeamAgents, TeamAgentError> {
        self.ensure_enabled(&acting_user(&receipt)?).await?;
        let records = self
            .repository
            .list_for_team(team_id(&receipt)?)
            .await
            .map_err(TeamAgentError::internal)?;
        let mut agents = Vec::with_capacity(records.len());
        for record in records {
            agents.push(self.team_agent(record).await?);
        }
        Ok(TeamAgents { agents })
    }

    #[tracing::instrument(
        name = "team_agents.delete",
        skip_all,
        fields(team_id = %receipt.entity().entity_id, agent_user_id = %agent_credentials::telemetry_id(agent.as_ref())),
        err
    )]
    async fn delete(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<(), TeamAgentError> {
        // Not gated: an admin can always remove an agent, so its computer
        // stops billing even after the rollout is turned off.
        let team_id = team_id(&receipt)?;
        let record = self.team_record(&receipt, agent).await?;

        // The computer goes first, so nothing keeps running as the agent.
        // A purchase still confirming refuses here, before anything else.
        if let Some(computer_id) = self
            .computers
            .computer_for_agent(team_id, &record.user_id)
            .await?
        {
            self.computers.release(team_id, computer_id).await?;
        }
        self.api_keys.revoke_all(&record.user_id).await?;
        // Issuing a fresh token voids the one a lost guest might hold; the
        // repository itself stays.
        self.repos
            .create(&record.user_id, team_id, &record.persona_seed)
            .await?;
        self.membership
            .remove_agent(receipt, &record.user_id)
            .await?;
        // Deactivate, never delete: the account keeps what it owns (docs
        // shared with the team, threads, routines). Without its seat nothing
        // admits it as an agent.
        self.repository
            .remove_seat(&record.user_id)
            .await
            .map_err(TeamAgentError::internal)
    }

    #[tracing::instrument(
        name = "team_agents.voice",
        skip_all,
        fields(team_id = %receipt.entity().entity_id, agent_user_id = %agent_credentials::telemetry_id(agent.as_ref())),
        err
    )]
    async fn voice(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<AgentVoice, TeamAgentError> {
        self.ensure_enabled(&acting_user(&receipt)?).await?;
        let record = self.team_record(&receipt, agent).await?;
        let model = self
            .repos
            .voice(&record.user_id, record.team_id)
            .await?
            .ok_or(TeamAgentError::NoVoice)?;
        Ok(AgentVoice { model })
    }

    #[tracing::instrument(
        name = "team_agents.set_voice",
        skip_all,
        fields(team_id = %receipt.entity().entity_id, agent_user_id = %agent_credentials::telemetry_id(agent.as_ref()), voice = %voice.model),
        err
    )]
    async fn set_voice(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent: &MacroUserIdStr<'_>,
        voice: AgentVoice,
    ) -> Result<AgentVoice, TeamAgentError> {
        self.ensure_enabled(&acting_user(&receipt)?).await?;
        let record = self.team_record(&receipt, agent).await?;
        self.repos
            .set_voice(&record.user_id, record.team_id, &voice.model)
            .await?;
        Ok(voice)
    }

    #[tracing::instrument(
        name = "team_agents.issue_enrollment",
        skip(self),
        fields(agent_user_id = tracing::field::Empty),
        err
    )]
    async fn issue_enrollment(
        &self,
        computer_id: ComputerId,
        generation: EnrollmentGeneration,
    ) -> Result<Option<AgentEnrollment>, AgentEnrollmentError> {
        let Some(agent) = self
            .computers
            .agent_of(computer_id)
            .await
            .map_err(|error| {
                tracing::error!(error = ?error, "could not read the computer's agent");
                AgentEnrollmentError::IssuanceFailed
            })?
        else {
            return Ok(None);
        };
        tracing::Span::current().record(
            "agent_user_id",
            tracing::field::display(agent_credentials::telemetry_id(agent.as_ref())),
        );
        let record = self
            .repository
            .get(&agent)
            .await
            .map_err(|error| {
                tracing::error!(error = ?error, "could not read the agent");
                AgentEnrollmentError::IssuanceFailed
            })?
            .ok_or(AgentEnrollmentError::NotFound)?;

        // With the rollout off for the agent (as its brain checks it), the
        // computer enrolls as a plain one: no fresh key or repo token, no
        // agent environment, so the agent doesn't start.
        if ensure_enabled(self.flags.as_ref(), &agent).await.is_err() {
            tracing::warn!("agent teammates are off for this agent; enrolling without it");
            return Ok(None);
        }

        // Each guest creation gets fresh credentials; the previous ones stop
        // working, so a lost earlier guest can no longer act as the agent.
        let api_key = self.api_keys.mint(&agent).await.map_err(|error| {
            tracing::error!(error = ?error, "could not mint the agent's API key");
            AgentEnrollmentError::IssuanceFailed
        })?;
        let repo = self
            .repos
            .create(&agent, record.team_id, &record.persona_seed)
            .await
            .map_err(|error| {
                tracing::error!(error = ?error, "could not prepare the agent's repository");
                AgentEnrollmentError::IssuanceFailed
            })?;

        let mut values = BTreeMap::new();
        for (key, value) in self.environment.environment().map_err(|error| {
            tracing::error!(error = ?error, "could not resolve the agent's addresses");
            AgentEnrollmentError::IssuanceFailed
        })? {
            env_entry(&mut values, key, value)?;
        }
        env_entry(&mut values, env_keys::API_KEY, api_key.expose().to_owned())?;
        env_entry(
            &mut values,
            env_keys::ANTHROPIC_AUTH_TOKEN,
            api_key.expose().to_owned(),
        )?;
        env_entry(
            &mut values,
            env_keys::AGENT_USER_ID,
            agent.as_ref().to_owned(),
        )?;
        env_entry(
            &mut values,
            env_keys::AGENT_NAME,
            record.persona_seed.name.clone(),
        )?;
        env_entry(&mut values, env_keys::TEAM_ID, record.team_id.to_string())?;
        env_entry(&mut values, env_keys::COMPUTER_ID, computer_id.to_string())?;
        env_entry(&mut values, env_keys::REPO_URL, repo.url)?;
        env_entry(
            &mut values,
            env_keys::REPO_TOKEN,
            repo.token.expose().to_owned(),
        )?;
        let env = AgentEnv::new(values).map_err(|_| AgentEnrollmentError::IssuanceFailed)?;
        tracing::info!(generation = generation.get(), "issued agent enrollment");

        Ok(Some(AgentEnrollment {
            agent_user_id: agent,
            env,
        }))
    }
}
