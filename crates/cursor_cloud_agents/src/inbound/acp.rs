//! The ACP adapter.
//!
//! ACP in on a reader, ACP out on a writer, nothing else on either —
//! diagnostics go to tracing (stderr and/or a log file), never the writer,
//! because the writer is the protocol and a stray line corrupts the stream
//! for the client. Over stdio that means never stdout; over an in-process
//! pipe it means never the pipe.
//!
//! The transport is a parameter, not a fact: [`serve`] takes any
//! [`AsyncRead`](tokio::io::AsyncRead) and [`AcpWriter::new`] any
//! [`AsyncWrite`](tokio::io::AsyncWrite), so the same adapter serves a
//! subprocess on stdio ([`AcpWriter::stdio`]) and an in-process client over a
//! `tokio::io::duplex` pipe. Framing is newline-delimited JSON either way.
//!
//! The adapter is thin by design: it parses frames, converts them to domain
//! calls, and converts results back to frames. Prompts are dispatched onto
//! their own tasks so a long-running turn never blocks the read loop — that
//! is what lets `session/cancel` land while a turn is streaming.

#[cfg(test)]
mod test;

use crate::domain::model::{AcpSessionId, McpHeader, McpServer, McpTransport};
use crate::domain::ports::{CursorAgents, RepoResolver, RunStream, SessionNotifier};
use crate::domain::service::CursorSessionService;
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    AgentCapabilities, AuthenticateRequest, AuthenticateResponse, CancelNotification,
    CloseSessionRequest, CloseSessionResponse, ContentBlock, Error as AcpError, HttpHeader,
    Implementation, InitializeRequest, InitializeResponse, LoadSessionRequest, LoadSessionResponse,
    McpCapabilities, McpServer as AcpMcpServer, NewSessionRequest, NewSessionResponse,
    Notification, PromptCapabilities, PromptRequest, PromptResponse, RequestId, Response,
    SessionId, SessionNotification, SessionUpdate,
};
use agent_client_protocol::{JsonRpcMessage as _, RawJsonRpcMessage, RawJsonRpcParams};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt as _, AsyncRead, AsyncWrite, AsyncWriteExt as _, BufReader};
use tokio::sync::mpsc;

/// A cloneable handle that queues frames for the output writer task.
///
/// The handle carries no transport type: it is the queue's sending half, and
/// the sink lives in the future [`AcpWriter::new`] returns. That keeps the
/// notifier, the service and [`serve`] free of a writer type parameter they
/// would only ever pass through.
#[derive(Debug, Clone)]
pub struct AcpWriter {
    frames: mpsc::UnboundedSender<RawJsonRpcMessage>,
}

impl AcpWriter {
    /// The writer handle and the future that owns `sink`.
    ///
    /// Exactly one task writes to the sink, so frames from concurrent turns
    /// interleave at frame granularity, never mid-line.
    pub fn new<Writer>(mut sink: Writer) -> (Self, impl Future<Output = ()>)
    where
        Writer: AsyncWrite + Unpin + Send,
    {
        let (frames, mut queue) = mpsc::unbounded_channel::<RawJsonRpcMessage>();
        let run = async move {
            while let Some(frame) = queue.recv().await {
                let mut line = match serde_json::to_string(&frame) {
                    Ok(line) => line,
                    Err(error) => {
                        tracing::error!(error = ?error, "cannot serialize outgoing frame");
                        continue;
                    }
                };
                tracing::debug!(frame = %line, "acp out");
                line.push('\n');
                if let Err(error) = sink.write_all(line.as_bytes()).await {
                    tracing::error!(error = ?error, "acp output closed; stopping writer");
                    return;
                }
                let _ = sink.flush().await;
            }
        };
        (Self { frames }, run)
    }

    /// The writer pair for a subprocess agent: frames go to stdout.
    ///
    /// Stdout is the protocol for a stdio-spawned agent, so nothing else may
    /// ever write there — see the module docs.
    pub fn stdio() -> (Self, impl Future<Output = ()>) {
        Self::new(tokio::io::stdout())
    }

