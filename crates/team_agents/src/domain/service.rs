//! Team agent service implementation.

use std::collections::BTreeMap;

use entity_access::domain::models::{AdminTeamRole, EntityAccessReceipt};
use feature_flags::FeatureFlags;
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::models::{
    AgentRepo, ComputerPayment, ComputerPurchase, ComputerSize, ComputerStatus, ComputerStatusKind,
    CreateTeamAgent, Credential, EmailMessage, EmailMessages, MAX_NAME_CHARS, MAX_PROFILE_CHARS,
    NewAgentAccount, Persona, PersonaSeed, PersonaService, SendEmail, SentEmail, TeamAgent,
    TeamAgentError, TeamAgentQuote, TeamAgentSizes, TeamAgentStatus, TeamAgents,
};
use super::ports::{
    AgentApiKeys, AgentRepos, Computers, Mailboxes, TeamAgentRepository, TeamAgentService,
    TeamMembership,
};

#[cfg(test)]
mod test;

/// PostHog flag that lets a team admin quote and create team agents.
pub const TEAM_AGENTS_FLAG: &str = "enable-team-agents";

/// The brain's systemd unit, per persona OS user (`brain@<os_user>`).
const BRAIN_UNIT_PREFIX: &str = "brain@";

/// The `@macro-inc/brain` binary on the computer image.
const BRAIN_EXEC: &str = "/opt/macro/brain run";

/// Loopback health endpoint, shared with the macrod persona supervisor.
const BRAIN_HEALTH_PORT: &str = "7801";

const COMPUTER_LINK_FAILED_REASON: &str =
    "computer identity is unavailable; the agent link must be recovered before retrying";

/// Config drive keys the brain reads from its environment file.
pub mod config_keys {
    /// Macro's brain-specific Anthropic gateway endpoint.
    pub const ANTHROPIC_BASE_URL: &str = "ANTHROPIC_BASE_URL";
    /// The revocable first-party agent API key used to authenticate to it.
    pub const ANTHROPIC_AUTH_TOKEN: &str = "ANTHROPIC_AUTH_TOKEN";
    /// The agent's Macro user id.
    pub const AGENT_USER_ID: &str = "MACRO_AGENT_USER_ID";
    /// Public API gateway origin; each service is under its path prefix.
    pub const GATEWAY_URL: &str = "MACRO_GATEWAY";
    /// Absolute path to the persona workspace.
    pub const WORKSPACE: &str = "BRAIN_WORKSPACE";
    /// Loopback port on which the brain serves health.
    pub const HEALTH_PORT: &str = "BRAIN_HEALTH_PORT";
    /// The workspace repo's clone URL.
    pub const REPO_URL: &str = "MACRO_REPO_URL";
    /// The workspace repo token (HTTP Basic password).
    pub const REPO_TOKEN: &str = "MACRO_REPO_TOKEN";
    /// The agent's Macro API key: the one credential that bootstraps auth.
    pub const API_KEY: &str = "MACRO_API_KEY";
}

/// Team agent service backed by its ports.
pub struct TeamAgentServiceImpl<Repository, Membership, ApiKeys, Inboxes, Computer, Repos, Flags> {
    repository: Repository,
    membership: Membership,
    api_keys: ApiKeys,
    mailboxes: Inboxes,
    computers: Computer,
    repos: Repos,
    /// `None` where no flag provider is configured (local stacks, tests):
    /// the feature is then open.
    flags: Option<Flags>,
    /// Public API gateway origin the brain reaches Macro through.
    gateway_url: String,
    anthropic_base_url: String,
}

impl<Repository, Membership, ApiKeys, Inboxes, Computer, Repos, Flags>
    TeamAgentServiceImpl<Repository, Membership, ApiKeys, Inboxes, Computer, Repos, Flags>
{
    /// Builds the service.
    #[expect(clippy::too_many_arguments, reason = "one argument per port")]
    pub fn new(
        repository: Repository,
        membership: Membership,
        api_keys: ApiKeys,
        mailboxes: Inboxes,
        computers: Computer,
        repos: Repos,
        flags: Option<Flags>,
        gateway_url: String,
        anthropic_base_url: String,
    ) -> Self {
        Self {
            repository,
            membership,
            api_keys,
            mailboxes,
            computers,
            repos,
            flags,
            gateway_url,
            anthropic_base_url,
        }
    }
}

