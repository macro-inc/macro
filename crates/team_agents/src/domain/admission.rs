//! Whether an account is an agent teammate the vault may admit: the facts a
//! caller outside this crate (the vault's `AgentDirectory`) needs, read from
//! the owning domains each time and never cached.
//!
//! An agent is admitted to a team when its `team_agents` row is for that
//! team, its account is marked as an agent and still a member, a human
//! (not an agent) created it, and a computer that isn't released runs it:
//! a `hosted_runtime` whose `agent_user_id` is the agent. A purchase still
//! confirming is not a computer yet. Any dependency failing fails closed.

use macro_user_id::cowlike::CowLike;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::models::ComputerState;
use super::ports::{AgentAccounts, Computers};

#[cfg(test)]
mod test;

/// What the agent's own account says about it, from `team_agents`, `"User"`
/// and `team_user`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentAccountFacts {
    /// The team its `team_agents` row is for.
    pub team_id: Uuid,
    /// Whether `"User"."isAgent"` is set.
    pub is_agent: bool,
    /// Whether it is still a member of that team.
    pub member: bool,
    /// Who created it, if that account still exists.
    pub created_by: Option<MacroUserIdStr<'static>>,
    /// Whether the creator's account is itself an agent.
    pub created_by_is_agent: bool,
}

/// An admitted agent, with the human responsible for it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AdmittedAgent {
    /// The agent's Macro user id.
    pub agent_user_id: MacroUserIdStr<'static>,
    /// The team it is admitted to.
    pub team_id: Uuid,
    /// The human who created it (`team_agents.created_by`). Not a grant of
    /// anything: only who answers for the agent.
    pub responsible_human_user_id: MacroUserIdStr<'static>,
}

/// Why an account is not an admitted agent of a team.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum NotAdmitted {
    /// No `team_agents` row, or the account isn't marked as an agent.
    #[error("not an agent teammate")]
    NotAnAgent,
    /// An agent of another team.
    #[error("an agent of another team")]
    OtherTeam,
    /// No longer a member of its team.
    #[error("no longer a member of its team")]
    NotAMember,
    /// Its creator is gone, or is an agent.
    #[error("no human is responsible for it")]
    NoResponsibleHuman,
    /// No computer runs it, or only a purchase still confirming.
    #[error("no computer runs it")]
    NoComputer,
    /// Its computer is released.
    #[error("its computer is released")]
    ComputerReleased,
}

/// Admission's outcome when it isn't an admitted agent.
#[derive(Debug, thiserror::Error)]
pub enum AdmissionError {
    /// The facts deny it.
    #[error(transparent)]
    NotAdmitted(#[from] NotAdmitted),
    /// A dependency failed, so nothing is admitted (fail closed). The cause
    /// is logged where it happened, never returned.
    #[error("agent admission is unavailable")]
    Unavailable,
}

/// The pure decision, over facts already read.
pub fn decide(
    agent_user_id: &MacroUserIdStr<'_>,
    team_id: Uuid,
    account: Option<AgentAccountFacts>,
    computer: Option<ComputerState>,
) -> Result<AdmittedAgent, NotAdmitted> {
    let account = account.ok_or(NotAdmitted::NotAnAgent)?;
    if !account.is_agent {
        return Err(NotAdmitted::NotAnAgent);
    }
    if account.team_id != team_id {
        return Err(NotAdmitted::OtherTeam);
    }
    if !account.member {
        return Err(NotAdmitted::NotAMember);
    }
    let responsible = match account.created_by {
        Some(creator) if !account.created_by_is_agent => creator,
        _ => return Err(NotAdmitted::NoResponsibleHuman),
    };
    match computer {
        None | Some(ComputerState::Purchasing) => return Err(NotAdmitted::NoComputer),
        Some(ComputerState::Released) => return Err(NotAdmitted::ComputerReleased),
        Some(
            ComputerState::SettingUp
            | ComputerState::Ready
            | ComputerState::Paused
            | ComputerState::Failed,
        ) => {}
    }
    Ok(AdmittedAgent {
        agent_user_id: agent_user_id.clone().into_owned(),
        team_id,
        responsible_human_user_id: responsible,
    })
}

/// Agent admission over the account and computer ports.
pub struct AgentAdmission<Accounts, Computer> {
    accounts: Accounts,
    computers: Computer,
}

impl<Accounts: AgentAccounts, Computer: Computers> AgentAdmission<Accounts, Computer> {
    /// Build it.
    pub fn new(accounts: Accounts, computers: Computer) -> Self {
        Self {
            accounts,
            computers,
        }
    }

    /// Whether `agent_user_id` is an admitted agent of `team_id`, from
    /// current facts.
    #[tracing::instrument(
        name = "team_agents.admit",
        skip_all,
        fields(
            team_id = %team_id,
            agent_user_id = %agent_credentials::telemetry_id(agent_user_id.as_ref()),
            outcome = tracing::field::Empty,
        )
    )]
    pub async fn admit(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        team_id: Uuid,
    ) -> Result<AdmittedAgent, AdmissionError> {
        let result = self.read_and_decide(agent_user_id, team_id).await;
        let outcome = match &result {
            Ok(_) => "admitted",
            Err(AdmissionError::NotAdmitted(_)) => "not_admitted",
            Err(AdmissionError::Unavailable) => "unavailable",
        };
        tracing::Span::current().record("outcome", outcome);
        result
    }

    async fn read_and_decide(
        &self,
        agent_user_id: &MacroUserIdStr<'_>,
        team_id: Uuid,
    ) -> Result<AdmittedAgent, AdmissionError> {
        let account = self
            .accounts
            .account_facts(agent_user_id)
            .await
            .map_err(|error| {
                tracing::warn!(error = %error, "agent account facts unavailable");
                AdmissionError::Unavailable
            })?;
        // Decide on the account first, so a non-agent never costs a computer lookup.
        decide(
            agent_user_id,
            team_id,
            account.clone(),
            Some(ComputerState::Ready),
        )?;
        let computer = self
            .computers
            .computer_for_agent(team_id, agent_user_id)
            .await
            .map_err(|error| {
                tracing::warn!(error = %error, "agent computer lookup unavailable");
                AdmissionError::Unavailable
            })?;
        let state = match computer {
            None => None,
            Some(computer) => Some(self.computers.state(team_id, computer).await.map_err(
                |error| {
                    tracing::warn!(error = %error, "agent computer state unavailable");
                    AdmissionError::Unavailable
                },
            )?),
        };
        Ok(decide(agent_user_id, team_id, account, state)?)
    }
}