    /// A writer whose frames land in a channel instead of a byte sink, for
    /// tests that assert on what the dispatch layer answers.
    #[cfg(any(test, feature = "test-utils"))]
    #[must_use]
    pub fn channel() -> (Self, mpsc::UnboundedReceiver<RawJsonRpcMessage>) {
        let (frames, queue) = mpsc::unbounded_channel();
        (Self { frames }, queue)
    }

    fn send(&self, frame: RawJsonRpcMessage) {
        // A closed queue means the writer (and so the client) is gone;
        // there is nowhere left to report to.
        let _ = self.frames.send(frame);
    }

    fn respond<T: serde::Serialize>(&self, id: RequestId, result: &T) {
        match serde_json::to_value(result) {
            Ok(value) => self.send(RawJsonRpcMessage::Response(Response::Result {
                id,
                result: value,
            })),
            Err(error) => {
                tracing::error!(error = ?error, "cannot serialize response");
                self.respond_error(id, AcpError::internal_error());
            }
        }
    }

    fn respond_error(&self, id: RequestId, error: AcpError) {
        self.send(RawJsonRpcMessage::Response(Response::Error { id, error }));
    }
}

/// Delivers session updates as `session/update` notifications on the ACP
/// output.
#[derive(Debug, Clone)]
pub struct AcpNotifier(AcpWriter);

impl AcpNotifier {
    /// A notifier writing through the given output handle.
    #[must_use]
    pub fn new(writer: AcpWriter) -> Self {
        Self(writer)
    }
}

impl SessionNotifier for AcpNotifier {
    async fn notify(
        &self,
        session: &AcpSessionId,
        update: SessionUpdate,
    ) -> Result<(), rootcause::Report> {
        let notification = SessionNotification::new(SessionId::new(session.as_str()), update);
        // Method name and payload both come from the schema's own
        // `JsonRpcMessage` impl, so they cannot drift apart.
        let untyped = notification
            .to_untyped_message()
            .map_err(|error| rootcause::report!("{error}"))?;
        let params = RawJsonRpcParams::from_value(untyped.params)
            .map_err(|error| rootcause::report!("{error}"))?;
        self.0.send(RawJsonRpcMessage::Notification(Notification {
            method: untyped.method.into(),
            params,
        }));
        Ok(())
    }
}

/// The MCP servers this agent can honour, with the rest declined out loud.
///
/// `POST /v1/agents` accepts `mcpServers[]`, so a remote server the client
/// configures really is reachable from Cursor's sandbox and is forwarded
/// unchanged.
///
/// stdio is not, and the reason is locality rather than capability. ACP
/// defines its `command` as an absolute path on the **client's** machine, and
/// its `env` as literal values — routinely API tokens. Forwarding that would
/// ask Cursor to spawn a different executable, on different hardware, with
/// the user's secrets, and the result would look configured while being
/// wired to nothing. ACP does say every agent must support stdio; an agent
/// whose work happens in someone else's sandbox cannot, and saying so is
/// better than pretending.
///
/// An entry whose shape the schema cannot read at all never reaches here: ACP
/// declares `mcpServers` item-skipping, so the schema drops it and the request
/// still succeeds. That is the property this used to buy with a hand-written
/// enum.
fn forwardable_mcp_servers(requested: Vec<AcpMcpServer>) -> Vec<McpServer> {
    let mut forwarded = Vec::new();
    let mut declined = Vec::new();
    for server in requested {
        let remote = match server {
            AcpMcpServer::Http(http) => McpServer {
                name: http.name,
                transport: McpTransport::Http,
                url: http.url,
                headers: forwardable_headers(http.headers),
            },
            AcpMcpServer::Sse(sse) => McpServer {
                name: sse.name,
                transport: McpTransport::Sse,
                url: sse.url,
                headers: forwardable_headers(sse.headers),
            },
            AcpMcpServer::Stdio(stdio) => {
                declined.push(stdio.name);
                continue;
            }
            // The schema's `McpServer` is non-exhaustive: a transport added to
            // ACP after this was written is unforwardable until it is handled
            // here, and saying so beats pretending it was configured.
            other => {
                tracing::warn!(server = ?other, "declining an MCP transport this agent cannot forward");
                continue;
            }
        };
        forwarded.push(remote);
    }
    if !declined.is_empty() {
        tracing::warn!(
            servers = ?declined,
            "declining stdio MCP servers: they name an executable on this machine, but the \
             agent runs in Cursor's sandbox - configure these as http or sse servers to \
             forward them"
        );
    }
    forwarded
}

