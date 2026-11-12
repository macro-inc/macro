//! What the control plane and `harnessd`, the agent sign-in daemon on a
//! Macro computer, say to each other: one JSON [`Request`] per line in, one
//! JSON [`Response`] per line out.
//!
//! Every message names its agent, so a second agent adds an
//! [`AgentProvider`] variant and its own nested account fields without a new
//! command.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod test;

/// Whose account an agent signs in to: the Postgres `agent_provider` enum of
/// `provider_accounts.provider` and `harness_account_logins.provider`. New
/// providers add a value there.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    strum::AsRefStr,
    strum::EnumString,
)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[cfg_attr(feature = "sqlx", derive(sqlx::Type))]
#[cfg_attr(
    feature = "sqlx",
    sqlx(type_name = "agent_provider", rename_all = "snake_case")
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum AgentProvider {
    /// An Anthropic Claude account, for Claude Code.
    Claude,
}

impl AgentProvider {
    /// The agent's name as people see it, e.g. in a notification title.
    pub fn display_name(self) -> &'static str {
        match self {
            Self::Claude => "Claude",
        }
    }
}

/// A command for harnessd.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case")]
pub enum Request {
    /// Start a sign-in and answer with the URL the user opens. While one
    /// started recently is still waiting, answer with its URL again.
    SignInStart {
        /// The agent to sign in.
        agent: AgentProvider,
    },
    /// Finish the waiting sign-in with the code the user pasted.
    SignInComplete {
        /// The agent being signed in.
        agent: AgentProvider,
        /// The pasted code.
        code: String,
    },
    /// Abandon the waiting sign-in, if any, including one a
    /// [`Request::SignInComplete`] is still finishing.
    SignInCancel {
        /// The agent being signed in.
        agent: AgentProvider,
    },
    /// Forget the agent's credential on this computer, so its sessions run
    /// on Macro credits.
    SignOut {
        /// The agent to sign out.
        agent: AgentProvider,
    },
    /// Report the agent's sign-in state.
    Status {
        /// The agent to report on.
        agent: AgentProvider,
    },
}

impl Request {
    /// The agent this request is about.
    pub fn agent(&self) -> AgentProvider {
        match self {
            Self::SignInStart { agent }
            | Self::SignInComplete { agent, .. }
            | Self::SignInCancel { agent }
            | Self::SignOut { agent }
            | Self::Status { agent } => *agent,
        }
    }
}

/// harnessd's answer to one [`Request`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum Response {
    /// A sign-in is waiting for the user at `url`.
    SignInStarted {
        /// The agent being signed in.
        agent: AgentProvider,
        /// Where the user signs in, in their own browser.
        url: String,
    },
    /// The agent has a credential on this computer.
    SignedIn {
        /// The signed-in agent.
        agent: AgentProvider,
        /// Claude's details; present exactly when `agent` is Claude.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        claude: Option<ClaudeAccount>,
    },
    /// The agent has no credential; its sessions run on Macro credits.
    SignedOut {
        /// The signed-out agent.
        agent: AgentProvider,
    },
    /// No credential yet, and a sign-in is waiting for its code.
    Pending {
        /// The agent being signed in.
        agent: AgentProvider,
    },
    /// The request failed.
    Error {
        /// The agent the request named; absent when the request could not
        /// be read.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        agent: Option<AgentProvider>,
        /// What went wrong.
        kind: ErrorKind,
    },
}

/// Claude Code's credential on a computer: a long-lived token from
/// `claude setup-token`, which never leaves the computer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClaudeAccount {
    /// A stable, non-secret id of the stored token (a SHA-256 prefix of
    /// it). The token carries no account identity, so this stands in for
    /// one: a new sign-in gives a new id.
    pub credential_id: String,
    /// When the token stops working.
    pub expires_at: Option<DateTime<Utc>>,
}

/// Why a request failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    /// The line was not a request harnessd understands.
    InvalidRequest,
    /// The pasted text is not a code the agent could have shown.
    MalformedCode,
    /// The provider rejected the code; start a new sign-in.
    InvalidCode,
    /// Nothing is waiting for a code; start a sign-in first.
    NoPendingSignIn,
    /// A [`Request::SignInCancel`] or newer sign-in ended this one.
    Cancelled,
    /// The agent's CLI did not answer in time.
    Timeout,
    /// The agent's CLI failed; harnessd logs the detail.
    Failed,
    /// harnessd is not running on this computer.
    Unavailable,
}
