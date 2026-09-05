//! What a caller asks an agent to do, and its translation onto the wire.
//!
//! An action can be accepted and queued before there is any way to express it
//! as ACP, since that needs the [`SessionId`] the handshake produces.

use std::collections::BTreeMap;

use agent_client_protocol::schema::v1::{
    CancelNotification, ClientRequest, CreateElicitationResponse, ElicitationAcceptAction,
    ElicitationAction, ElicitationContentValue as AcpContentValue, PromptRequest, RequestId,
    SessionId, SetSessionConfigOptionRequest,
};
use agent_client_protocol::{JsonRpcMessage, RawJsonRpcMessage};
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};

use crate::domain::schema::v0::{AcpMessage, ToRuntimeMessage};

#[cfg(test)]
mod test;

/// ACP session config option used to select the agent's model.
pub const MODEL_CONFIG_ID: &str = "model";

/// Identifies one accepted [`AgentAction`] end to end: returned by the
/// control endpoint, written as the JSON-RPC request id on the action's wire
/// frame, and read back off that frame as `request_id` on the folded message
/// it derives.
///
/// Minted only by the server at accept time, as a v7 uuid so ids sort by mint
/// time. On the wire and in JSON it is the bare uuid, and a uuid-shaped
/// request id is the whole ownership test: the server is the only writer of
/// runtime-bound frames. The machine's own handshake request ids
/// (`agent_session:{session}:{n}`) are not uuids and stay `None`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(transparent)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
pub struct AgentActionId(Uuid);

impl AgentActionId {
    /// Mint a fresh id for an action being accepted.
    #[must_use]
    pub fn mint() -> Self {
        Self(macro_uuid::generate_uuid_v7())
    }

    /// The same id as the transport's request id type.
    #[must_use]
    pub fn to_request_id(&self) -> RequestId {
        RequestId::Str(self.0.to_string())
    }

    /// Read an id back off a logged frame. `None` for ids this side did not
    /// mint.
    #[must_use]
    pub fn from_request_id(id: &RequestId) -> Option<Self> {
        let RequestId::Str(id) = id else {
            return None;
        };
        id.parse().ok().map(Self)
    }

    /// The raw uuid, for callers that key on it.
    #[must_use]
    pub fn as_uuid(&self) -> Uuid {
        self.0
    }

    /// Rebuild an id a caller was handed earlier, e.g. a queue route's path
    /// parameter.
    #[must_use]
    pub fn from_uuid(id: Uuid) -> Self {
        Self(id)
    }
}

impl std::fmt::Display for AgentActionId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        self.0.fmt(f)
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

/// The JSON-RPC id of an agent's `elicitation/create` request, carried whole
/// so the answer echoes exactly what the agent sent.
///
/// Agents pick these, not us: Claude Code counts from `0`, others use
/// strings. `null` is not a legal id for a request that expects a response,
/// so it is not representable here.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, specta::Type)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
#[serde(untagged)]
pub enum ElicitationRequestId {
    /// A numeric JSON-RPC id. Specta refuses `i64` (it does not fit a JS
    /// number); agents count their requests from zero, so `i32` is the
    /// honest TypeScript face.
    Number(#[specta(type = i32)] i64),
    /// A string JSON-RPC id.
    Str(String),
}

impl ElicitationRequestId {
    /// The id as the agent sent it. `None` for `null`, which cannot be
    /// answered.
    #[must_use]
    pub fn from_request_id(id: &RequestId) -> Option<Self> {
        match id {
            RequestId::Number(number) => Some(Self::Number(*number)),
            RequestId::Str(id) => Some(Self::Str(id.clone())),
            RequestId::Null => None,
        }
    }

    /// The same id as the transport's request id type.
    #[must_use]
    pub fn to_request_id(&self) -> RequestId {
        match self {
            Self::Number(number) => RequestId::Number(*number),
            Self::Str(id) => RequestId::Str(id.clone()),
        }
    }
}

impl std::fmt::Display for ElicitationRequestId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Number(number) => write!(f, "{number}"),
            Self::Str(id) => f.write_str(id),
        }
    }
}

/// A value ACP accepts in an elicitation answer.
///
/// Mirrors ACP's `ElicitationContentValue` so that the contract a caller
/// answers against is the closed union ACP will accept, rather than arbitrary
/// JSON narrowed on the way out. An object, a null, or a mixed array is
/// refused when the request is deserialized - where the caller learns of it -
/// instead of at send time, when the elicitation slot has already been
/// released.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
#[serde(untagged)]
pub enum ElicitationContentValue {
    /// A string, and the shape a whole draft rides in as JSON text.
    Text(String),
    /// A yes/no.
    Boolean(bool),
    /// A whole number.
    Integer(i64),
    /// A number that is not whole.
    Number(f64),
    /// A multi-select's chosen values.
    Strings(Vec<String>),
}