/// ACP's `{name, value}` header pairs as this crate's domain models them.
fn forwardable_headers(headers: Vec<HttpHeader>) -> Vec<McpHeader> {
    headers
        .into_iter()
        .map(|header| McpHeader {
            name: header.name,
            value: header.value,
        })
        .collect()
}

/// What this agent actually supports.
///
/// Only claims what the code does. [`prompt_text`] turns a `ResourceLink`
/// into an `@`-mention, so embedded context is real and advertising it false
/// suppressed context the agent handles fine. HTTP and SSE MCP servers are
/// forwarded to Cursor at agent creation, so those are real too — while stdio
/// is declined, which is why no capability claims it (see
/// [`forwardable_mcp_servers`]). Cursor's prompt body is text-only as this
/// crate models it, so image and audio stay false. `loadSession` stays false
/// until an agent's history can actually be replayed.
///
/// Nothing here can express the divergence that matters most: this agent
/// never sends `session/request_permission`, because Cursor approves tool use
/// server-side and exposes no hook to intercept it. An ACP client's
/// permission gate therefore does not apply to anything this agent does. ACP
/// has no capability field for "I will never ask", so it is said on stderr at
/// startup instead — see the binary's docs.
fn agent_capabilities() -> AgentCapabilities {
    AgentCapabilities::default()
        .prompt_capabilities(PromptCapabilities::new().embedded_context(true))
        .mcp_capabilities(McpCapabilities::new().http(true).sse(true))
        // Without this a client resuming a session it persisted never sends
        // `session/load` — it gives up on the session instead, which for the
        // Macro harness means a session that stops answering after a restart.
        .load_session(true)
}

