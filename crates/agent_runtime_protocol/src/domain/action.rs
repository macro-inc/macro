//! What a caller asks an agent to do, and its translation onto the wire.
//!
//! An action can be accepted and queued before there is any way to express it
//! as ACP, since that needs the [`SessionId`] the handshake produces.

use agent_client_protocol::schema::v1::{CancelNotification, PromptRequest, RequestId, SessionId};
use agent_client_protocol::{JsonRpcMessage, RawJsonRpcMessage};
use serde::{Deserialize, Serialize};

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
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct AgentPromptAction {
    /// What to tell the agent.
    pub prompt: String,
}

/// Ask the agent to run on a different model from here on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct AgentSetModelAction {
    /// The model slug the agent should switch to.
    pub model: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SetModelRequest {
    session_id: SessionId,
    model_id: String,
}

impl AgentSetModelAction {
    /// Read a model change back from the ACP request produced for it.
    ///
    /// ACP's pinned schema does not yet expose this runtime extension as a
    /// typed request, so this keeps its method and parameter shape centralized
    /// with the code that writes the frame.
    pub fn from_runtime(message: &ToRuntimeMessage) -> Option<(SessionId, Self)> {
        let ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(request))) = message else {
            return None;
        };
        if request.method.as_ref() != "session/set_model" {
            return None;
        }
        let params = request.params.clone()?.into_value();
        let params: SetModelRequest = serde_json::from_value(params).ok()?;
        Some((
            params.session_id,
            Self {
                model: params.model_id,
            },
        ))
    }
}

/// One thing a caller wants an agent to do.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AgentAction {
    /// Send the agent a prompt.
    Prompt(AgentPromptAction),
    /// Switch the model the agent runs on.
    SetModel(AgentSetModelAction),
    /// Interrupt whatever the agent is doing.
    Stop,
    // compact, etc.
}

impl AgentAction {
    /// Ask the agent to work on a text prompt.
    pub fn prompt(prompt: impl Into<String>) -> Self {
        Self::Prompt(AgentPromptAction {
            prompt: prompt.into(),
        })
    }

    /// Ask the agent to switch models.
    pub fn set_model(model: impl Into<String>) -> Self {
        Self::SetModel(AgentSetModelAction {
            model: model.into(),
        })
    }

    /// Whether accepting this action voids the actions queued ahead of it.
    ///
    /// A stop means "not the work you are about to start either", so the
    /// machine drops what it has queued rather than sending it and then
    /// cancelling it. Every other action is additive and answers `false`.
    pub fn supersedes_queued(&self) -> bool {
        match self {
            Self::Stop => true,
            Self::Prompt(_) | Self::SetModel(_) => false,
        }
    }

    /// Whether a disconnected session must be reconnected to deliver this.
    ///
    /// A prompt is work the agent has not done yet, so a session with nothing
    /// attached has to be brought back up rather than told "fine". The others
    /// are already satisfied by the disconnection: a stop is asking for a
    /// state a dead session is in, and a model change only applies to a live
    /// runtime.
    pub fn must_reach_agent(&self) -> bool {
        match self {
            Self::Prompt(_) => true,
            Self::Stop | Self::SetModel(_) => false,
        }
    }

    /// Translate into the ACP request that performs this action in `session_id`.
    pub fn to_runtime(
        &self,
        session_id: &SessionId,
        request_id: RequestId,
    ) -> Result<ToRuntimeMessage, ActionError> {
        match self {
            Self::Prompt(action) => {
                let payload =
                    PromptRequest::new(session_id.clone(), vec![action.prompt.clone().into()]);
                let params = serde_json::to_value(&payload)
                    .map_err(|error| ActionError::Acp(error.to_string()))?;
                let frame =
                    RawJsonRpcMessage::request(payload.method().to_owned(), params, request_id)
                        .map_err(|error| ActionError::Acp(error.to_string()))?;
                Ok(ToRuntimeMessage::Acp(AcpMessage(frame)))
            }
            // No typed request for this one: the pinned ACP schema stops at
            // `session/set_mode` and `session/set_config_option`, so the frame
            // is built by hand against the method the runtime accepts. Field
            // names follow `SetSessionModeRequest`, which is the same shape
            // with `modeId` in place of `modelId`.
            Self::SetModel(action) => {
                let params = serde_json::to_value(SetModelRequest {
                    session_id: session_id.clone(),
                    model_id: action.model.clone(),
                })
                .map_err(|error| ActionError::Acp(error.to_string()))?;
                let frame =
                    RawJsonRpcMessage::request("session/set_model".to_owned(), params, request_id)
                        .map_err(|error| ActionError::Acp(error.to_string()))?;
                Ok(ToRuntimeMessage::Acp(AcpMessage(frame)))
            }
            // A notification, so `request_id` is unused: cancelling has no
            // reply. The turn ends through the agent's own stop event, which
            // the fold already reads.
            Self::Stop => {
                let payload = CancelNotification::new(session_id.clone());
                let params = serde_json::to_value(&payload)
                    .map_err(|error| ActionError::Acp(error.to_string()))?;
                let frame = RawJsonRpcMessage::notification(payload.method().to_owned(), params)
                    .map_err(|error| ActionError::Acp(error.to_string()))?;
                Ok(ToRuntimeMessage::Acp(AcpMessage(frame)))
            }
        }
    }
}
