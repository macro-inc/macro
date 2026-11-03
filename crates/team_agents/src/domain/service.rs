//! Team agent service implementation.

use entity_access::domain::models::{AdminTeamRole, EntityAccessReceipt};
use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::models::{
    BrainLaunch, CreateTeamAgent, EmailMessage, EmailMessages, MAX_NAME_CHARS, MAX_PROFILE_CHARS,
    NewAgentAccount, SendEmail, SentEmail, TeamAgent, TeamAgentError,
};
use super::ports::{
    AgentApiKeys, BrainLauncher, Mailboxes, TeamAgentRepository, TeamAgentService, TeamMembership,
};

#[cfg(test)]
mod test;

const BOOTSTRAP_PROMPT: &str = include_str!("bootstrap_prompt.md");

/// Where the brain finds Macro, rendered into its setup prompt.
#[derive(Debug, Clone)]
pub struct BrainEnvironment {
    /// `local`, `dev`, or `prod`.
    pub environment: String,
    /// Storage (DSS) base URL.
    pub storage_url: String,
    /// Auth service base URL.
    pub auth_url: String,
    /// Cognition base URL.
    pub cognition_url: String,
    /// Agent harness base URL.
    pub harness_url: String,
}

/// Team agent service backed by its ports.
pub struct TeamAgentServiceImpl<R, T, K, M, B> {
    repo: R,
    teams: T,
    keys: K,
    mailboxes: M,
    launcher: B,
    environment: BrainEnvironment,
}

impl<R, T, K, M, B> TeamAgentServiceImpl<R, T, K, M, B> {
    /// Builds the service.
    pub fn new(
        repo: R,
        teams: T,
        keys: K,
        mailboxes: M,
        launcher: B,
        environment: BrainEnvironment,
    ) -> Self {
        Self {
            repo,
            teams,
            keys,
            mailboxes,
            launcher,
            environment,
        }
    }
}

/// Lowercase ASCII letters and digits of `name`, joined by `-`, for the
/// agent's email username and folder name.
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

    if slug.is_empty() {
        "agent".to_string()
    } else {
        slug.chars().take(32).collect()
    }
}

fn validate(request: &CreateTeamAgent) -> Result<(), TeamAgentError> {
    let name = request.name.trim();

    if name.is_empty() || name.chars().count() > MAX_NAME_CHARS {
        return Err(TeamAgentError::BadRequest(format!(
            "name must be 1 to {MAX_NAME_CHARS} characters"
        )));
    }

    for (field, value) in [
        ("job description", &request.job_description),
        ("personality", &request.personality),
    ] {
        if value.trim().is_empty() || value.chars().count() > MAX_PROFILE_CHARS {
            return Err(TeamAgentError::BadRequest(format!(
                "{field} must be 1 to {MAX_PROFILE_CHARS} characters"
            )));
        }
    }

    Ok(())
}

/// The setup prompt for a new agent's brain.
pub fn render_bootstrap_prompt(
    agent: &TeamAgent,
    api_key: &str,
    environment: &BrainEnvironment,
) -> String {
    let email_section = if agent.email.ends_with(".invalid") {
        "\nYou have no working email inbox yet; your address is a placeholder.".to_string()
    } else {
        format!(
            "\nYour email inbox ({email}) works through Macro: \
             `GET {auth}/team_agents/me/email/messages?limit=20` lists your newest \
             emails, `GET {auth}/team_agents/me/email/messages/<messageId>` reads \
             one, and `POST {auth}/team_agents/me/email/send` with \
             `{{\"to\":[..],\"subject\":..,\"text\":..}}` sends one. Use it like a \
             person would: signing up for things, 2FA codes, writing to people \
             outside the team.",
            email = agent.email,
            auth = environment.auth_url,
        )
    };

    let created_by = agent
        .created_by
        .as_ref()
        .map(|user_id| user_id.as_ref().to_string())
        .unwrap_or_else(|| "your team's admins".to_string());

    BOOTSTRAP_PROMPT
        .replace("{{name}}", &agent.name)
        .replace("{{slug}}", &slug(&agent.name))
        .replace("{{job_description}}", &agent.job_description)
        .replace("{{personality}}", &agent.personality)
        .replace("{{user_id}}", agent.user_id.as_ref())
        .replace("{{team_id}}", &agent.team_id.to_string())
        .replace("{{email}}", &agent.email)
        .replace("{{creator}}", &created_by)
        .replace("{{api_key}}", api_key)
        .replace("{{environment}}", &environment.environment)
        .replace("{{storage_url}}", &environment.storage_url)
        .replace("{{auth_url}}", &environment.auth_url)
        .replace("{{cognition_url}}", &environment.cognition_url)
        .replace("{{harness_url}}", &environment.harness_url)
        .replace("{{email_section}}", &email_section)
}