/// Serve ACP over `reader`/`writer` until the reader closes.
///
/// One newline-delimited JSON frame per line, whatever the transport: stdio
/// for a spawned agent, a `tokio::io::duplex` pipe for an in-process client.
///
/// The service must already be wired to an [`AcpNotifier`] sharing `writer`,
/// so a turn's updates and its final response leave through the same queue —
/// that is why the writer is passed separately instead of being reachable
/// through the service. Two queues would let a `session/prompt` response
/// overtake the `session/update` notifications of its own turn.
pub async fn serve<Reader, Cursor, Notifier, Repos>(
    service: Arc<CursorSessionService<Cursor, Notifier, Repos>>,
    reader: Reader,
    writer: AcpWriter,
) where
    Reader: AsyncRead + Unpin + Send,
    Cursor: CursorAgents + RunStream + Send + Sync + 'static,
    Notifier: SessionNotifier + Send + Sync + 'static,
    Repos: RepoResolver + Send + Sync + 'static,
{
    let mut lines = BufReader::new(reader).lines();
    loop {
        let line = match lines.next_line().await {
            Ok(Some(line)) => line,
            Ok(None) => return, // client hung up
            Err(error) => {
                tracing::error!(error = ?error, "acp input read failed");
                return;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        tracing::debug!(frame = %line, "acp in");
        match serde_json::from_str::<RawJsonRpcMessage>(&line) {
            Ok(frame) => dispatch(&service, &writer, frame),
            Err(error) => {
                tracing::warn!(error = ?error, line, "malformed acp frame");
            }
        }
    }
}

/// Route one frame. Requests answer through the writer; prompt requests run
/// on their own task so the read loop keeps servicing cancels.
///
/// Every method name and every param shape comes from the schema's
/// [`JsonRpcMessage`](agent_client_protocol::JsonRpcMessage) impls —
/// `matches_method` says whether a frame is ours, `parse_message` decodes it —
/// so there is no method string in this crate to fall out of step with ACP.
/// Matching before parsing is what keeps a method this agent does not
/// implement answering `method_not_found` rather than complaining about the
/// params of a request it was never going to serve.
fn dispatch<Cursor, Notifier, Repos>(
    service: &Arc<CursorSessionService<Cursor, Notifier, Repos>>,
    writer: &AcpWriter,
    frame: RawJsonRpcMessage,
) where
    Cursor: CursorAgents + RunStream + Send + Sync + 'static,
    Notifier: SessionNotifier + Send + Sync + 'static,
    Repos: RepoResolver + Send + Sync + 'static,
{
    match frame {
        RawJsonRpcMessage::Request(request) => {
            let id = request.id.clone();
            let method = &*request.method;
            let params = params_json(request.params.as_ref());
            if let Some(initialize) = as_request::<InitializeRequest>(method, &params) {
                // Answer with the newest version both sides speak. The reply
                // was hardcoded to V1 regardless of the request, so a client
                // offering only v0 was told v1 and the two then disagreed
                // about the wire format with nothing to catch it.
                //
                // A handshake is the one request that must not be refused over
                // its params: a body this agent cannot read, or one naming no
                // version at all, is answered as the latest, since that is
                // what a client omitting the field can only have meant.
                let requested = initialize.map_or(ProtocolVersion::V1, |initialize| {
                    initialize.protocol_version
                });
                let response = InitializeResponse::new(requested.min(ProtocolVersion::V1))
                    .agent_capabilities(agent_capabilities())
                    .agent_info(Implementation::new("cursor-acp", env!("CARGO_PKG_VERSION")));
                writer.respond(id, &response);
            } else if as_request::<AuthenticateRequest>(method, &params).is_some() {
                // The API key comes from the environment; nothing to negotiate
                // with the client, so not even the method it named is read.
                writer.respond(id, &AuthenticateResponse::new());
            } else if let Some(new_session) =
                as_request::<NewSessionRequest>(method, &with_mcp_servers(&params))
            {
                match new_session {
                    Ok(new_session) => {
                        let mcp_servers = forwardable_mcp_servers(new_session.mcp_servers);
                        let session = service.new_session(&new_session.cwd, mcp_servers);
                        writer.respond(
                            id,
                            &NewSessionResponse::new(SessionId::new(session.as_str())),
                        );
                    }
                    Err(error) => writer.respond_error(id, error),
                }
            } else if let Some(prompt_request) = as_request::<PromptRequest>(method, &params) {
                match prompt_request {
                    Ok(prompt) => {
                        let service = Arc::clone(service);
                        let writer = writer.clone();
                        tokio::spawn(async move {
                            let session = AcpSessionId::new(prompt.session_id.0.as_ref());
                            let text = prompt_text(&prompt.prompt);
                            match service.prompt(&session, &text).await {
                                Ok(stop_reason) => {
                                    writer.respond(id, &PromptResponse::new(stop_reason));
                                }
                                Err(error) => {
                                    tracing::error!(error = %error, "prompt failed");
                                    writer.respond_error(
                                        id,
                                        AcpError::new(-32603, error.to_string()),
                                    );
                                }
                            }
                        });
                    }
                    Err(error) => writer.respond_error(id, error),
                }
            } else if let Some(load_session) = as_request::<LoadSessionRequest>(method, &params) {
                // Loading is a lookup, not a fetch: a host that restarts
                // restores its persisted (session -> agent) pairs with
                // `restore_session` before serving, so by the time a
                // `session/load` arrives the session either exists or never
                // will. No history is replayed — the hosts this agent serves
                // keep their own durable log of every frame, and Cursor
                // accumulates the conversation server-side, so a replay would
                // tell the client what it already knows.
                match load_session {
                    Ok(load) => {
                        let session = AcpSessionId::new(load.session_id.0.as_ref());
                        if service.has_session(&session) {
                            writer.respond(id, &LoadSessionResponse::new());
                        } else {
                            writer.respond_error(id, AcpError::invalid_params());
                        }
                    }
                    Err(error) => writer.respond_error(id, error),
                }
            } else if let Some(close_session) = as_request::<CloseSessionRequest>(method, &params) {
                // Dropping a session the client is done with. Without this,
                // `CursorSessionService::close` was dead code and the session
                // map grew for the whole process lifetime.
                let closed = close_session.is_ok_and(|close| {
                    service.close(&AcpSessionId::new(close.session_id.0.as_ref()))
                });
                if closed {
                    writer.respond(id, &CloseSessionResponse::new());
                } else {
                    // A session this agent never had is the client's mistake,
                    // not a no-op worth acknowledging.
                    writer.respond_error(id, AcpError::invalid_params());
                }
            } else {
                tracing::debug!(method, "unsupported method");
                writer.respond_error(id, AcpError::method_not_found());
            }
        }
        RawJsonRpcMessage::Notification(notification) => {
            let method = &*notification.method;
            if CancelNotification::matches_method(method) {
                let params = params_json(notification.params.as_ref());
                if let Ok(cancel) = CancelNotification::parse_message(method, &params) {
                    let service = Arc::clone(service);
                    tokio::spawn(async move {
                        let session = AcpSessionId::new(cancel.session_id.0.as_ref());
                        if let Err(error) = service.cancel(&session).await {
                            tracing::error!(error = %error, "cancel failed");
                        }
                    });
                }
            } else {
                tracing::debug!(method, "ignoring notification");
            }
        }
        // Responses would answer requests this agent sent; it sends none.
        RawJsonRpcMessage::Response(_) => {}
    }
}

/// Concatenate a prompt's content blocks into the single string Cursor takes.
fn prompt_text(blocks: &[ContentBlock]) -> String {
    blocks
        .iter()
        .filter_map(|block| match block {
            ContentBlock::Text(text) => Some(text.text.clone()),
            ContentBlock::ResourceLink(link) => Some(format!("@{}", link.uri)),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// `session/new` params with an absent `mcpServers` read as none requested.
///
/// The schema makes the member mandatory, as ACP's own JSON schema does, but a
/// client that configures no MCP servers plainly means none, and failing the
/// only request that opens a session over an omitted empty list would refuse
/// work this agent can do. Every other field keeps the schema's strictness.
fn with_mcp_servers(params: &serde_json::Value) -> serde_json::Value {
    let mut params = params.clone();
    if let serde_json::Value::Object(fields) = &mut params {
        fields
            .entry("mcpServers")
            .or_insert_with(|| serde_json::Value::Array(Vec::new()));
    }
    params
}

/// A frame's params as the JSON the schema's `parse_message` deserializes from.
///
/// Absent params read as an empty object rather than `null`, so a method whose
/// every field is optional still parses when the client omits the member
/// entirely. Positional params stay an array, which no ACP method accepts, so
/// they fail as invalid params instead of being mistaken for a valid body.
/// The frame read as `Request`, if `Request` is the type for this method.
///
/// Match first, parse second, and keep the two answers distinct: `None` means
/// some other method — keep looking, and answer `method_not_found` if nothing
/// claims it — while `Some(Err(_))` means this *is* the method and the body did
/// not fit, which is `invalid_params`. Parsing straight into the schema's
/// one-shot `ClientRequest` enum would collapse that distinction and answer
/// `invalid_params` for methods this agent simply does not implement.
///
/// The method name lives in the schema's own registration for `Request`, so it
/// appears nowhere in this crate.
fn as_request<Request>(
    method: &str,
    params: &serde_json::Value,
) -> Option<Result<Request, AcpError>>
where
    Request: agent_client_protocol::JsonRpcRequest,
{
    Request::matches_method(method).then(|| Request::parse_message(method, params))
}

fn params_json(params: Option<&RawJsonRpcParams>) -> serde_json::Value {
    match params {
        Some(RawJsonRpcParams::Object(fields)) => serde_json::Value::Object(fields.clone()),
        Some(RawJsonRpcParams::Array(values)) => serde_json::Value::Array(values.clone()),
        None => serde_json::Value::Object(serde_json::Map::new()),
    }
}
