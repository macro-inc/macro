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

use super::avatar::{AgentAvatar, PictureBase};
use super::models::{
    AGENT_EMAIL_DOMAIN, AgentName, AgentReady, AgentRepo, ComputerId, ComputerPurchase,
    CreateTeamAgent, CreatedAccount, HarnessId, InviteComputer, MAX_PROFILE_CHARS, NewAgentAccount,
    PersonaSeed, PurchaseKey, TeamAgent, TeamAgentError, TeamAgentInvite, TeamAgentRecord,
    TeamAgentStatus, TeamAgents,
};
use super::ports::{
    AgentApiKeys, AgentPictureChanges, AgentReadyNotices, AgentRepos, Computers, CountedDelivery,
    EnrollmentEnvironment, TeamAgentRepository, TeamAgentService, TeamMembership, TeammateInstalls,
    TeammateRuntimes,
};
use super::self_hosting::{
    CHECKPOINT_TIMEOUT, Checkpoint, CreatedInstall, HostEligibility, IssuedInstall, MoveTeammate,
    NewTeammateInstall, RuntimeImages, SELF_HOSTED_TEAMMATES_FLAG, TeammateHost, TeammateHosts,
    TeammateInstallRecord,
};
use super::voice::AgentVoice;

mod self_hosted;
mod team_release;

pub use team_release::TeamInstallRelease;
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
    /// The install the brain runs as, on its owner's own machine; set
    /// instead of [`COMPUTER_ID`].
    pub const TEAMMATE_INSTALL_ID: &str = "MACRO_TEAMMATE_INSTALL_ID";
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
    Installs,
    Runtimes,
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
    /// The addresses a Macro computer reaches Macro at.
    environment: Box<dyn EnrollmentEnvironment>,
    picture_changes: Box<dyn AgentPictureChanges>,
    /// Where an agent's picture must have been uploaded.
    pictures: PictureBase,
    /// Installs on owners' own machines.
    installs: Installs,
    /// Tells a machine's socket holder that its installs changed.
    runtimes: Runtimes,
    /// The runtime image for each architecture.
    images: RuntimeImages,
    /// The public addresses an agent on its owner's own machine reaches
    /// Macro at.
    public_environment: Box<dyn EnrollmentEnvironment>,
}

/// Everything a self-hosted teammate needs from the service's caller.
pub struct SelfHosting<Installs, Runtimes> {
    /// Install storage and the inviter's machines.
    pub installs: Installs,
    /// Delivery nudges.
    pub runtimes: Runtimes,
    /// The runtime image for each architecture:
    /// [`super::self_hosting::TeammateRuntimeImage::images`].
    pub images: RuntimeImages,
    /// Public addresses for own machines.
    pub public_environment: Box<dyn EnrollmentEnvironment>,
}

impl<Repository, Membership, ApiKeys, Repos, Computer, Creators, Flags, Notices, Installs, Runtimes>
    TeamAgentServiceImpl<
        Repository,
        Membership,
        ApiKeys,
        Repos,
        Computer,
        Creators,
        Flags,
        Notices,
        Installs,
        Runtimes,
    >
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
        picture_changes: impl AgentPictureChanges,
        pictures: PictureBase,
        self_hosting: SelfHosting<Installs, Runtimes>,
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
            picture_changes: Box::new(picture_changes),
            pictures,
            installs: self_hosting.installs,
            runtimes: self_hosting.runtimes,
            images: self_hosting.images,
            public_environment: self_hosting.public_environment,
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