impl From<&ElicitationContentValue> for AcpContentValue {
    fn from(value: &ElicitationContentValue) -> Self {
        match value {
            ElicitationContentValue::Text(text) => Self::String(text.clone()),
            ElicitationContentValue::Boolean(flag) => Self::Boolean(*flag),
            ElicitationContentValue::Integer(number) => Self::Integer(*number),
            ElicitationContentValue::Number(number) => Self::Number(*number),
            ElicitationContentValue::Strings(values) => Self::StringArray(values.clone()),
        }
    }
}

/// What the user decided about an elicitation. Mirrors ACP's three actions;
/// there is no `Other` because we never originate an action we do not know.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ElicitationAnswer {
    /// The user submitted the form, or consented to open the URL.
    Accept {
        /// Form: the submitted values keyed by property. URL: omitted.
        #[serde(default, skip_serializing_if = "Option::is_none")]
        content: Option<BTreeMap<String, ElicitationContentValue>>,
    },
    /// The user explicitly said no.
    Decline,
    /// The user dismissed the request without choosing.
    Cancel,
}

/// Answer an elicitation the agent is waiting on.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "utoipa", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct AgentRespondElicitationAction {
    /// The agent's `elicitation/create` request id - not an
    /// [`AgentActionId`], because the agent minted it.
    pub request_id: ElicitationRequestId,
    /// The decision.
    #[serde(flatten)]
    pub answer: ElicitationAnswer,
}

/// One thing a caller wants an agent to do.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, strum::AsRefStr)]
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
    /// Answer an `elicitation/create` the agent sent.
    ///
    /// The one action whose wire form is a JSON-RPC *response* rather than a
    /// request or notification: the agent asked, we answer on its id. The
    /// minted [`AgentActionId`] therefore never reaches the wire for this
    /// action; the fold correlates on the agent's id instead.
    RespondElicitation(AgentRespondElicitationAction),
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

    /// Answer the elicitation the agent asked with `request_id`.
    pub fn respond_elicitation(
        request_id: ElicitationRequestId,
        answer: ElicitationAnswer,
    ) -> Self {
        Self::RespondElicitation(AgentRespondElicitationAction { request_id, answer })
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

    /// Whether this action occupies a whole agent turn once sent.
    ///
    /// Both prompts and compaction travel as `session/prompt`, and ACP runs
    /// one prompt at a time - so these are the actions the harness holds in
    /// its queue while a turn is running, and the ones whose response ends a
    /// turn. A stop and a model change ride alongside a running turn freely.
    pub fn occupies_turn(&self) -> bool {
        match self {
            Self::Prompt(_) | Self::Compact => true,
            // An elicitation answer is the running turn's own business: the
            // agent is blocked on it mid-turn, so it must ride alongside.
            Self::SetModel(_) | Self::Stop | Self::RespondElicitation(_) => false,
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
            // A response to the agent's own request: `request_id` is the
            // minted action id and is deliberately unused - the frame must
            // carry the id the agent asked with, or nothing answers it.
            Self::RespondElicitation(action) => {
                let response = action.to_acp_response();
                let result = serde_json::to_value(&response)
                    .map_err(|error| ActionError::Acp(error.to_string()))?;
                let frame =
                    RawJsonRpcMessage::response(action.request_id.to_request_id(), Ok(result));
                Ok(ToRuntimeMessage::Acp(AcpMessage(frame)))
            }
        }
    }
}

impl AgentRespondElicitationAction {
    /// The ACP response body for this answer.
    ///
    /// Total: every value the type can hold is one ACP accepts, so answering
    /// cannot fail here. That matters because the session machine releases the
    /// elicitation slot before this runs - a failure would leave the agent
    /// blocked on a request nothing can answer any more.
    #[must_use]
    pub fn to_acp_response(&self) -> CreateElicitationResponse {
        let action = match &self.answer {
            ElicitationAnswer::Accept { content } => {
                let content = content.as_ref().map(|content| {
                    content
                        .iter()
                        .map(|(key, value)| (key.clone(), AcpContentValue::from(value)))
                        .collect::<BTreeMap<_, _>>()
                });
                ElicitationAction::Accept(ElicitationAcceptAction::new().content(content))
            }
            ElicitationAnswer::Decline => ElicitationAction::Decline,
            ElicitationAnswer::Cancel => ElicitationAction::Cancel,
        };
        CreateElicitationResponse::new(action)
    }
}