impl<R, T, K, M, B> TeamAgentServiceImpl<R, T, K, M, B>
where
    R: TeamAgentRepository,
    T: TeamMembership,
    K: AgentApiKeys,
    M: Mailboxes,
    B: BrainLauncher,
{
    /// Undoes a partly created agent. Best effort: each step logs its own
    /// failure so the rest still run.
    async fn discard(&self, user_id: Option<&MacroUserIdStr<'_>>, mailbox_id: Option<&str>) {
        if let Some(user_id) = user_id {
            let _ = self
                .repo
                .delete_account(user_id)
                .await
                .inspect_err(|error| tracing::error!(error = ?error, "could not delete a partly created team agent"));
        }

        if let Some(mailbox_id) = mailbox_id {
            let _ = self
                .mailboxes
                .delete(mailbox_id)
                .await
                .inspect_err(|error| tracing::error!(error = ?error, "could not delete a partly created team agent's mailbox"));
        }
    }

    async fn agent(&self, caller: &MacroUserIdStr<'_>) -> Result<TeamAgent, TeamAgentError> {
        self.repo
            .get(caller)
            .await
            .map_err(TeamAgentError::internal)?
            .ok_or(TeamAgentError::NotAnAgent)
    }

    async fn mailbox(&self, caller: &MacroUserIdStr<'_>) -> Result<String, TeamAgentError> {
        self.agent(caller).await?;

        self.repo
            .mailbox_id(caller)
            .await
            .map_err(TeamAgentError::internal)?
            .ok_or(TeamAgentError::EmailUnavailable)
    }
}

impl<R, T, K, M, B> TeamAgentService for TeamAgentServiceImpl<R, T, K, M, B>
where
    R: TeamAgentRepository,
    T: TeamMembership,
    K: AgentApiKeys,
    M: Mailboxes,
    B: BrainLauncher,
{
    #[tracing::instrument(skip_all, fields(team_id, agent_user_id, harness_id = %request.harness_id), err)]
    async fn create(
        &self,
        receipt: EntityAccessReceipt<AdminTeamRole>,
        request: CreateTeamAgent,
    ) -> Result<TeamAgent, TeamAgentError> {
        validate(&request)?;

        if request.model.trim().is_empty() {
            return Err(TeamAgentError::BadRequest(
                "pick a model for the brain".to_string(),
            ));
        }

        let team_id = Uuid::parse_str(&receipt.entity().entity_id)
            .map_err(|_| TeamAgentError::BadRequest("the caller has no team".to_string()))?;
        let created_by = receipt
            .acting_user_id()
            .cloned()
            .ok_or(TeamAgentError::Forbidden)?;
        tracing::Span::current().record("team_id", tracing::field::display(team_id));

        let name = request.name.trim().to_string();

        // A short suffix keeps two agents with the same name apart.
        let suffix: String = Uuid::now_v7()
            .simple()
            .to_string()
            .chars()
            .rev()
            .take(6)
            .collect();
        let username = format!("{}-{suffix}", slug(&name));
        let mailbox = self.mailboxes.create(&username, &name).await?;
        let email = mailbox.email.to_lowercase();

        let user_id = MacroUserIdStr::parse_from_str(&format!("macro|{email}"))
            .map_err(|_| TeamAgentError::BadRequest(format!("{email} is not a usable address")))?
            .into_owned();
        tracing::Span::current().record("agent_user_id", tracing::field::display(&user_id));

        let account = NewAgentAccount {
            user_id: user_id.clone(),
            email: email.clone(),
            team_id,
            created_by: created_by.clone(),
            name: name.clone(),
            job_description: request.job_description.trim().to_string(),
            personality: request.personality.trim().to_string(),
            avatar_url: request.avatar_url,
            harness_id: request.harness_id,
            mailbox_id: mailbox.mailbox_id.clone(),
        };

        if let Err(error) = self.repo.create_account(&account).await {
            self.discard(None, mailbox.mailbox_id.as_deref()).await;
            return Err(TeamAgentError::internal(error));
        }

        let launched = async {
            self.teams.add_agent(receipt, &user_id).await?;
            let api_key = self.keys.mint(&user_id).await?;
            let bot_id = self
                .launcher
                .bind(&api_key, &name, request.harness_id, team_id, &request.model)
                .await?;
            let session_id = Uuid::now_v7();

            self.repo
                .set_brain(&user_id, bot_id, session_id)
                .await
                .map_err(TeamAgentError::internal)?;

            let agent = self.agent(&user_id).await?;
            let prompt = render_bootstrap_prompt(&agent, &api_key, &self.environment);

            self.launcher.start(BrainLaunch {
                api_key,
                bot_id,
                session_id,
                prompt,
            });

            Ok(agent)
        }
        .await;

        if launched.is_err() {
            self.discard(Some(&user_id), mailbox.mailbox_id.as_deref())
                .await;
        }

        launched
    }

    #[tracing::instrument(skip(self), err)]
    async fn me(&self, caller: &MacroUserIdStr<'_>) -> Result<TeamAgent, TeamAgentError> {
        self.agent(caller).await
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
