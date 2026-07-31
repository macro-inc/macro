//! A [`RuntimeAttachments`] that logs instead of managing a session.
//!
//! Stands in for agent_proxy so a container can be booted and prompted without
//! Postgres, Redis, or the connection gateway. It plays the *server* role of the
//! runtime protocol - the same side `RuntimeConnectionDriver` plays - which is
//! why it has to speak ACP at all: an attachment that merely accepted the
//! channel would leave the agent idling, because nothing would send
//! `initialize`, `session/new`, or a prompt.
//!
//! It is otherwise as dumb as possible: it logs every frame and never persists,
//! renders, or notifies.

use std::future::Future;

use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    ContentBlock, InitializeRequest, NewSessionRequest, NewSessionResponse, PromptRequest,
    RequestId, Response as AcpResponse,
};
use agent_client_protocol::{JsonRpcMessage, JsonRpcResponse, RawJsonRpcMessage};
use agent_runtime_protocol::domain::connection::{
    ServerChannel, ServerConnection, SystemEventHandler,
};
use agent_runtime_protocol::domain::schema::v0::SystemEvent;
use anyhow::Context;
use futures::StreamExt;
use macro_uuid::Uuid;

use crate::domain::ports::RuntimeAttachments;

/// Working directory the agent runs in, matching what the image clones into.
const ACP_WORKSPACE: &str = "/workspace";

/// Fixed request ids, so the response loop recognises its own bootstrap without
/// tracking state per request.
const INITIALIZE_ID: &str = "mock_proxy:initialize";
const NEW_SESSION_ID: &str = "mock_proxy:session/new";
const PROMPT_ID: &str = "mock_proxy:session/prompt";

/// Accepts runtime connections, bootstraps ACP, sends one prompt, and logs
/// everything.
pub struct LoggingAttachments {
    /// The prompt sent once the ACP session exists.
    ///
    /// The real session manager takes this from its queue of messages posted
    /// before the runtime was ready; here it is handed in.
    prompt: String,
}

impl LoggingAttachments {
    /// Log frames and open every session with `prompt`.
    #[must_use]
    pub fn new(prompt: String) -> Self {
        Self { prompt }
    }
}

impl RuntimeAttachments for LoggingAttachments {
    fn attach(&self, session_id: Uuid, channel: ServerChannel) -> anyhow::Result<()> {
        tokio::spawn(drive(session_id, channel, self.prompt.clone()));
        Ok(())
    }
}

/// Logs the system events the harness announces.
struct LogSystemEvents {
    session_id: Uuid,
}

impl SystemEventHandler for LogSystemEvents {
    fn handle(&self, event: SystemEvent) -> impl Future<Output = ()> + Send {
        tracing::info!(session_id = %self.session_id, ?event, "system event");
        std::future::ready(())
    }
}

/// Bootstrap ACP, prompt once, then log until the agent stops talking.
async fn drive(session_id: Uuid, channel: ServerChannel, prompt: String) {
    let (_connection, mut acp) = ServerConnection::connect(channel, LogSystemEvents { session_id });

    for request in [
        acp_request(
            RequestId::Str(INITIALIZE_ID.to_owned()),
            &InitializeRequest::new(ProtocolVersion::V1),
        ),
        acp_request(
            RequestId::Str(NEW_SESSION_ID.to_owned()),
            &NewSessionRequest::new(ACP_WORKSPACE),
        ),
    ] {
        let Ok(request) = request else {
            tracing::error!("could not build an acp bootstrap request");
            return;
        };
        log_frame(session_id, "-->", &request);
        if acp.tx.unbounded_send(Ok(request)).is_err() {
            tracing::error!(%session_id, "runtime closed during acp bootstrap");
            return;
        }
    }

    let mut prompt = Some(prompt);
    while let Some(frame) = acp.rx.next().await {
        let frame = match frame {
            Ok(frame) => frame,
            // One bad frame is not a reason to stop watching.
            Err(error) => {
                tracing::error!(?error, "acp channel error");
                continue;
            }
        };
        log_frame(session_id, "<--", &frame);

        // The turn is over. A real session manager would keep the session open
        // for the next prompt; a one-shot smoke test is done, and closing here
        // is what lets the caller release the sandbox instead of hanging until
        // something kills it.
        if is_prompt_response(&frame) {
            tracing::info!(%session_id, "turn finished");
            return;
        }

        // The prompt needs the id the agent assigned, so it can only go out once
        // `session/new` has answered.
        let Some(acp_session_id) = new_session_id(&frame) else {
            continue;
        };
        let acp_session_id = match acp_session_id {
            Ok(id) => id,
            Err(error) => {
                tracing::error!(?error, "session/new failed");
                return;
            }
        };
        tracing::info!(%session_id, %acp_session_id, "acp session ready");

        let Some(text) = prompt.take() else { continue };
        match acp_request(
            RequestId::Str(PROMPT_ID.to_owned()),
            &PromptRequest::new(acp_session_id, vec![ContentBlock::from(text)]),
        ) {
            Ok(request) => {
                log_frame(session_id, "-->", &request);
                if acp.tx.unbounded_send(Ok(request)).is_err() {
                    return;
                }
            }
            Err(error) => tracing::error!(?error, "could not build the prompt"),
        }
    }
    tracing::info!(%session_id, "agent stopped sending frames");
}

/// Print one frame, one line, so a run stays greppable.
fn log_frame(session_id: Uuid, arrow: &str, frame: &RawJsonRpcMessage) {
    match serde_json::to_string(frame) {
        Ok(json) => println!("{session_id} {arrow} {json}"),
        Err(error) => eprintln!("{session_id} {arrow} <unserializable: {error}>"),
    }
}

/// Whether `frame` is the response to our `session/prompt`.
///
/// Its `stopReason` says why the turn ended; any response at all means the agent
/// is finished with this prompt.
fn is_prompt_response(frame: &RawJsonRpcMessage) -> bool {
    let prompt_id = RequestId::Str(PROMPT_ID.to_owned());
    matches!(
        frame,
        RawJsonRpcMessage::Response(
            AcpResponse::Result { id, .. } | AcpResponse::Error { id, .. }
        ) if *id == prompt_id
    )
}

/// The ACP session id from a `session/new` response, if `frame` is one.
fn new_session_id(frame: &RawJsonRpcMessage) -> Option<anyhow::Result<String>> {
    let bootstrap_id = RequestId::Str(NEW_SESSION_ID.to_owned());
    match frame {
        RawJsonRpcMessage::Response(AcpResponse::Result { id, result }) if *id == bootstrap_id => {
            Some(
                NewSessionResponse::from_value("session/new", result.clone())
                    .map(|parsed| parsed.session_id.0.to_string())
                    .context("unparseable session/new response"),
            )
        }
        RawJsonRpcMessage::Response(AcpResponse::Error { id, error }) if *id == bootstrap_id => {
            Some(Err(anyhow::anyhow!("{error}")))
        }
        _ => None,
    }
}

/// Wrap a typed ACP request body as a raw JSON-RPC request.
fn acp_request(
    id: RequestId,
    request: &(impl JsonRpcMessage + serde::Serialize),
) -> anyhow::Result<RawJsonRpcMessage> {
    let params = serde_json::to_value(request).context("serializing an acp request")?;
    RawJsonRpcMessage::request(request.method().to_string(), params, id)
        .map_err(|error| anyhow::anyhow!("building an acp request: {error}"))
}
