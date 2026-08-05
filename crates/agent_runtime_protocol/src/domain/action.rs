//! What a caller asks an agent to do, and its translation onto the wire.
//!
//! An action can be accepted and queued before there is any way to express it
//! as ACP, since that needs the [`AcpId`] the handshake produces.

use agent_client_protocol::schema::v1::{PromptRequest, RequestId, SessionId};
use agent_client_protocol::{JsonRpcMessage, RawJsonRpcMessage};
use serde::{Deserialize, Serialize};

use crate::domain::acp_id::AcpId;
use crate::domain::schema::v0::{AcpMessage, ToRuntimeMessage};

#[cfg(test)]
mod test;

/// A failure while translating an action onto the wire.
#[derive(Debug, thiserror::Error)]
#[non_exhaustive]
pub enum ActionError {
    /// The action's ACP form could not be built.
    #[error("could not build ACP for this action: {0}")]
    Acp(String),
}

/// Ask the agent to work on something.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPromptAction {
    /// What to tell the agent.
    pub prompt: String,
}

/// One thing a caller wants an agent to do.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
#[non_exhaustive]
pub enum AgentAction {
    /// Send the agent a prompt.
    Prompt(AgentPromptAction),
    // compact, etc.
}

impl AgentAction {
    /// Translate into the ACP request that performs this action in `acp`.
    pub fn to_runtime(
        &self,
        acp: &AcpId,
        request_id: RequestId,
    ) -> Result<ToRuntimeMessage, ActionError> {
        match self {
            Self::Prompt(action) => {
                let session: SessionId = acp.clone().into();
                let payload = PromptRequest::new(session, vec![action.prompt.clone().into()]);
                let params = serde_json::to_value(&payload)
                    .map_err(|error| ActionError::Acp(error.to_string()))?;
                let frame =
                    RawJsonRpcMessage::request(payload.method().to_owned(), params, request_id)
                        .map_err(|error| ActionError::Acp(error.to_string()))?;
                Ok(ToRuntimeMessage::Acp(AcpMessage(frame)))
            }
        }
    }
}
