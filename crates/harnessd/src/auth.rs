//! The port every agent's sign-in adapter implements.

use harnessd_protocol::{AgentProvider, ClaudeAccount, ErrorKind};
use std::future::Future;

/// One agent's sign-in on this computer.
pub trait AgentAuth: Send + Sync + 'static {
    /// Start a sign-in, or return the one still waiting, and give the URL
    /// the user opens.
    fn start(&self) -> impl Future<Output = Result<String, ErrorKind>> + Send;

    /// Finish the waiting sign-in with the pasted code.
    fn complete(&self, code: String)
    -> impl Future<Output = Result<AgentStatus, ErrorKind>> + Send;

    /// Abandon the waiting sign-in, interrupting a `complete` that waits on
    /// it, and report the status left behind.
    fn cancel(&self) -> impl Future<Output = Result<AgentStatus, ErrorKind>> + Send;

    /// Abandon any sign-in and forget the credential.
    fn sign_out(&self) -> impl Future<Output = Result<(), ErrorKind>> + Send;

    /// The agent's sign-in state.
    fn status(&self) -> impl Future<Output = Result<AgentStatus, ErrorKind>> + Send;
}

/// Where an agent's sign-in stands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentStatus {
    /// A credential is stored.
    SignedIn(Account),
    /// No credential, and a sign-in waits for its code.
    Pending,
    /// No credential.
    SignedOut,
}

/// A stored credential's details, per agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Account {
    Claude(ClaudeAccount),
}

/// The adapter for each agent harnessd signs in.
pub struct Agents<Claude> {
    pub claude: Claude,
}

impl<Claude: AgentAuth> Agents<Claude> {
    /// The adapter that signs `agent` in.
    pub fn adapter(&self, agent: AgentProvider) -> &Claude {
        match agent {
            AgentProvider::Claude => &self.claude,
        }
    }
}
