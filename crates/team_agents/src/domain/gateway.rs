//! Authorization for a standalone brain's model gateway requests.

use hosted_runtimes::domain::ids::ComputerId;
use std::{future::Future, pin::Pin};

use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use super::models::{AgentApiKey, TeamAgent};

/// Facts resolved from a valid, revocable user API key.
pub struct BrainGatewayAccount {
    /// The authenticated key owner.
    pub user_id: MacroUserIdStr<'static>,
    /// The owner's registered team-agent account, if any.
    pub agent: Option<TeamAgent>,
    /// Current team memberships, independent of the agent registration.
    pub teams: Vec<Uuid>,
}

/// A computer's eligibility for brain model access.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BrainComputerPhase {
    /// The computer is running.
    Running,
    /// Its RAM is frozen; it must be woken before serving.
    Frozen,
    /// The computer was explicitly stopped.
    Stopped,
    /// The computer was released.
    Released,
    /// Any other phase, including provisioning and suspended computers.
    Other,
}

/// Computer facts used by gateway authorization.
pub struct BrainGatewayComputer {
    /// The computer's owning team.
    pub team_id: Uuid,
    /// The current lifecycle phase.
    pub phase: BrainComputerPhase,
}

/// Resolve credentials and account/membership facts without applying access policy.
pub trait BrainGatewayDirectory: Send + Sync + 'static {
    /// None for an invalid or revoked API key.
    fn lookup(
        &self,
        key: &AgentApiKey,
    ) -> impl Future<Output = Result<Option<BrainGatewayAccount>, BrainGatewayError>> + Send;
}

/// The computer lifecycle capabilities needed by brain authorization.
pub trait BrainGatewayComputers: Send + Sync + 'static {
    /// Current computer facts, or None for a missing computer.
    fn get(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<Option<BrainGatewayComputer>, BrainGatewayError>> + Send;
    /// Wake an existing frozen computer, returning its resulting facts.
    fn wake(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<Option<BrainGatewayComputer>, BrainGatewayError>> + Send;
}

/// Validated attribution, with no credential retained.
#[derive(Debug, Clone)]
pub struct BrainGatewayIdentity {
    /// Agent whose key authorized the request and whose usage is counted.
    pub user_id: MacroUserIdStr<'static>,
    /// The agent's sole current team, whose allowance pays for its work.
    pub team_id: Uuid,
    /// Its running computer.
    pub computer_id: ComputerId,
}

/// Sanitized gateway access failures.
#[derive(Debug, thiserror::Error)]
pub enum BrainGatewayError {
    /// No valid registered team-agent key.
    #[error("a team-agent API key is required")]
    Unauthorized,
    /// Missing membership or a computer that cannot serve brain work.
    #[error("a running team-agent computer is required")]
    Forbidden,
    /// Account or computer facts could not be verified.
    #[error("brain gateway authorization is temporarily unavailable")]
    Unavailable,
}

/// Object-safe authorization future for the gateway composition root.
pub type BrainGatewayFuture<'a> =
    Pin<Box<dyn Future<Output = Result<BrainGatewayIdentity, BrainGatewayError>> + Send + 'a>>;

/// Access boundary for the standalone-brain gateway route.
pub trait BrainGatewayAccess: Send + Sync + 'static {
    /// Authenticate a key and authorize its agent's running computer.
    fn authorize<'a>(&'a self, key: &'a AgentApiKey) -> BrainGatewayFuture<'a>;
}

/// Keeps key, team and computer access policy in the team-agent domain.
pub struct BrainGatewayAuthorizer<Directory, Computers> {
    directory: Directory,
    computers: Computers,
}

impl<Directory, Computers> BrainGatewayAuthorizer<Directory, Computers> {
    /// Compose the credential/account directory and lifecycle adapter.
    pub fn new(directory: Directory, computers: Computers) -> Self {
        Self {
            directory,
            computers,
        }
    }
}

impl<Directory: BrainGatewayDirectory, Computers: BrainGatewayComputers> BrainGatewayAccess
    for BrainGatewayAuthorizer<Directory, Computers>
{
    fn authorize<'a>(&'a self, key: &'a AgentApiKey) -> BrainGatewayFuture<'a> {
        Box::pin(async move {
            let account = self
                .directory
                .lookup(key)
                .await?
                .ok_or(BrainGatewayError::Unauthorized)?;
            let agent = account.agent.ok_or(BrainGatewayError::Unauthorized)?;
            // The DB also enforces one team per user. Verify the exact binding
            // so the shared AI allowance/settlement resolver bills this team.
            if agent.user_id != account.user_id || account.teams.as_slice() != [agent.team_id] {
                return Err(BrainGatewayError::Forbidden);
            }
            let computer_id = agent.computer_id.ok_or(BrainGatewayError::Forbidden)?;
            let mut computer = self
                .computers
                .get(computer_id)
                .await?
                .ok_or(BrainGatewayError::Forbidden)?;
            if computer.team_id != agent.team_id {
                return Err(BrainGatewayError::Forbidden);
            }
            if computer.phase == BrainComputerPhase::Frozen {
                computer = self
                    .computers
                    .wake(computer_id)
                    .await?
                    .ok_or(BrainGatewayError::Forbidden)?;
            }
            if computer.team_id != agent.team_id || computer.phase != BrainComputerPhase::Running {
                return Err(BrainGatewayError::Forbidden);
            }
            Ok(BrainGatewayIdentity {
                user_id: account.user_id,
                team_id: agent.team_id,
                computer_id,
            })
        })
    }
}
