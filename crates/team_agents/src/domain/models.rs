//! Domain models for team agents.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Longest agent name, in characters.
pub const MAX_NAME_CHARS: usize = 80;

/// Longest job description or personality, in characters.
pub const MAX_PROFILE_CHARS: usize = 4000;

/// A team agent: an AI teammate with its own Macro account on a team.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct TeamAgent {
    /// The agent's Macro user id (`macro|<email>`).
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub user_id: MacroUserIdStr<'static>,
    /// Team the agent belongs to.
    pub team_id: Uuid,
    /// Display name.
    pub name: String,
    /// What the agent is responsible for.
    pub job_description: String,
    /// How the agent behaves and talks.
    pub personality: String,
    /// The agent's email address.
    pub email: String,
    /// Admin who created the agent; it takes operating instructions from them.
    #[cfg_attr(feature = "inbound", schema(value_type = Option<String>))]
    pub created_by: Option<MacroUserIdStr<'static>>,
    /// The macrod runtime the agent's brain runs on.
    pub harness_id: Option<Uuid>,
    /// The Macro agent (bot) bound to the brain's runtime.
    pub brain_bot_id: Option<Uuid>,
    /// The brain's first agent session, where it set itself up.
    pub brain_session_id: Option<Uuid>,
    /// When the agent was created.
    pub created_at: DateTime<Utc>,
}

/// Input for creating a team agent.
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct CreateTeamAgent {
    /// Display name.
    pub name: String,
    /// What the agent is responsible for.
    pub job_description: String,
    /// How the agent behaves and talks.
    pub personality: String,
    /// Profile picture URL (a static file the caller uploaded).
    pub avatar_url: Option<String>,
    /// The team macrod runtime to run the agent's brain on.
    pub harness_id: Uuid,
    /// The runtime's model for the brain's sessions.
    pub model: String,
}

/// A new agent account to store.
#[derive(Debug, Clone)]
pub struct NewAgentAccount {
    /// The agent's Macro user id.
    pub user_id: MacroUserIdStr<'static>,
    /// The agent's email address (lowercase).
    pub email: String,
    /// Team the agent joins.
    pub team_id: Uuid,
    /// Admin creating the agent.
    pub created_by: MacroUserIdStr<'static>,
    /// Display name.
    pub name: String,
    /// What the agent is responsible for.
    pub job_description: String,
    /// How the agent behaves and talks.
    pub personality: String,
    /// Profile picture URL.
    pub avatar_url: Option<String>,
    /// The brain's runtime.
    pub harness_id: Uuid,
    /// The agent's mailbox at the email provider, when one was created.
    pub mailbox_id: Option<String>,
}

/// A mailbox created for an agent.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mailbox {
    /// Provider id of the mailbox; `None` when no email provider is set up.
    pub mailbox_id: Option<String>,
    /// The mailbox's address.
    pub email: String,
}

/// One email in an agent's mailbox.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct EmailMessage {
    /// Provider message id.
    pub message_id: String,
    /// Provider thread id.
    pub thread_id: String,
    /// Sender.
    pub from: String,
    /// Recipients.
    pub to: Vec<String>,
    /// Subject line.
    pub subject: Option<String>,
    /// Short preview of the body.
    pub preview: Option<String>,
    /// Plain-text body, when fetched individually.
    pub text: Option<String>,
    /// When the provider received or sent it.
    pub received_at: DateTime<Utc>,
}

/// A page of an agent's emails, newest first.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct EmailMessages {
    /// The emails.
    pub messages: Vec<EmailMessage>,
}

/// An email for an agent to send.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SendEmail {
    /// Recipients.
    pub to: Vec<String>,
    /// Subject line.
    pub subject: String,
    /// Plain-text body.
    pub text: String,
    /// Optional HTML body.
    pub html: Option<String>,
}

/// The provider's id for a sent email.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SentEmail {
    /// Provider message id.
    pub message_id: String,
}

/// What the brain launcher needs to start an agent's brain.
#[derive(Debug, Clone)]
pub struct BrainLaunch {
    /// The agent's own API key; the brain acts with it.
    pub api_key: String,
    /// Bot to open the session as.
    pub bot_id: Uuid,
    /// Session id to create.
    pub session_id: Uuid,
    /// The setup prompt.
    pub prompt: String,
}

/// Errors from team agent operations.
#[derive(Debug, thiserror::Error)]
pub enum TeamAgentError {
    /// The request is malformed.
    #[error("{0}")]
    BadRequest(String),
    /// The caller is not a team agent.
    #[error("the caller is not a team agent")]
    NotAnAgent,
    /// Email is not set up on this deployment, or the agent has no mailbox.
    #[error("email is not available for this agent")]
    EmailUnavailable,
    /// The caller may not do this.
    #[error("not allowed")]
    Forbidden,
    /// Team agents aren't available to the caller yet (feature flag).
    #[error("team agents aren't available for this account yet")]
    NotEnabled,
    /// The brain's runtime refused the agent (offline, not a team runtime).
    #[error("the runtime could not take this agent: {0}")]
    Runtime(String),
    /// The email provider failed.
    #[error("the email provider failed: {0}")]
    EmailProvider(rootcause::Report),
    /// Anything else.
    #[error("internal error: {0}")]
    Internal(rootcause::Report),
}

impl TeamAgentError {
    /// Wrap an adapter error as internal.
    pub fn internal<E: std::error::Error + Send + Sync + 'static>(error: E) -> Self {
        Self::Internal(rootcause::Report::new(error).into_dynamic())
    }
}
