//! What a caller asks an agent to do, and its translation onto the wire.
//!
//! An action can be accepted and queued before there is any way to express it
//! as ACP, since that needs the [`SessionId`] the handshake produces.

use agent_client_protocol::schema::v1::{
    CancelNotification, ClientRequest, PromptRequest, RequestId, SessionId,
    SetSessionConfigOptionRequest,
};
use agent_client_protocol::{JsonRpcMessage, RawJsonRpcMessage};
use serde::{Deserialize, Serialize};

use crate::domain::schema::v0::{AcpMessage, ToRuntimeMessage};

#[cfg(test)]
mod test;

/// ACP session config option used to select the agent's model.
pub const MODEL_CONFIG_ID: &str = "model";

/// Identifies one accepted [`AgentAction`] end to end: returned by the
/// control endpoint, written as the JSON-RPC request id on the action's wire
/// frame, and read back off that frame as `request_id` on the folded message
/// it derives. Correlation is string equality; the value is opaque.
///
/// Minted only by the server at accept time, as `agent_session:{uuid}` - the
/// prefix is what lets [`Self::from_request_id`] tell our ids from ones other
/// clients picked.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub struct AgentActionId(String);

impl AgentActionId {
    /// What every id this side mints starts with.
    const PREFIX: &'static str = "agent_session:";

    /// Mint a fresh id for an action being accepted. v7 so ids sort by mint
    /// time.
    #[must_use]
    pub fn mint() -> Self {
        Self(format!(
            "{}{}",
            Self::PREFIX,
            macro_uuid::generate_uuid_v7()
        ))
    }

    /// The same string as the transport's request id type.
    #[must_use]
    pub fn to_request_id(&self) -> RequestId {
        RequestId::Str(self.0.clone())
    }

    /// Read an id back off a logged frame. `None` for ids this side did not
    /// mint.
    #[must_use]
    pub fn from_request_id(id: &RequestId) -> Option<Self> {
        match id {
            RequestId::Str(id) if id.starts_with(Self::PREFIX) => Some(Self(id.to_string())),
            _ => None,
        }
    }

    /// The id as the string a caller correlates with.
    #[must_use]
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl std::fmt::Display for AgentActionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Slash command agents use to compact the current session context.
pub const COMPACT_COMMAND: &str = "/compact";

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
    /// Raw user text used for a visible session name when `prompt` is enriched.
    #[serde(skip)]
    name_source: Option<String>,
}

impl AgentPromptAction {
    /// Keep the un-enriched user text for visible session naming.
    pub fn set_name_source(&mut self, source: impl Into<String>) {
        self.name_source = Some(source.into());
    }

    /// Text suitable for deriving a visible session name.
    #[must_use]
    pub fn name_source(&self) -> &str {
        self.name_source.as_deref().unwrap_or(&self.prompt)
    }
}

/// Ask the agent to run on a different model from here on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct AgentSetModelAction {
    /// The model slug the agent should switch to.
    pub model: String,
}

impl AgentSetModelAction {
    /// Read a model change back from the ACP request produced for it.
    ///
    /// Models are the standard `model` session config option.
    pub fn from_runtime(message: &ToRuntimeMessage) -> Option<(SessionId, Self)> {
        let ToRuntimeMessage::Acp(AcpMessage(RawJsonRpcMessage::Request(request))) = message else {
            return None;
        };
        let ClientRequest::SetSessionConfigOptionRequest(request) =
            ClientRequest::parse_message(&request.method, &request.params).ok()?
        else {
            return None;
        };
        if request.config_id.to_string() != MODEL_CONFIG_ID {
            return None;
        }
        let model = request.value.as_value_id()?.to_string();
        Some((request.session_id, Self { model }))
    }
}

/// One thing a caller wants an agent to do.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, strum::AsRefStr)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
#[serde(tag = "type", rename_all = "camelCase")]
#[strum(serialize_all = "snake_case")]
pub enum AgentAction {
    /// Send the agent a prompt.
    Prompt(AgentPromptAction),
    /// Switch the model the agent runs on.
    SetModel(AgentSetModelAction),
    /// Compact the agent's current context.
    Compact,
    /// Interrupt whatever the agent is doing.
    Stop,
}

impl AgentAction {
    /// Ask the agent to work on a text prompt.
    pub fn prompt(prompt: impl Into<String>) -> Self {
        Self::Prompt(AgentPromptAction {
            prompt: prompt.into(),
            name_source: None,
        })
    }

    /// Ask the agent to switch models.
    pub fn set_model(model: impl Into<String>) -> Self {
        Self::SetModel(AgentSetModelAction {
            model: model.into(),
        })
    }

    /// Recognize a control action from its translated runtime frame.
    ///
    /// Ordinary prompts are deliberately excluded: callers need their full
    /// content, while this identifies the protocol-only controls that would
    /// otherwise require each consumer to know their wire representation.
    pub fn control_from_runtime(message: &ToRuntimeMessage) -> Option<Self> {
        if let Some((_, action)) = AgentSetModelAction::from_runtime(message) {
            return Some(Self::SetModel(action));
        }

        let ToRuntimeMessage::Acp(AcpMessage(frame)) = message;
        match frame {
            RawJsonRpcMessage::Request(request)
                if PromptRequest::matches_method(&request.method) =>
            {
                let params = request.params.clone()?.into_value();
                let request: PromptRequest = serde_json::from_value(params).ok()?;
                let text = request
                    .prompt
                    .into_iter()
                    .filter_map(|content| match content {
                        agent_client_protocol::schema::v1::ContentBlock::Text(text) => {
                            Some(text.text)
                        }
                        _ => None,
                    })
                    .collect::<String>();
                (text.trim() == COMPACT_COMMAND).then_some(Self::Compact)
            }
            RawJsonRpcMessage::Notification(notification)
                if CancelNotification::matches_method(&notification.method) =>
            {
                Some(Self::Stop)
            }
            _ => None,
        }
    }

    /// Whether accepting this action voids the actions queued ahead of it.
    ///
    /// A stop means "not the work you are about to start either", so the
    /// machine drops what it has queued rather than sending it and then
    /// cancelling it. Every other action is additive and answers `false`.
    pub fn supersedes_queued(&self) -> bool {
        match self {
            Self::Stop => true,
            Self::Prompt(_) | Self::SetModel(_) | Self::Compact => false,
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
            Self::SetModel(action) => {
                let payload = SetSessionConfigOptionRequest::new(
                    session_id.clone(),
                    MODEL_CONFIG_ID,
                    action.model.as_str(),
                );
                let params = serde_json::to_value(&payload)
                    .map_err(|error| ActionError::Acp(error.to_string()))?;
                let frame =
                    RawJsonRpcMessage::request(payload.method().to_owned(), params, request_id)
                        .map_err(|error| ActionError::Acp(error.to_string()))?;
                Ok(ToRuntimeMessage::Acp(AcpMessage(frame)))
            }
            // Manual compaction is exposed as the `/compact` slash command
            // through the standard ACP prompt method.
            Self::Compact => {
                let payload = PromptRequest::new(session_id.clone(), vec![COMPACT_COMMAND.into()]);
                let params = serde_json::to_value(&payload)
                    .map_err(|error| ActionError::Acp(error.to_string()))?;
                let frame =
                    RawJsonRpcMessage::request(payload.method().to_owned(), params, request_id)
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
