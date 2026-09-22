//! Temporary, exclusive voice attachments to ordinary Macro agent sessions.

use std::sync::Arc;

use agent_runtime_protocol::domain::connection::ServerChannel;
use agent_session::domain::{connection::RuntimeAttachment, model::AgentSessionId};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use super::error::Result;

/// The shared voice lease authorizing a temporary runtime.
#[derive(Clone)]
pub struct VoiceRuntimeBinding {
    /// Unique generation of this voice conversation.
    pub generation: Uuid,
    /// Authenticated user whose audio originates native turns.
    pub speaker: MacroUserIdStr<'static>,
    /// Whether this generation still accepts new input (false while ending).
    pub accepts_input: bool,
}

/// Voice lease facts and incoming worker transports, supplied at composition.
#[async_trait::async_trait]
pub trait VoiceRuntimeConnections: Send + Sync + 'static {
    /// Active shared lease, including a worker that is still connecting.
    async fn binding(&self, session: AgentSessionId) -> Result<Option<VoiceRuntimeBinding>>;
    /// Clear the previous Macro runtime's cached model history on its owning replica.
    async fn suspend_text_runtime(&self, session: AgentSessionId) -> Result<()>;
    /// Stop worker input and finish in-flight tools before closing its actor.
    async fn drain_voice_runtime(&self, session: AgentSessionId, generation: Uuid) -> Result<()>;
    /// Consume this replica's authenticated, one-session worker transport.
    async fn take_attachment(
        &self,
        session: AgentSessionId,
        generation: Uuid,
    ) -> Result<RuntimeAttachment<ServerChannel>>;
}

/// Composition without a voice provider, used by other harness consumers.
pub struct NoVoiceRuntime;

#[async_trait::async_trait]
impl VoiceRuntimeConnections for NoVoiceRuntime {
    async fn binding(&self, _: AgentSessionId) -> Result<Option<VoiceRuntimeBinding>> {
        Ok(None)
    }

    async fn suspend_text_runtime(&self, _: AgentSessionId) -> Result<()> {
        Ok(())
    }

    async fn drain_voice_runtime(&self, _: AgentSessionId, _: Uuid) -> Result<()> {
        Ok(())
    }

    async fn take_attachment(
        &self,
        session: AgentSessionId,
        _: Uuid,
    ) -> Result<RuntimeAttachment<ServerChannel>> {
        Err(super::error::HarnessError::Disconnected(session))
    }
}

/// Erased command admission used by the voice composition adapter.
#[async_trait::async_trait]
pub trait VoiceHarnessCommands: Send + Sync + 'static {
    /// Route a lifecycle/native-input command to the session's managing replica.
    async fn voice_command(
        &self,
        session: AgentSessionId,
        command: super::model::HarnessCommand,
    ) -> Result<()>;
    /// Attach a worker whose socket is held by this replica.
    async fn attach_voice_here(&self, session: AgentSessionId, generation: Uuid) -> Result<()>;
}

/// Shared erased command handle for composition adapters.
pub type SharedVoiceHarness = Arc<dyn VoiceHarnessCommands>;
