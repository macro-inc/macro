//! Private provider state scoped to a single authorized in-memory session.

use agent::Gemini4Replay;
use agent_client_protocol::schema::v1::RequestId;
use agent_session::domain::model::AgentSessionId;
use model_owner::Owner;
use std::collections::HashMap;

/// The session runtime's private replay store. ACP consumers never read it.
#[async_trait::async_trait]
pub trait Gemini4ReplayStore: Send + Sync + 'static {
    /// Save the replay for a completed turn before replying to its prompt.
    async fn save(
        &self,
        session: AgentSessionId,
        owner: &Owner,
        request: &RequestId,
        replay: &Gemini4Replay,
    ) -> anyhow::Result<()>;

    /// Load metadata for the selected session's known, unambiguous prompt IDs.
    async fn load(
        &self,
        session: AgentSessionId,
        owner: &Owner,
        requests: &[RequestId],
    ) -> anyhow::Result<HashMap<RequestId, Gemini4Replay>>;
}