/// Lowercase ASCII letters and digits of `name`, joined by `-`, at most 24
/// characters. Starts with a letter, so it is also a valid OS user name.
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

    if !slug.starts_with(|c: char| c.is_ascii_lowercase()) {
        slug.insert_str(0, "agent-");
    }

    if matches!(slug.as_str(), "root" | "macro" | "macrod") {
        slug.insert_str(0, "agent-");
    }

    slug.chars()
        .take(24)
        .collect::<String>()
        .trim_end_matches('-')
        .to_string()
}

/// The request with its text trimmed, or why it is malformed.
fn validate(request: CreateTeamAgent) -> Result<CreateTeamAgent, TeamAgentError> {
    let name = request.name.trim().to_string();

    if name.is_empty() || name.chars().count() > MAX_NAME_CHARS {
        return Err(TeamAgentError::BadRequest(format!(
            "name must be 1 to {MAX_NAME_CHARS} characters"
        )));
    }

    let job_description = request.job_description.trim().to_string();
    let personality = request.personality.trim().to_string();

    for (field, value) in [
        ("job description", &job_description),
        ("personality", &personality),
    ] {
        if value.is_empty() || value.chars().count() > MAX_PROFILE_CHARS {
            return Err(TeamAgentError::BadRequest(format!(
                "{field} must be 1 to {MAX_PROFILE_CHARS} characters"
            )));
        }
    }

    Ok(CreateTeamAgent {
        name,
        job_description,
        personality,
        size: request.size,
        avatar_url: request.avatar_url,
    })
}

/// The persona the agent's computer runs: the brain as `os_user`, with the
/// config drive carrying what it needs to reach Macro and its repo.
fn persona(
    name: &str,
    os_user: &str,
    agent_user_id: &MacroUserIdStr<'_>,
    gateway_url: &str,
    anthropic_base_url: &str,
    repo: &AgentRepo,
    api_key: &Credential,
) -> Persona {
    let config = BTreeMap::from([
        (
            config_keys::ANTHROPIC_BASE_URL.to_string(),
            anthropic_base_url.trim_end_matches('/').to_string(),
        ),
        (
            config_keys::ANTHROPIC_AUTH_TOKEN.to_string(),
            api_key.expose().to_string(),
        ),
        (
            config_keys::AGENT_USER_ID.to_string(),
            agent_user_id.as_ref().to_string(),
        ),
        (
            config_keys::GATEWAY_URL.to_string(),
            gateway_url.trim_end_matches('/').to_string(),
        ),
        (
            config_keys::WORKSPACE.to_string(),
            format!("/home/{os_user}/workspace"),
        ),
        (
            config_keys::HEALTH_PORT.to_string(),
            BRAIN_HEALTH_PORT.to_string(),
        ),
        (config_keys::REPO_URL.to_string(), repo.url.clone()),
        (
            config_keys::REPO_TOKEN.to_string(),
            repo.token.expose().to_string(),
        ),
        (
            config_keys::API_KEY.to_string(),
            api_key.expose().to_string(),
        ),
    ]);

    Persona {
        name: name.to_string(),
        os_user: os_user.to_string(),
        extra_service: PersonaService {
            unit_name: format!("{BRAIN_UNIT_PREFIX}{os_user}"),
            exec: BRAIN_EXEC.to_string(),
            env: BTreeMap::new(),
        },
        config,
    }
}

fn team_id(receipt: &EntityAccessReceipt<AdminTeamRole>) -> Result<Uuid, TeamAgentError> {
    Uuid::parse_str(&receipt.entity().entity_id)
        .map_err(|_| TeamAgentError::BadRequest("the caller has no team".to_string()))
}

/// What a create made before the purchase, so a failure can take it back.
#[derive(Default)]
struct Undo {
    mailbox_id: Option<String>,
    account: Option<MacroUserIdStr<'static>>,
    joined_team: bool,
    repo: bool,
}