fn validate(
    request: CreateTeamAgent,
    pictures: &PictureBase,
) -> Result<TeamAgentInvite, TeamAgentError> {
    AgentAvatar {
        face: request.avatar_face.clone(),
        url: request.avatar_url.clone(),
    }
    .validate(pictures)?;
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
    // Requests from before own machines name only a size.
    let computer = match (request.computer, request.size) {
        (Some(computer), None) => computer,
        (None, Some(size)) => InviteComputer::New { size },
        (None, None) | (Some(_), Some(_)) => return Err(TeamAgentError::InvalidComputer),
    };
    Ok(TeamAgentInvite {
        purchase_key,
        name,
        job_description,
        personality,
        computer,
        avatar_url: request.avatar_url,
        avatar_face: request.avatar_face,
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
    if flag_on(flags, caller, AGENT_TEAMMATES_FLAG).await {
        Ok(())
    } else {
        Err(TeamAgentError::NotEnabled)
    }
}

/// Whether `flag` is on for `caller`. Fails closed: no flag provider or a
/// failed load is off.
async fn flag_on<Flags: FeatureFlags>(
    flags: Option<&Flags>,
    caller: &MacroUserIdStr<'_>,
    flag: &str,
) -> bool {
    let Some(flags) = flags else {
        return false;
    };
    flags
        .load(caller)
        .await
        .inspect_err(|error| {
            tracing::warn!(error = ?error, flag, "could not load feature flags; the flag stays off");
        })
        .is_ok_and(|snapshot| snapshot.is_enabled(flag))
}

/// Where an agent's brain runs, for its environment.
enum Placement {
    /// On this Macro computer, at computer-facing addresses.
    Computer(ComputerId),
    /// As this install on its owner's own machine, at public addresses.
    Install(Uuid),
}

/// The brain's environment: the addresses, its fresh key and repository
/// token, who it is, and where it runs.
fn agent_env(
    addresses: Vec<(&'static str, String)>,
    api_key: &super::models::AgentApiKey,
    agent: &MacroUserIdStr<'_>,
    record: &TeamAgentRecord,
    repo: AgentRepo,
    placement: Placement,
) -> Result<AgentEnv, AgentEnrollmentError> {
    let mut values = BTreeMap::new();
    for (key, value) in addresses {
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
    match placement {
        Placement::Computer(computer_id) => {
            env_entry(&mut values, env_keys::COMPUTER_ID, computer_id.to_string())?;
        }
        Placement::Install(install_id) => {
            env_entry(
                &mut values,
                env_keys::TEAMMATE_INSTALL_ID,
                install_id.to_string(),
            )?;
        }
    }
    env_entry(&mut values, env_keys::REPO_URL, repo.url)?;
    env_entry(
        &mut values,
        env_keys::REPO_TOKEN,
        repo.token.expose().to_owned(),
    )?;
    AgentEnv::new(values).map_err(|_| AgentEnrollmentError::IssuanceFailed)
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

impl<Repository, Membership, ApiKeys, Repos, Computer, Creators, Flags, Notices, Installs, Runtimes>
    TeamAgentServiceImpl<
        Repository,
        Membership,
        ApiKeys,
        Repos,
        Computer,
        Creators,
        Flags,
        Notices,
        Installs,
        Runtimes,
    >
where
    Repository: TeamAgentRepository,
    Membership: TeamMembership,
    ApiKeys: AgentApiKeys,
    Repos: AgentRepos,
    Computer: Computers,
    Notices: AgentReadyNotices,
    Creators: agent_credentials::AgentCreators + 'static,
    Flags: FeatureFlags + 'static,
    Installs: TeammateInstalls,
    Runtimes: TeammateRuntimes,
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
                avatar_face: request.avatar_face.clone(),
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
    /// one has bought the computer (a purchase still confirming counts) or
    /// made the install, the agent may yet be taken back, so the repeat is
    /// refused.
    async fn repeated_invite(&self, record: TeamAgentRecord) -> Result<TeamAgent, TeamAgentError> {
        let agent = self.team_agent(record).await?;
        if let Some(computer_id) = agent.computer_id {
            tracing::Span::current().record("computer_id", tracing::field::display(computer_id));
            return Ok(agent);
        }
        if agent.harness_id.is_some() {
            return Ok(agent);
        }
        Err(TeamAgentError::InviteInProgress)
    }

    async fn team_agent(&self, record: TeamAgentRecord) -> Result<TeamAgent, TeamAgentError> {
        let install = self.installs.for_agent(&record.user_id).await?;
        self.team_agent_with(record, install).await
    }

    /// The agent from its record and its install, if it has one.
    async fn team_agent_with(
        &self,
        record: TeamAgentRecord,
        install: Option<TeammateInstallRecord>,
    ) -> Result<TeamAgent, TeamAgentError> {
        // An agent runs either on its owner's own machine or on a Macro
        // computer, never both.
        if let Some(install) = install {
            return Ok(Self::installed_agent(record, &install));
        }
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
            harness_id: None,
            status,
            install_problem: None,
            created_at: record.created_at,
        })
    }
}

impl<Repository, Membership, ApiKeys, Repos, Computer, Creators, Flags, Notices, Installs, Runtimes>
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
        Installs,
        Runtimes,
    >
where
    Repository: TeamAgentRepository,
    Membership: TeamMembership,
    ApiKeys: AgentApiKeys,
    Repos: AgentRepos,
    Computer: Computers,
    Notices: AgentReadyNotices,
    Creators: agent_credentials::AgentCreators + 'static,
    Flags: FeatureFlags + 'static,
    Installs: TeammateInstalls,
    Runtimes: TeammateRuntimes,
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
        let request = validate(request, &self.pictures)?;
        let team_id = team_id(&receipt)?;
        // A buyer the computers rollout doesn't include, or a machine that
        // can't host the agent, is refused before an account, seat or
        // repository exists to take back.
        match request.computer {
            InviteComputer::New { .. } => {
                self.computers.require_purchase_rollout(&created_by).await?;
            }
            InviteComputer::Own { harness_id } => {
                self.require_own_host(&created_by, harness_id).await?;
            }
        }

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

        let size = match request.computer {
            InviteComputer::New { size } => size,
            InviteComputer::Own { harness_id } => {
                return self
                    .install_invited(receipt, undo, harness_id, user_id, seed, created_by)
                    .await;
            }
        };
        let purchase = ComputerPurchase {
            purchase_key: request.purchase_key.clone(),
            team_id,
            created_by: created_by.clone(),
            agent: user_id.clone(),
            size,
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
            harness_id: None,
            status: TeamAgentStatus::Provisioning,
            install_problem: None,
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
        let users: Vec<_> = records
            .iter()
            .map(|record| record.user_id.clone())
            .collect();
        let mut installs = self.installs.for_agents(&users).await?;
        let mut agents = Vec::with_capacity(records.len());
        for record in records {
            let install = installs
                .iter()
                .position(|install| install.agent == record.user_id)
                .map(|index| installs.swap_remove(index));
            agents.push(self.team_agent_with(record, install).await?);
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

        // An agent on its owner's own machine stops there first, so its last
        // push lands; its removal finishes once the machine stopped it (or
        // the wait gave up), and again here is a no-op until then.
        if self.installs.for_agent(&record.user_id).await?.is_some() {
            return self.remove_installed(&record).await;
        }

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
        name = "team_agents.set_avatar",
        skip_all,
        fields(team_id = %receipt.entity().entity_id, agent_user_id = %agent_credentials::telemetry_id(agent.as_ref())),
        err
    )]
    async fn set_avatar(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent: &MacroUserIdStr<'_>,
        avatar: AgentAvatar,
    ) -> Result<(), TeamAgentError> {
        self.ensure_enabled(&acting_user(&receipt)?).await?;
        let record = self.team_record(&receipt, agent).await?;
        avatar.validate(&self.pictures)?;
        let saved = self
            .repository
            .set_avatar(record.team_id, &record.user_id, &avatar)
            .await
            .map_err(TeamAgentError::internal)?;
        if !saved {
            return Err(TeamAgentError::NotFound);
        }
        self.picture_changes
            .picture_changed(&record.user_id, avatar.url.as_deref());
        Ok(())
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

    #[tracing::instrument(name = "team_agents.hosts", skip_all, fields(team_id = %receipt.entity().entity_id), err)]
    async fn hosts(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
    ) -> Result<TeammateHosts, TeamAgentError> {
        let caller = acting_user(&receipt)?;
        self.ensure_enabled(&caller).await?;
        self.ensure_self_hosting(&caller).await?;
        let hosts = self.installs.hosts_of(&caller).await?;
        Ok(TeammateHosts {
            hosts: hosts
                .into_iter()
                .map(|facts| TeammateHost::new(facts, &*self.images))
                .collect(),
        })
    }

    #[tracing::instrument(
        name = "team_agents.move_install",
        skip_all,
        fields(team_id = %receipt.entity().entity_id, agent_user_id = %agent_credentials::telemetry_id(agent.as_ref()), harness_id = %request.harness_id),
        err
    )]
    async fn move_install(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        agent: &MacroUserIdStr<'_>,
        request: MoveTeammate,
    ) -> Result<TeamAgent, TeamAgentError> {
        self.move_installed(receipt, agent, request.harness_id)
            .await
    }

    #[tracing::instrument(
        name = "team_agents.issue_install",
        skip(self),
        fields(agent_user_id = tracing::field::Empty),
        err
    )]
    async fn issue_install(
        &self,
        harness: HarnessId,
        install_id: Uuid,
        reported: Option<(u64, u64)>,
    ) -> Result<Option<IssuedInstall>, AgentEnrollmentError> {
        self.issue_installed(harness, install_id, reported).await
    }

    #[tracing::instrument(name = "team_agents.finish_checkpoint", skip(self), err)]
    async fn finish_checkpoint(&self, install_id: Uuid) -> Result<(), TeamAgentError> {
        self.finish_installed_checkpoint(install_id).await
    }

    #[tracing::instrument(
        name = "team_agents.offboard_hosts",
        skip(self),
        fields(offboarded = tracing::field::Empty, revoked = tracing::field::Empty),
        err
    )]
    async fn offboard_unentitled_hosts(&self) -> Result<usize, TeamAgentError> {
        let (offboarded, revoked) = self.offboard_unentitled().await?;
        let span = tracing::Span::current();
        span.record("offboarded", offboarded);
        span.record("revoked", revoked);
        Ok(offboarded)
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

        let addresses = self.environment.environment().map_err(|error| {
            tracing::error!(error = ?error, "could not resolve the agent's addresses");
            AgentEnrollmentError::IssuanceFailed
        })?;
        let env = agent_env(
            addresses,
            &api_key,
            &agent,
            &record,
            repo,
            Placement::Computer(computer_id),
        )?;
        tracing::info!(generation = generation.get(), "issued agent enrollment");

        Ok(Some(AgentEnrollment {
            agent_user_id: agent,
            env,
        }))
    }
}

/// hosted_runtimes takes back the agent of a computer released after a failed
/// first start through here.
impl<Repository, Membership, ApiKeys, Repos, Computer, Creators, Flags, Notices, Installs, Runtimes>
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
        Installs,
        Runtimes,
    >
where
    Repository: TeamAgentRepository,
    Membership: TeamMembership,
    ApiKeys: AgentApiKeys,
    Repos: AgentRepos,
    Computer: Computers,
    Creators: agent_credentials::AgentCreators + 'static,
    Flags: FeatureFlags + 'static,
    Notices: AgentReadyNotices,
    Installs: TeammateInstalls,
    Runtimes: TeammateRuntimes,
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
