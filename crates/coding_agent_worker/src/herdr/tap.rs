//! Reads the per-session story out of the ACP lines crossing the harness's
//! stdio. The harness serves every session over one process, so the tap
//! follows request ids to learn which session a response closes.

use std::collections::HashMap;

use agent_client_protocol::LineDirection;
use agent_session::domain::model::{AgentSessionId, MACRO_AGENT_SESSION_META_KEY};
use serde_json::Value;

use super::wire::PermissionChoice;

#[cfg(test)]
mod test;

/// Something that happened to one ACP session.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum TapEvent {
    /// The agent is serving a session: `session/new` answered, or a
    /// `session/load`/`session/resume` named it.
    Opened {
        /// The ACP session id.
        session: String,
        /// The Macro session, when the service named it in `_meta`.
        macro_session: Option<AgentSessionId>,
    },
    /// A prompt went to the agent.
    Prompted {
        /// The ACP session id.
        session: String,
        /// The prompt's text blocks, joined.
        text: String,
    },
    /// The agent streamed a `session/update`.
    Update {
        /// The ACP session id.
        session: String,
        /// The notification's `update` object.
        update: Value,
    },
    /// The agent answered a prompt.
    TurnEnded {
        /// The ACP session id.
        session: String,
        /// The stop reason, or `error` for a failed prompt.
        stop_reason: String,
    },
    /// The agent asked permission for a tool call.
    PermissionAsked {
        /// The ACP session id.
        session: String,
        /// The agent's JSON-RPC request id, which the answer must echo.
        request_id: Value,
        /// The tool call's title, when it has one.
        title: Option<String>,
        /// The choices the agent offered.
        options: Vec<PermissionChoice>,
    },
    /// The client answered the agent's permission request.
    PermissionAnswered {
        /// The ACP session id.
        session: String,
    },
}

/// Correlation state across lines.
#[derive(Debug, Default)]
pub(crate) struct WireTap {
    /// `session/new` requests awaiting their answer, by request id.
    opening: HashMap<String, Option<AgentSessionId>>,
    /// `session/prompt` requests awaiting their answer, by request id.
    prompts: HashMap<String, String>,
    /// Permission requests from the agent awaiting an answer, by request id.
    permissions: HashMap<String, String>,
}

impl WireTap {
    /// Observe one line. Lines that are not JSON-RPC (stderr, garbage) and
    /// traffic this tap does not follow produce nothing.
    pub(crate) fn observe(&mut self, line: &str, direction: LineDirection) -> Vec<TapEvent> {
        let to_agent = match direction {
            LineDirection::Stdin => true,
            LineDirection::Stdout => false,
            LineDirection::Stderr => return Vec::new(),
        };
        let Ok(message) = serde_json::from_str::<Value>(line) else {
            return Vec::new();
        };
        let id = message.get("id").filter(|id| !id.is_null()).map(Value::to_string);
        let method = message.get("method").and_then(Value::as_str);
        let params = message.get("params");

        let raw_id = message.get("id").filter(|id| !id.is_null());

        match (method, id) {
            (Some(method), id) if to_agent => self.from_client(method, id, params),
            (Some(method), id) => self.from_agent(method, id, raw_id, params),
            (None, Some(id)) if to_agent => self
                .permissions
                .remove(&id)
                .map(|session| vec![TapEvent::PermissionAnswered { session }])
                .unwrap_or_default(),
            (None, Some(id)) => self.agent_answered(&id, &message),
            (None, None) => Vec::new(),
        }
    }

    fn from_client(
        &mut self,
        method: &str,
        id: Option<String>,
        params: Option<&Value>,
    ) -> Vec<TapEvent> {
        match method {
            "session/new" => {
                if let Some(id) = id {
                    self.opening.insert(id, macro_session(params));
                }
                Vec::new()
            }
            "session/load" | "session/resume" => session_id(params)
                .map(|session| {
                    vec![TapEvent::Opened {
                        session,
                        macro_session: macro_session(params),
                    }]
                })
                .unwrap_or_default(),
            "session/prompt" => {
                let Some(session) = session_id(params) else {
                    return Vec::new();
                };
                if let Some(id) = id {
                    self.prompts.insert(id, session.clone());
                }
                let text = params
                    .and_then(|params| params.get("prompt"))
                    .map(prompt_text)
                    .unwrap_or_default();
                vec![TapEvent::Prompted { session, text }]
            }
            _ => Vec::new(),
        }
    }

    fn from_agent(
        &mut self,
        method: &str,
        id: Option<String>,
        raw_id: Option<&Value>,
        params: Option<&Value>,
    ) -> Vec<TapEvent> {
        let Some(session) = session_id(params) else {
            return Vec::new();
        };
        match method {
            "session/update" => params
                .and_then(|params| params.get("update"))
                .map(|update| {
                    vec![TapEvent::Update {
                        session,
                        update: update.clone(),
                    }]
                })
                .unwrap_or_default(),
            "session/request_permission" => {
                let Some(id) = id else {
                    return Vec::new();
                };
                let Some(request_id) = raw_id.cloned() else {
                    return Vec::new();
                };
                self.permissions.insert(id, session.clone());
                let title = params
                    .and_then(|params| params.pointer("/toolCall/title"))
                    .and_then(Value::as_str)
                    .map(str::to_owned);
                let options = params
                    .and_then(|params| params.get("options"))
                    .and_then(|options| {
                        serde_json::from_value::<Vec<PermissionChoice>>(options.clone()).ok()
                    })
                    .unwrap_or_default();
                vec![TapEvent::PermissionAsked {
                    session,
                    request_id,
                    title,
                    options,
                }]
            }
            _ => Vec::new(),
        }
    }

    fn agent_answered(&mut self, id: &str, message: &Value) -> Vec<TapEvent> {
        if let Some(macro_session) = self.opening.remove(id) {
            return message
                .pointer("/result/sessionId")
                .and_then(Value::as_str)
                .map(|session| {
                    vec![TapEvent::Opened {
                        session: session.to_owned(),
                        macro_session,
                    }]
                })
                .unwrap_or_default();
        }
        if let Some(session) = self.prompts.remove(id) {
            let stop_reason = message
                .pointer("/result/stopReason")
                .and_then(Value::as_str)
                .unwrap_or("error")
                .to_owned();
            return vec![TapEvent::TurnEnded {
                session,
                stop_reason,
            }];
        }
        Vec::new()
    }
}

fn session_id(params: Option<&Value>) -> Option<String> {
    params?
        .get("sessionId")?
        .as_str()
        .map(str::to_owned)
}

fn macro_session(params: Option<&Value>) -> Option<AgentSessionId> {
    let raw = params?
        .get("_meta")?
        .get(MACRO_AGENT_SESSION_META_KEY)?
        .as_str()?;
    uuid::Uuid::parse_str(raw)
        .ok()
        .map(AgentSessionId::new_from_uuid)
}

fn prompt_text(prompt: &Value) -> String {
    prompt
        .as_array()
        .into_iter()
        .flatten()
        .filter(|block| block.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|block| block.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n")
}
