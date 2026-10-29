//! Reuse session HTTP routes with internal credentials and a mandatory acting user.
use super::coding_agents_client::CodingAgentsClient;
use crate::domain::tool_actions::{
    SessionAction, SessionActionError, SessionActionResult, SessionActions, SessionControlStatus,
};
use macro_authorization::{INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER};
use macro_user_id::user_id::MacroUserIdStr;
use reqwest::{Method, StatusCode};
use serde::Deserialize;
use serde_json::json;
use std::{pin::Pin, time::Duration};
use tracing::Instrument;
use uuid::Uuid;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ControlReceipt {
    action_id: Uuid,
    status: SessionControlStatus,
}

impl SessionActions for CodingAgentsClient {
    fn execute(
        &self,
        user: MacroUserIdStr<'static>,
        session_id: Uuid,
        action: SessionAction,
    ) -> Pin<Box<dyn Future<Output = Result<SessionActionResult, SessionActionError>> + Send + '_>>
    {
        Box::pin(
            async move {
                let root = format!("agent-sessions/{session_id}");
                let internal = format!("internal/agent-sessions/{session_id}");
                let (method, path, body, message, control) = match action {
                    SessionAction::Rename { name } => (
                        Method::PUT,
                        format!("{root}/name"),
                        json!({"name":name}),
                        "Session renamed.",
                        false,
                    ),
                    SessionAction::Archive { archived } => (
                        Method::PUT,
                        format!("{root}/archived"),
                        json!({"isArchived":archived}),
                        if archived {
                            "Session archived."
                        } else {
                            "Session unarchived."
                        },
                        false,
                    ),
                    SessionAction::Delete => (
                        Method::DELETE,
                        internal,
                        json!(null),
                        "Session deleted.",
                        false,
                    ),
                    SessionAction::Prompt { prompt } => (
                        Method::POST,
                        format!("{internal}/control"),
                        json!({"type":"prompt", "prompt":prompt}),
                        "Prompt accepted.",
                        true,
                    ),
                    SessionAction::Stop => (
                        Method::POST,
                        format!("{internal}/control"),
                        json!({"type":"stop"}),
                        "Stop accepted.",
                        true,
                    ),
                };
                let url = self
                    .base_url
                    .join(&path)
                    .map_err(|_| SessionActionError::Unconfirmed)?;
                let mut headers = reqwest::header::HeaderMap::new();
                macro_tower_layers::inject_trace_headers(&mut headers);
                let mut response = self
                    .client
                    .request(method, url)
                    .headers(headers)
                    .header(INTERNAL_API_KEY_HEADER, self.internal_key.clone())
                    .header(INTERNAL_MACRO_USER_ID_HEADER, user.as_ref())
                    .timeout(Duration::from_secs(30))
                    .json(&body)
                    .send()
                    .await
                    .map_err(|_| SessionActionError::Unconfirmed)?;
                match response.status() {
                    StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN | StatusCode::NOT_FOUND => {
                        return Err(SessionActionError::Forbidden);
                    }
                    StatusCode::BAD_REQUEST
                    | StatusCode::UNPROCESSABLE_ENTITY
                    | StatusCode::CONFLICT => return Err(SessionActionError::Rejected),
                    status if !status.is_success() => return Err(SessionActionError::Unconfirmed),
                    _ => {}
                }
                let receipt = if control {
                    let mut bytes = Vec::new();
                    while let Some(chunk) = response
                        .chunk()
                        .await
                        .map_err(|_| SessionActionError::Unconfirmed)?
                    {
                        if bytes.len() + chunk.len() > 16_384 {
                            return Err(SessionActionError::Unconfirmed);
                        }
                        bytes.extend_from_slice(&chunk);
                    }
                    Some(
                        serde_json::from_slice::<ControlReceipt>(&bytes)
                            .map_err(|_| SessionActionError::Unconfirmed)?,
                    )
                } else {
                    None
                };
                Ok(SessionActionResult {
                    session_id,
                    message: message.into(),
                    action_id: receipt.as_ref().map(|r| r.action_id),
                    status: receipt.map(|r| r.status),
                })
            }
            .instrument(tracing::info_span!("agent_session.tool_action", session_id = %session_id)),
        )
    }
}