impl<Repository, Membership, ApiKeys, Inboxes, Computer, Repos, Flags>
    TeamAgentServiceImpl<Repository, Membership, ApiKeys, Inboxes, Computer, Repos, Flags>
where
    Repository: TeamAgentRepository,
    Membership: TeamMembership,
    ApiKeys: AgentApiKeys,
    Inboxes: Mailboxes,
    Computer: Computers,
    Repos: AgentRepos,
    Flags: FeatureFlags + 'static,
{
    /// Whether `caller` may quote and create team agents. Fails closed when
    /// the flags can't be loaded.
    async fn ensure_enabled(&self, caller: &MacroUserIdStr<'_>) -> Result<(), TeamAgentError> {
        let Some(flags) = &self.flags else {
            return Ok(());
        };

        let enabled = flags
            .load(caller)
            .await
            .inspect_err(|error| tracing::warn!(error = ?error, "could not load feature flags; team agents stay closed"))
            .is_ok_and(|snapshot| snapshot.is_enabled(TEAM_AGENTS_FLAG));
        tracing::Span::current().record("team_agents.flag", enabled);

        if enabled {
            Ok(())
        } else {
            Err(TeamAgentError::NotEnabled)
        }
    }

    /// Takes back what a failed create made, newest first. Each step logs
    /// its own failure so the rest still run.
    async fn undo(&self, receipt: EntityAccessReceipt<AdminTeamRole>, undo: Undo) {
        if let Some(user_id) = &undo.account {
            if undo.repo {
                let _ = self
                    .repos
                    .delete(user_id)
                    .await
                    .inspect_err(|error| tracing::error!(error = ?error, "could not delete a partly created team agent's repo"));
            }

            if undo.joined_team {
                let _ = self
                    .membership
                    .undo_add_agent(receipt, user_id)
                    .await
                    .inspect_err(|error| tracing::error!(error = ?error, "could not take a partly created team agent off its team"));
            }

            let _ = self
                .repository
                .delete_account(user_id)
                .await
                .inspect_err(|error| tracing::error!(error = ?error, "could not delete a partly created team agent"));
        }

        if let Some(mailbox_id) = &undo.mailbox_id {
            let _ = self
                .mailboxes
                .delete(mailbox_id)
                .await
                .inspect_err(|error| tracing::error!(error = ?error, "could not delete a partly created team agent's mailbox"));
        }
    }

    /// Everything up to and including the purchase, recording each step in
    /// `undo`. Returns the account and the bought computer.
    async fn provision(
        &self,
        receipt: &EntityAccessReceipt<AdminTeamRole>,
        created_by: MacroUserIdStr<'static>,
        request: CreateTeamAgent,
        undo: &mut Undo,
    ) -> Result<(MacroUserIdStr<'static>, Uuid), TeamAgentError> {
        let team_id = team_id(receipt)?;
        let os_user = slug(&request.name);

        // A short suffix keeps two agents with the same name apart.
        let suffix: String = Uuid::now_v7()
            .simple()
            .to_string()
            .chars()
            .rev()
            .take(6)
            .collect();
        let username = format!("{os_user}-{suffix}");
        let mailbox = self.mailboxes.create(&username, &request.name).await?;
        undo.mailbox_id = mailbox.mailbox_id.clone();
        let email = mailbox.email.to_lowercase();

        let user_id = MacroUserIdStr::parse_from_str(&format!("macro|{email}"))
            .map_err(|_| TeamAgentError::BadRequest(format!("{email} is not a usable address")))?
            .into_owned();
        tracing::Span::current().record("agent_user_id", tracing::field::display(&user_id));

        let seed = PersonaSeed {
            creator_id: Some(created_by.as_ref().to_string()),
            name: request.name.clone(),
            job_description: request.job_description,
            personality: request.personality,
        };

        self.repository
            .create_account(&NewAgentAccount {
                user_id: user_id.clone(),
                persona_seed: seed.clone(),
                email,
                team_id,
                created_by: created_by.clone(),
                name: request.name.clone(),
                avatar_url: request.avatar_url,
                mailbox_id: mailbox.mailbox_id,
            })
            .await
            .map_err(TeamAgentError::internal)?;
        undo.account = Some(user_id.clone());

        let seat = self.membership.add_agent(receipt.clone(), &user_id).await?;
        undo.joined_team = true;

        let api_key = self.api_keys.mint(&user_id).await?;

        let repo = self.repos.create(&user_id, team_id, &seed).await?;
        undo.repo = true;

        let computer_id = self
            .computers
            .purchase(ComputerPurchase {
                team_id,
                created_by: created_by.as_ref().to_string(),
                size: request.size,
                name: Some(request.name.clone()),
                persona: Some(persona(
                    &request.name,
                    &os_user,
                    &user_id,
                    &self.gateway_url,
                    &self.anthropic_base_url,
                    &repo,
                    &api_key,
                )),
                extra_items: seat.into_iter().collect(),
            })
            .await?;

        Ok((user_id, computer_id))
    }

    /// The agent on the receipt's team, or `NotFound`.
    async fn team_agent(
        &self,
        receipt: &EntityAccessReceipt<AdminTeamRole>,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<TeamAgent, TeamAgentError> {
        let team_id = team_id(receipt)?;

        self.repository
            .get(agent_user_id)
            .await
            .map_err(TeamAgentError::internal)?
            .filter(|agent| agent.team_id == team_id)
            .ok_or(TeamAgentError::NotFound)
    }

    /// The agent with its status brought up to date from its computer, and
    /// the computer's setup progress while it is still coming up.
    async fn refresh_status(&self, agent: TeamAgent) -> Result<TeamAgent, TeamAgentError> {
        let Some(computer_id) = agent.computer_id else {
            return Ok(agent);
        };

        let computer = self.computers.status(agent.team_id, computer_id).await?;

        self.apply_computer_status(agent, computer).await
    }

    async fn apply_computer_status(
        &self,
        agent: TeamAgent,
        computer: ComputerStatus,
    ) -> Result<TeamAgent, TeamAgentError> {
        let (status, reason) = if computer.payment == ComputerPayment::Pending {
            (TeamAgentStatus::Provisioning, None)
        } else if computer.payment == ComputerPayment::Unbilled {
            (TeamAgentStatus::Failed, Some("payment failed".to_string()))
        } else {
            match computer.status {
                _ if computer.status != ComputerStatusKind::Failed
                    && computer.status != ComputerStatusKind::Released
                    && computer
                        .setup
                        .as_ref()
                        .is_some_and(|setup| setup.step != super::models::SetupStep::Ready) =>
                {
                    (TeamAgentStatus::Provisioning, None)
                }
                ComputerStatusKind::SettingUp => (TeamAgentStatus::Provisioning, None),
                ComputerStatusKind::Failed => (
                    TeamAgentStatus::Failed,
                    Some("the computer failed to start".to_string()),
                ),
                ComputerStatusKind::Released => (
                    TeamAgentStatus::Failed,
                    Some("the computer was released".to_string()),
                ),
                ComputerStatusKind::Ready => {
                    let unhealthy = match computer.brain.as_ref() {
                        None => Some("brain health has not been reported".to_string()),
                        Some(brain) if !brain.connected => {
                            Some("the harness is disconnected".to_string())
                        }
                        Some(brain)
                            if {
                                let age = chrono::Utc::now() - brain.checked_at;
                                age < chrono::Duration::zero() || age > chrono::Duration::minutes(2)
                            } =>
                        {
                            Some("the brain health report is stale".to_string())
                        }
                        Some(brain) if !brain.healthy => Some(
                            brain
                                .last_error
                                .clone()
                                .unwrap_or_else(|| "the brain is not healthy".to_string()),
                        ),
                        Some(_) => None,
                    };
                    match unhealthy {
                        Some(reason) => (
                            TeamAgentStatus::Failed,
                            Some(format!("unhealthy: {reason}")),
                        ),
                        None => (TeamAgentStatus::Running, None),
                    }
                }
                ComputerStatusKind::Asleep
                | ComputerStatusKind::Waking
                | ComputerStatusKind::Stopping
                | ComputerStatusKind::Stopped => (TeamAgentStatus::Provisioning, None),
            }
        };

        if status != agent.status || reason != agent.status_reason {
            self.repository
                .set_status(&agent.user_id, status, reason.as_deref())
                .await
                .map_err(TeamAgentError::internal)?;
        }

        Ok(TeamAgent {
            status,
            status_reason: reason,
            retryable: computer.payment == ComputerPayment::Paid
                && computer.status == ComputerStatusKind::Failed,
            payment: Some(computer.payment),
            setup: computer.setup,
            last_turn_at: computer.brain.and_then(|brain| brain.last_turn_at),
            ..agent
        })
    }

    async fn agent(&self, caller: &MacroUserIdStr<'_>) -> Result<TeamAgent, TeamAgentError> {
        self.repository
            .get(caller)
            .await
            .map_err(TeamAgentError::internal)?
            .ok_or(TeamAgentError::NotAnAgent)
    }

    async fn mailbox(&self, caller: &MacroUserIdStr<'_>) -> Result<String, TeamAgentError> {
        self.agent(caller).await?;

        self.repository
            .mailbox_id(caller)
            .await
            .map_err(TeamAgentError::internal)?
            .ok_or(TeamAgentError::EmailUnavailable)
    }
}

impl<Repository, Membership, ApiKeys, Inboxes, Computer, Repos, Flags> TeamAgentService
    for TeamAgentServiceImpl<Repository, Membership, ApiKeys, Inboxes, Computer, Repos, Flags>
where
    Repository: TeamAgentRepository,
    Membership: TeamMembership,
    ApiKeys: AgentApiKeys,
    Inboxes: Mailboxes,
    Computer: Computers,
    Repos: AgentRepos,
    Flags: FeatureFlags + 'static,
{
    #[tracing::instrument(skip_all, err)]
    async fn sizes(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
    ) -> Result<TeamAgentSizes, TeamAgentError> {
        team_id(&receipt)?;
        Ok(TeamAgentSizes {
            sizes: self.computers.sizes(),
        })
    }

    #[tracing::instrument(skip(self, receipt), fields(team_agents.flag), err)]
    async fn quote(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        size: ComputerSize,
    ) -> Result<TeamAgentQuote, TeamAgentError> {
        let caller = receipt
            .acting_user_id()
            .cloned()
            .ok_or(TeamAgentError::Forbidden)?;
        self.ensure_enabled(&caller).await?;
        let team_id = team_id(&receipt)?;

        let seat = self.membership.quote_seat(receipt).await?;
        let computer = self.computers.quote(team_id, size).await?;

        let seat_amount = match seat {
            Some(seat)
                if seat.interval != computer.interval || seat.currency != computer.currency =>
            {
                return Err(TeamAgentError::internal_message(format!(
                    "the seat bills {} per {:?} but the computer {} per {:?}",
                    seat.currency, seat.interval, computer.currency, computer.interval
                )));
            }
            Some(seat) => seat.amount,
            None => 0,
        };

        Ok(TeamAgentQuote {
            vcpus: computer.vcpus,
            memory_gb: computer.memory_gb,
            disk_gb: computer.disk_gb,
            seat: seat_amount,
            computer: computer.amount,
            total: seat_amount + computer.amount,
            currency: computer.currency,
            interval: computer.interval,
        })
    }

    #[tracing::instrument(skip_all, fields(team_id, agent_user_id, size = ?request.size, team_agents.flag), err)]
    async fn create(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        request: CreateTeamAgent,
    ) -> Result<TeamAgent, TeamAgentError> {
        let created_by = receipt
            .acting_user_id()
            .cloned()
            .ok_or(TeamAgentError::Forbidden)?;
        self.ensure_enabled(&created_by).await?;
        let request = validate(request)?;
        tracing::Span::current().record("team_id", tracing::field::display(team_id(&receipt)?));

        let mut undo = Undo::default();
        let (user_id, computer_id) = match self
            .provision(&receipt, created_by, request, &mut undo)
            .await
        {
            Ok(provisioned) => provisioned,
            Err(TeamAgentError::ComputerIdentityUnavailable) => {
                let user_id = undo.account.ok_or_else(|| {
                    TeamAgentError::internal_message("purchase attempted without an agent account")
                })?;
                // Preserve every resource: billing may already have committed.
                // The durable purchase can finish through its payment outbox.
                // Keep credentials alive until its identity is recoverable.
                self.repository
                    .set_status(
                        &user_id,
                        TeamAgentStatus::Failed,
                        Some(COMPUTER_LINK_FAILED_REASON),
                    )
                    .await
                    .map_err(TeamAgentError::internal)?;
                return self.agent(&user_id).await;
            }
            Err(error) => {
                self.undo(receipt, undo).await;
                return Err(error);
            }
        };

        // A saved purchase may still be confirming payment. Keep the agent's
        // resources while the computer's durable payment effect resolves it.
        if let Err(error) = self.repository.set_computer(&user_id, computer_id).await {
            self.repository
                .set_status(
                    &user_id,
                    TeamAgentStatus::Failed,
                    Some(COMPUTER_LINK_FAILED_REASON),
                )
                .await
                .map_err(TeamAgentError::internal)?;
            return Err(TeamAgentError::internal(error));
        }

        let agent = self.agent(&user_id).await?;
        match self.refresh_status(agent).await {
            Ok(agent) => Ok(agent),
            Err(error) => {
                tracing::warn!(error = ?error, "could not refresh saved computer purchase");
                self.repository
                    .set_status(
                        &user_id,
                        TeamAgentStatus::Failed,
                        Some("computer status is unavailable"),
                    )
                    .await
                    .map_err(TeamAgentError::internal)?;
                self.agent(&user_id).await
            }
        }
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn list(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
    ) -> Result<TeamAgents, TeamAgentError> {
        let team_id = team_id(&receipt)?;
        let stored = self
            .repository
            .list_for_team(team_id)
            .await
            .map_err(TeamAgentError::internal)?;

        let mut agents = Vec::with_capacity(stored.len());

        for agent in stored {
            // One computer the status lookup fails for keeps its last known
            // status rather than failing the whole list.
            let mut fallback = agent.clone();
            let agent = self.refresh_status(agent).await.unwrap_or_else(|error| {
                tracing::error!(error = ?error, agent_user_id = %fallback.user_id, "could not refresh a team agent's computer status");
                if fallback.status == TeamAgentStatus::Running {
                    fallback.status = TeamAgentStatus::Failed;
                    fallback.status_reason = Some("unhealthy: computer status is unavailable".to_string());
                }
                fallback
            });
            agents.push(agent);
        }

        Ok(TeamAgents { agents })
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn retry(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<TeamAgent, TeamAgentError> {
        let agent = self.team_agent(&receipt, agent_user_id).await?;
        let computer_id = agent.computer_id.ok_or_else(|| {
            TeamAgentError::RetryUnavailable("the agent has no saved computer to retry".to_string())
        })?;
        let computer = self.computers.status(agent.team_id, computer_id).await?;
        if computer.payment == ComputerPayment::Pending {
            return Err(TeamAgentError::RetryUnavailable(
                "payment is still being confirmed".to_string(),
            ));
        }
        if computer.status == ComputerStatusKind::Released {
            return Err(TeamAgentError::RetryUnavailable(
                "a released computer cannot be retried".to_string(),
            ));
        }
        let payment_failed = computer.payment == ComputerPayment::Unbilled;
        let agent = self.apply_computer_status(agent, computer).await?;
        if payment_failed {
            return Err(TeamAgentError::RetryUnavailable(
                "payment failed; re-invite or release the agent".to_string(),
            ));
        }
        if !agent.retryable {
            return Ok(agent);
        }
        let mut seed = self
            .repository
            .persona_seed(agent_user_id)
            .await
            .map_err(TeamAgentError::internal)?
            .ok_or_else(|| {
                TeamAgentError::RetryUnavailable(
                    "the agent predates saved recovery inputs".to_string(),
                )
            })?;
        if seed.creator_id.is_none() {
            seed.creator_id = agent
                .created_by
                .as_ref()
                .map(|creator| creator.as_ref().to_string());
        }
        let persona = self.computers.persona(agent.team_id, computer_id).await?;
        if persona
            .config
            .get(config_keys::AGENT_USER_ID)
            .map(String::as_str)
            != Some(agent_user_id.as_ref())
        {
            return Err(TeamAgentError::internal_message(
                "the saved persona belongs to another agent",
            ));
        }
        let token = persona.config.get(config_keys::REPO_TOKEN).ok_or_else(|| {
            TeamAgentError::RetryUnavailable("the saved repo credential is missing".to_string())
        })?;
        self.repos
            .ensure(
                agent_user_id,
                agent.team_id,
                &seed,
                &Credential::new(token.clone()),
            )
            .await?;
        let computer = self.computers.retry(agent.team_id, computer_id).await?;
        self.apply_computer_status(agent, computer).await
    }

    #[tracing::instrument(skip(self, receipt), err)]
    async fn delete(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent_user_id: &MacroUserIdStr<'_>,
    ) -> Result<(), TeamAgentError> {
        let agent = self.team_agent(&receipt, agent_user_id).await?;
        let Some(computer_id) = agent.computer_id else {
            return Err(TeamAgentError::RetryUnavailable(
                COMPUTER_LINK_FAILED_REASON.to_string(),
            ));
        };
        let computer = self.computers.status(agent.team_id, computer_id).await?;
        if computer.payment == ComputerPayment::Pending {
            return Err(TeamAgentError::RetryUnavailable(
                "payment is still being confirmed".to_string(),
            ));
        }
        let unbilled = computer.payment == ComputerPayment::Unbilled;
        let agent = self.apply_computer_status(agent, computer).await?;

        // The account goes last, so a failed step leaves the row for a retry
        // to find; every earlier step tolerates having already run.
        if let Some(computer_id) = agent.computer_id {
            self.computers.release(agent.team_id, computer_id).await?;
        }

        self.repos.delete(&agent.user_id).await?;
        if unbilled {
            self.membership
                .undo_add_agent(receipt, &agent.user_id)
                .await?;
        } else {
            self.membership
                .remove_agent(receipt, &agent.user_id)
                .await?;
        }

        let mailbox_id = self
            .repository
            .mailbox_id(&agent.user_id)
            .await
            .map_err(TeamAgentError::internal)?;

        if let Some(mailbox_id) = mailbox_id {
            self.mailboxes.delete(&mailbox_id).await?;
        }

        self.repository
            .delete_account(&agent.user_id)
            .await
            .map_err(TeamAgentError::internal)
    }

    #[tracing::instrument(skip(self), err)]
    async fn me(&self, caller: &MacroUserIdStr<'_>) -> Result<TeamAgent, TeamAgentError> {
        let agent = self.agent(caller).await?;
        self.refresh_status(agent).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn list_email(
        &self,
        caller: &MacroUserIdStr<'_>,
        limit: u8,
    ) -> Result<EmailMessages, TeamAgentError> {
        let mailbox_id = self.mailbox(caller).await?;
        self.mailboxes.list(&mailbox_id, limit.clamp(1, 100)).await
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_email(
        &self,
        caller: &MacroUserIdStr<'_>,
        message_id: &str,
    ) -> Result<EmailMessage, TeamAgentError> {
        let mailbox_id = self.mailbox(caller).await?;
        self.mailboxes.get(&mailbox_id, message_id).await
    }

    #[tracing::instrument(skip(self, email), fields(recipients = email.to.len()), err)]
    async fn send_email(
        &self,
        caller: &MacroUserIdStr<'_>,
        email: SendEmail,
    ) -> Result<SentEmail, TeamAgentError> {
        if email.to.is_empty() {
            return Err(TeamAgentError::BadRequest(
                "an email needs at least one recipient".to_string(),
            ));
        }

        let mailbox_id = self.mailbox(caller).await?;
        self.mailboxes.send(&mailbox_id, &email).await
    }
}
