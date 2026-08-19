//! Harness domain errors.

use agent_runtime_protocol::domain::action::ActionError;
use agent_runtime_protocol::domain::ports::TransportError;
use agent_session::domain::error::AgentSessionError;
use agent_session::domain::model::AgentSessionId;

/// A `Result` whose error is a [`HarnessError`].
pub type Result<T, E = HarnessError> = std::result::Result<T, E>;

/// A failure while provisioning or running an agent session.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum HarnessError {
    /// A container could not be spawned or reattached.
    #[error("container unavailable: {0}")]
    Container(String),
    /// The session's owner has no Cursor API key registered.
    ///
    /// Its own variant because it is the one provisioning failure that is the
    /// user's to fix, and the most likely first run of `@cursor` there is.
    ///
    /// Phrased for a reader rather than an operator, but be aware of where it
    /// currently lands: the trigger path announces the session *before* it
    /// spawns, so a spawn failure marks the session disconnected and returns,
    /// and this sentence reaches a log. What the user sees is a session chip
    /// whose session never answers. Closing that needs a way to post a failure
    /// back to the thread, which [`crate::domain::ports::SessionAnnouncer`]
    /// does not have — it announces sessions and nothing else.
    #[error("connect your Cursor account in Settings → Connections to use @cursor")]
    CursorNotConnected,
    /// The agent would not open an ACP session.
    #[error("acp handshake failed: {0}")]
    Handshake(String),
    /// The session has no container to talk to any more.
    #[error("agent session {0} is no longer connected")]
    Disconnected(AgentSessionId),
    /// The session's transport failed.
    #[error(transparent)]
    Transport(#[from] TransportError),
    /// An action could not be expressed as ACP.
    #[error(transparent)]
    Action(#[from] ActionError),
    /// Building or reading an ACP message failed.
    #[error(transparent)]
    Acp(#[from] agent_client_protocol::Error),
    /// Reading or writing the session's persistent state failed.
    #[error(transparent)]
    Session(#[from] AgentSessionError),
    /// A session command worker stopped before reporting its result.
    #[error("agent session {0} command worker stopped")]
    CommandWorkerStopped(AgentSessionId),
    /// The sandbox's egress environment could not be prepared: no signing
    /// key, no repository, or the owner's connected servers could not be read.
    #[error("failed to provision sandbox egress: {0}")]
    Egress(rootcause::Report),
    /// The session link could not be posted back to the mention's thread.
    #[error("failed to announce the agent session: {0}")]
    Announce(rootcause::Report),
    /// Required context for a channel-originated prompt could not be loaded.
    #[error("failed to load channel prompt context: {0}")]
    PromptContext(rootcause::Report),
    /// A prompt could not be composed for the agent runtime.
    #[error("failed to compose agent prompt: {0}")]
    PromptComposition(rootcause::Report),
}
