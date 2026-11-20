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

use super::inbox::{AGENT_INBOXES_FLAG, AgentInbox, AgentInboxState, AgentInboxes, NoInboxes};
use super::models::{
    AGENT_EMAIL_DOMAIN, AgentName, AgentReady, ComputerId, ComputerPurchase, CreateTeamAgent,
    CreatedAccount, MAX_PROFILE_CHARS, NewAgentAccount, PersonaSeed, PurchaseKey, TeamAgent,
    TeamAgentError, TeamAgentInvite, TeamAgentRecord, TeamAgentStatus, TeamAgents,
};
use super::ports::{
    AgentApiKeys, AgentReadyNotices, AgentRepos, Computers, EnrollmentEnvironment,
    TeamAgentRepository, TeamAgentService, TeamMembership,
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
pub struct TeamAgentServiceImpl<
    Repository,
    Membership,
    ApiKeys,
    Repos,
    Computer,
    Creators,
    Flags,
    Notices,
    Inboxes = NoInboxes,
> {
    repository: Repository,
    membership: Membership,
    api_keys: ApiKeys,
    repos: Repos,
    computers: Computer,
    /// Whose rollout each agent follows, for its enrollment.
    creators: Creators,
    flags: Option<Flags>,
    /// Tells an agent's inviter when the agent first comes online.
    notices: Notices,
    environment: Box<dyn EnrollmentEnvironment>,
    /// The agents' email inboxes.
    inboxes: Inboxes,
}

impl<Repository, Membership, ApiKeys, Repos, Computer, Creators, Flags, Notices>
    TeamAgentServiceImpl<Repository, Membership, ApiKeys, Repos, Computer, Creators, Flags, Notices>
{
    /// Build the service. Without `flags`, agent teammates stay off.
    #[expect(
        clippy::too_many_arguments,
        reason = "each argument is a separate port the service runs on; bundling them only moves the list"
    )]
    pub fn new(
        repository: Repository,
        membership: Membership,
        api_keys: ApiKeys,
        repos: Repos,
        computers: Computer,
        creators: Creators,
        flags: Option<Flags>,
        notices: Notices,
        environment: impl EnrollmentEnvironment,
    ) -> Self {
        Self {
            repository,
            membership,
            api_keys,
            repos,
            computers,
            creators,
            flags,
            notices,
            environment: Box::new(environment),
            inboxes: NoInboxes,
        }
    }

    /// Give agents email inboxes through `inboxes`.
    pub fn with_inboxes<Inboxes: AgentInboxes>(
        self,
        inboxes: Inboxes,
    ) -> TeamAgentServiceImpl<
        Repository,
        Membership,
        ApiKeys,
        Repos,
        Computer,
        Creators,
        Flags,
        Notices,
        Inboxes,
    > {
        TeamAgentServiceImpl {
            repository: self.repository,
            membership: self.membership,
            api_keys: self.api_keys,
            repos: self.repos,
            computers: self.computers,
            creators: self.creators,
            flags: self.flags,
            notices: self.notices,
            environment: self.environment,
            inboxes,
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

fn validate(request: CreateTeamAgent) -> Result<TeamAgentInvite, TeamAgentError> {
    let name = AgentName::try_new(&request.name)?;
    let purchase_key = PurchaseKey::try_new(request.purchase_key)
        .map_err(|_| TeamAgentError::InvalidPurchaseKey)?;
    let job_description = request.job_description.trim().to_owned();
    let personality = request.personality.trim().to_owned();
    for profile in [&job_description, &personality] {
        // Empty is fine: an agent invited by name only asks its owner what to take on.
        if profile.chars().count() > MAX_PROFILE_CHARS {
            return Err(TeamAgentError::InvalidProfile);
        }
    }
    if let Some(avatar) = &request.avatar_url
        && !avatar.starts_with("https://")
    {
        return Err(TeamAgentError::InvalidAvatar);
    }
    Ok(TeamAgentInvite {
        purchase_key,
        name,
        job_description,
        personality,
        size: request.size,
        avatar_url: request.avatar_url,
        voice: request.voice,
        inbox: request.inbox,
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

/// What [`TeamAgentServiceImpl::prepare`] led to.
enum Prepared {
    /// A new account, joined to the team, with its repo.
    New(MacroUserIdStr<'static>, PersonaSeed),
    /// The invite's purchase key already made this agent.
    Repeat(TeamAgentRecord),
}

/// What a failed invite must take back, newest first.
#[derive(Default)]
struct Undo {
    account: Option<MacroUserIdStr<'static>>,
    joined_team: bool,
    repo: bool,
}

impl<Repository, Membership, ApiKeys, Repos, Computer, Creators, Flags, Notices, Inboxes>
    TeamAgentServiceImpl<
        Repository,
        Membership,
        ApiKeys,
        Repos,
        Computer,
        Creators,
        Flags,
        Notices,
        Inboxes,
    >
where
    Inboxes: AgentInboxes,
    Repository: TeamAgentRepository,
    Membership: TeamMembership,
    ApiKeys: AgentApiKeys,
    Repos: AgentRepos,
    Computer: Computers,
    Notices: AgentReadyNotices,
    Creators: agent_credentials::AgentCreators + 'static,
    Flags: FeatureFlags + 'static,
{
    async fn ensure_enabled(&self, caller: &MacroUserIdStr<'_>) -> Result<(), TeamAgentError> {
        ensure_enabled(self.flags.as_ref(), caller).await
    }

    /// The agent inboxes rollout for `caller`, on top of agent teammates.
    /// Fails closed like [`ensure_enabled`].
    async fn ensure_inboxes_enabled(
        &self,
        caller: &MacroUserIdStr<'_>,
    ) -> Result<(), TeamAgentError> {
        let Some(flags) = self.flags.as_ref() else {
            return Err(TeamAgentError::NotEnabled);
        };
        let enabled = flags
            .load(caller)
            .await
            .inspect_err(|error| {
                tracing::warn!(error = ?error, "could not load feature flags; agent inboxes stay off");
            })
            .is_ok_and(|snapshot| {
                snapshot.is_enabled(AGENT_TEAMMATES_FLAG) && snapshot.is_enabled(AGENT_INBOXES_FLAG)
            });
        if enabled {
            Ok(())
        } else {
            Err(TeamAgentError::NotEnabled)
        }
    }

    /// Create or retry the agent's inbox, named after it.
    async fn provision_inbox(
        &self,
        record_team: Uuid,
        agent: &MacroUserIdStr<'_>,
        name: &str,
    ) -> Result<AgentInbox, TeamAgentError> {
        Ok(self
            .inboxes
            .provision(record_team, agent, name, &slug(name))
            .await?)
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

    /// Take back an agent whose computer was released after failing its
    /// first start, as removing it does but with no admin and no computer to
    /// release (the lifecycle released it): revoke its keys, delete its repository, take it off the
    /// team and delete its seat. Its account stays, since it may already own
    /// docs or threads. Each step is idempotent and the seat goes last, so a
    /// retry after a failed step finds the agent and finishes; an agent
    /// already taken back, or on another team, is done.
    #[tracing::instrument(
        name = "team_agents.undo_invite",
        skip_all,
        fields(team_id = %team_id, agent_user_id = %agent_credentials::telemetry_id(agent.as_ref())),
        err
    )]
    pub async fn undo_invite(
        &self,
        team_id: Uuid,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<(), TeamAgentError> {
        let Some(record) = self
            .repository
            .get(agent)
            .await
            .map_err(TeamAgentError::internal)?
            .filter(|record| record.team_id == team_id)
        else {
            return Ok(());
        };
        self.api_keys.revoke_all(&record.user_id).await?;
        // Nothing to keep from an agent that never started.
        self.inboxes.release(&record.user_id).await?;
        self.repos.delete(&record.user_id).await?;
        let removed_by = record
            .created_by
            .clone()
            .unwrap_or_else(|| record.user_id.clone());
        self.membership
            .take_back_agent(team_id, &record.user_id, removed_by)
            .await?;
        self.repository
            .remove_seat(&record.user_id)
            .await
            .map_err(TeamAgentError::internal)
    }

    /// Everything before the purchase, recording each step in `undo`.
    async fn prepare(
        &self,
        receipt: &EntityAccessReceipt<AdminTeamRole>,
        created_by: &MacroUserIdStr<'static>,
        request: &TeamAgentInvite,
        undo: &mut Undo,
    ) -> Result<Prepared, TeamAgentError> {
        let team_id = team_id(receipt)?;
        // A short suffix keeps two agents with the same name apart.
        let suffix: String = Uuid::now_v7()
            .simple()
            .to_string()
            .chars()
            .rev()
            .take(6)
            .collect();
        let email = format!(
            "{}-{suffix}@{AGENT_EMAIL_DOMAIN}",
            slug(request.name.as_str())
        );
        let user_id = MacroUserIdStr::parse_from_str(&format!("macro|{email}"))
            .map_err(|_| TeamAgentError::InvalidName)?
            .into_owned();
        tracing::Span::current().record(
            "agent_user_id",
            tracing::field::display(agent_credentials::telemetry_id(user_id.as_ref())),
        );
        let seed = PersonaSeed {
            creator_id: Some(created_by.clone()),
            name: request.name.as_str().to_owned(),
            job_description: request.job_description.clone(),
            personality: request.personality.clone(),
            voice: request.voice.clone(),
        };

        let created = self
            .repository
            .create_account(&NewAgentAccount {
                user_id: user_id.clone(),
                email,
                team_id,
                created_by: created_by.clone(),
                name: request.name.clone(),
                avatar_url: request.avatar_url.clone(),
                persona_seed: seed.clone(),
                purchase_key: request.purchase_key.clone(),
            })
            .await
            .map_err(TeamAgentError::internal)?;
        if let CreatedAccount::AlreadyInvited(record) = created {
            tracing::Span::current().record(
                "agent_user_id",
                tracing::field::display(agent_credentials::telemetry_id(record.user_id.as_ref())),
            );
            return Ok(Prepared::Repeat(*record));
        }
        undo.account = Some(user_id.clone());

        self.membership.add_agent(receipt.clone(), &user_id).await?;
        undo.joined_team = true;

        // Marked first: a create whose answer is lost may still have made
        // the repo, and deleting a missing one is a no-op.
        undo.repo = true;
        self.repos.create(&user_id, team_id, &seed).await?;

        Ok(Prepared::New(user_id, seed))
    }

    /// A repeat of an invite (a double click, or a retry after a lost
    /// answer) answers with the agent the first request made, and changes
    /// nothing: the first request owns the setup and its undo. Until that
    /// one has bought the computer (a purchase still confirming counts), the
    /// agent may yet be taken back, so the repeat is refused.
    async fn repeated_invite(&self, record: TeamAgentRecord) -> Result<TeamAgent, TeamAgentError> {
        let agent = self.team_agent(record).await?;
        let Some(computer_id) = agent.computer_id else {
            return Err(TeamAgentError::InviteInProgress);
        };
        tracing::Span::current().record("computer_id", tracing::field::display(computer_id));
        Ok(agent)
    }

    async fn team_agent(&self, record: TeamAgentRecord) -> Result<TeamAgent, TeamAgentError> {
        let computer_id = self
            .computers
            .computer_for_agent(record.team_id, &record.user_id)
            .await?;
        let status = match computer_id {
            Some(computer_id) => TeamAgentStatus::of(
                self.computers.state(record.team_id, computer_id).await?,
                record.first_online_at.is_some(),
            ),
            // The account exists and its purchase hasn't completed.
            None => TeamAgentStatus::without_computer(record.created_at, chrono::Utc::now()),
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
            inbox: None,
        })
    }
}

impl<Repository, Membership, ApiKeys, Repos, Computer, Creators, Flags, Notices, Inboxes>
    TeamAgentService
    for TeamAgentServiceImpl<
        Repository,
        Membership,
        ApiKeys,
        Repos,
        Computer,
        Creators,
        Flags,
        Notices,
        Inboxes,
    >
where
    Inboxes: AgentInboxes,
    Repository: TeamAgentRepository,
    Membership: TeamMembership,
    ApiKeys: AgentApiKeys,
    Repos: AgentRepos,
    Computer: Computers,
    Notices: AgentReadyNotices,
    Creators: agent_credentials::AgentCreators + 'static,
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
        // A buyer the computers rollout doesn't include is refused before an
        // account, seat or repository exists to take back.
        self.computers.require_purchase_rollout(&created_by).await?;

        let mut undo = Undo::default();
        let (user_id, seed) = match self
            .prepare(&receipt, &created_by, &request, &mut undo)
            .await
        {
            Ok(Prepared::New(user_id, seed)) => (user_id, seed),
            Ok(Prepared::Repeat(record)) => return self.repeated_invite(record).await,
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

        // Best effort: the agent and its computer exist and are paid for, so
        // an inbox that can't be made leaves a failed inbox to retry from
        // its card, never a failed invite.
        let inbox = if request.inbox && self.ensure_inboxes_enabled(&created_by).await.is_ok() {
            self.provision_inbox(team_id, &user_id, &seed.name)
                .await
                .inspect_err(|error| {
                    tracing::warn!(error = ?error, "could not give the invited agent an inbox");
                })
                .ok()
        } else {
            None
        };

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
            inbox,
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
        // Inboxes are extra: a failed read shows the agents without them.
        let mut inboxes = self
            .inboxes
            .for_team(team_id(&receipt)?)
            .await
            .inspect_err(|error| {
                tracing::warn!(error = ?error, "could not read the agents' inboxes");
            })
            .unwrap_or_default();
        let mut agents = Vec::with_capacity(records.len());
        for record in records {
            let inbox = match inboxes.remove(record.user_id.as_ref()) {
                // Still being made: ask email_service, so the polling list
                // sees it become active.
                Some(inbox) if inbox.state == AgentInboxState::Provisioning => Some(
                    self.inboxes
                        .refresh(&record.user_id)
                        .await
                        .inspect_err(|error| {
                            tracing::warn!(error = ?error, "could not refresh an agent's inbox");
                        })
                        .unwrap_or(inbox),
                ),
                inbox => inbox,
            };
            let mut agent = self.team_agent(record).await?;
            agent.inbox = inbox;
            agents.push(agent);
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
        // Its inbox stops syncing and sending; its mail is kept until
        // email_service releases it.
        self.inboxes.pause(&record.user_id).await?;
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
        name = "team_agents.inbox",
        skip_all,
        fields(team_id = %receipt.entity().entity_id, agent_user_id = %agent_credentials::telemetry_id(agent.as_ref())),
        err
    )]
    async fn inbox(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<AgentInbox, TeamAgentError> {
        self.ensure_inboxes_enabled(&acting_user(&receipt)?).await?;
        let record = self.team_record(&receipt, agent).await?;
        Ok(self.inboxes.refresh(&record.user_id).await?)
    }

    #[tracing::instrument(
        name = "team_agents.add_inbox",
        skip_all,
        fields(team_id = %receipt.entity().entity_id, agent_user_id = %agent_credentials::telemetry_id(agent.as_ref())),
        err
    )]
    async fn add_inbox(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<AgentInbox, TeamAgentError> {
        self.ensure_inboxes_enabled(&acting_user(&receipt)?).await?;
        let record = self.team_record(&receipt, agent).await?;
        self.provision_inbox(record.team_id, &record.user_id, &record.persona_seed.name)
            .await
    }

    #[tracing::instrument(
        name = "team_agents.agent_online",
        skip_all,
        fields(team_id = %receipt.entity().entity_id, agent_user_id = tracing::field::Empty, computer_id = tracing::field::Empty, first = tracing::field::Empty),
        err
    )]
    async fn agent_online(
        &self,
        receipt: EntityAccessReceipt<MemberTeamRole>,
    ) -> Result<(), TeamAgentError> {
        let agent = acting_user(&receipt)?;
        let team_id = team_id(&receipt)?;
        let span = tracing::Span::current();
        span.record(
            "agent_user_id",
            tracing::field::display(agent_credentials::telemetry_id(agent.as_ref())),
        );
        let record = self
            .repository
            .get(&agent)
            .await
            .map_err(TeamAgentError::internal)?
            .filter(|record| record.team_id == team_id)
            .ok_or(TeamAgentError::NotFound)?;
        let first = record.first_online_at.is_none();
        span.record("first", first);

        // Every report tells the computer, which is idempotent: a computer
        // whose agent was first stamped online before the computer recorded
        // its setup with it catches up on the agent's next report. Told
        // before the stamp, so a failed hand-off or notice is retried by the
        // agent's next report.
        let computer_id = self.computers.computer_for_agent(team_id, &agent).await?;
        if let Some(computer_id) = computer_id {
            span.record("computer_id", tracing::field::display(computer_id));
            self.computers.agent_online(team_id, computer_id).await?;
        }
        if !first {
            return Ok(());
        }
        if let (Some(computer_id), Some(inviter)) = (computer_id, record.created_by) {
            let computer = self.computers.details(team_id, computer_id).await?;
            self.notices
                .send(AgentReady {
                    computer_id,
                    team_id,
                    computer,
                    inviter,
                    agent: agent.clone(),
                    agent_name: record.persona_seed.name,
                })
                .await?;
        }
        self.repository
            .mark_online(&agent)
            .await
            .map_err(TeamAgentError::internal)
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

        // With the rollout off for the agent's creator (as its brain checks
        // it), the computer enrolls as a plain one: no fresh key or repo
        // token, no agent environment, so the agent doesn't start.
        if !agent_credentials::agent_teammates_enabled(&self.creators, self.flags.as_ref(), &agent)
            .await
        {
            tracing::warn!(
                "agent teammates are off for this agent (its creator's rollout); enrolling without it"
            );
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

/// hosted_runtimes takes back the agent of a computer released after a failed
/// first start through here.
impl<Repository, Membership, ApiKeys, Repos, Computer, Creators, Flags, Notices, Inboxes>
    hosted_runtimes::domain::ports::AgentInvites
    for TeamAgentServiceImpl<
        Repository,
        Membership,
        ApiKeys,
        Repos,
        Computer,
        Creators,
        Flags,
        Notices,
        Inboxes,
    >
where
    Inboxes: AgentInboxes,
    Repository: TeamAgentRepository,
    Membership: TeamMembership,
    ApiKeys: AgentApiKeys,
    Repos: AgentRepos,
    Computer: Computers,
    Creators: agent_credentials::AgentCreators + 'static,
    Flags: FeatureFlags + 'static,
    Notices: AgentReadyNotices,
{
    type Err = TeamAgentError;

    async fn undo_invite(
        &self,
        team_id: Uuid,
        agent: &MacroUserIdStr<'_>,
    ) -> Result<(), TeamAgentError> {
        TeamAgentServiceImpl::undo_invite(self, team_id, agent).await
    }
}
