//! The ACP adapter, on the SDK's own connection machinery.
//!
//! [`serve`] registers one typed handler per method on
//! [`agent_client_protocol::Builder`] and hands the transport to the SDK.
//! Everything transport-shaped that used to live here is the SDK's job now,
//! and deliberately so — each of these was once hand-built in this file, as an
//! invariant maintained by design notes:
//!
//! - **One outgoing queue.** Responses and `session/update` notifications
//!   leave through the same queue, so a `session/prompt` response can never
//!   overtake the updates of its own turn. The SDK's outgoing actor is that
//!   queue; [`AcpNotifier`] pushes into it via the connection handle rather
//!   than owning a second one.
//! - **EOF drains the queue.** Responses already accepted when the client
//!   hangs up are written out before the connection future resolves, so a
//!   client that batches requests and closes its end still gets every answer.
//! - **Unknown methods answer `method_not_found`**, with the method name in
//!   the error data.
//!
//! What remains here is what is genuinely this agent's: which methods exist,
//! what each one does to the session service, and which MCP servers can
//! honestly be forwarded to a cloud sandbox.
//!
//! Prompts and cancels run on connection-spawned tasks so a long-running turn
//! never blocks the event loop — that is what lets `session/cancel` land while
//! a turn is streaming.

#[cfg(test)]
mod test;

use crate::domain::model::{McpHeader, McpServer, McpTransport};
use crate::domain::ports::{CursorAgents, RepoResolver, RunStream, SessionNotifier};
use crate::domain::service::CursorSessionService;
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    AgentCapabilities, AuthenticateRequest, AuthenticateResponse, CancelNotification,
    CloseSessionRequest, CloseSessionResponse, ContentBlock, Error as AcpError, HttpHeader,
    Implementation, InitializeRequest, InitializeResponse, LoadSessionRequest, LoadSessionResponse,
    McpCapabilities, McpServer as AcpMcpServer, NewSessionRequest, NewSessionResponse,
    PromptCapabilities, PromptRequest, PromptResponse, SessionConfigId, SessionConfigKind,
    SessionConfigOption, SessionConfigSelect, SessionConfigSelectOption,
    SessionConfigSelectOptions, SessionConfigValueId, SessionId, SessionNotification,
    SessionUpdate, SetSessionConfigOptionRequest, SetSessionConfigOptionResponse,
};
use agent_client_protocol::{
    Agent, ByteStreams, Client, ConnectTo, ConnectionTo, on_receive_notification,
    on_receive_request,
};
use std::sync::{Arc, OnceLock};
use tokio_util::compat::{TokioAsyncReadCompatExt as _, TokioAsyncWriteCompatExt as _};

/// The ACP config-option id for a session's model.
///
/// Defined here rather than shared with the Macro harness: this crate is a
/// standalone ACP agent (see the `cursor_cloud_agents` binary) and must not
/// depend on its embedder. `"model"` is the id every ACP client looks for, and
/// the harness uses the same literal for the same reason.
const MODEL_CONFIG_ID: &str = "model";

/// Cursor's own "let the server pick" model (`GET /v1/models` lists it as
/// `default`, displayed "Auto") — the select's resting value when nothing has
/// been chosen.
const AUTO_MODEL_ID: &str = "default";

/// Delivers session updates as `session/update` notifications on the ACP
/// connection.
///
/// The domain service holds one of these for the whole connection and notifies
/// from wherever a turn produces updates — including
/// [`CursorSessionService::sync_foreign_runs`], which the Macro harness drives
/// on its own timer, *outside* any request handler. That is why this wraps a
/// connection handle the service can hold from construction, filled in by
/// [`serve`] once the connection exists, rather than a handle passed per call.
///
/// Notifications enter the connection's own outgoing queue — the same one
/// responses use — so a turn's updates and its `session/prompt` response
/// cannot reorder.
#[derive(Clone, Debug, Default)]
pub struct AcpNotifier {
    /// Empty until the connection is up. Write-once: one notifier serves one
    /// connection, exactly as one service does.
    connection: Arc<OnceLock<ConnectionTo<Client>>>,
}

impl AcpNotifier {
    /// A notifier awaiting its connection.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Attach the connection updates will travel over.
    fn bind(&self, connection: ConnectionTo<Client>) {
        // A second bind can only be a bug in `serve`; the first connection
        // stays authoritative and the duplicate is dropped.
        let _ = self.connection.set(connection);
    }
}

impl SessionNotifier for AcpNotifier {
    async fn notify(
        &self,
        session: &SessionId,
        update: SessionUpdate,
    ) -> Result<(), rootcause::Report> {
        // Unreachable in practice: the binding runner starts with the
        // connection's event loop, before any handler can run a turn. Failing
        // loudly beats buffering updates nobody may ever collect.
        let connection = self
            .connection
            .get()
            .ok_or_else(|| rootcause::report!("session update before the acp connection was up"))?;
        connection
            .send_notification(SessionNotification::new(session.clone(), update))
            .map_err(|error| rootcause::report!("{error}"))
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
/// crate models it, so image and audio stay false.
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

/// Serve ACP over a byte stream until it closes: newline-delimited JSON, one
/// frame per line.
///
/// The two production transports are both byte streams — the binary's
/// stdin/stdout, and the Macro harness's in-process `tokio::io::duplex` — so
/// this takes the tokio halves directly and keeps the SDK types out of the
/// callers. Anything more exotic goes through [`serve_transport`].
///
/// `notifier` must be the same [`AcpNotifier`] the service was constructed
/// with (they share state through a clone): the service delivers updates
/// through it, and this function is what binds it to the connection.
///
/// # Errors
///
/// A clean EOF from the client is `Ok`; transport and protocol-level failures
/// are the SDK's error.
pub async fn serve<Reader, Writer, Cursor, Notifier, Repos>(
    service: Arc<CursorSessionService<Cursor, Notifier, Repos>>,
    notifier: AcpNotifier,
    reader: Reader,
    writer: Writer,
) -> Result<(), AcpError>
where
    Reader: tokio::io::AsyncRead + Send + 'static,
    Writer: tokio::io::AsyncWrite + Send + 'static,
    Cursor: CursorAgents + RunStream + Send + Sync + 'static,
    Notifier: SessionNotifier + Send + Sync + 'static,
    Repos: RepoResolver + Send + Sync + 'static,
{
    serve_transport(
        service,
        notifier,
        ByteStreams::new(writer.compat_write(), reader.compat()),
    )
    .await
}

/// [`serve`] over any transport the SDK can connect to — a
/// [`Channel`](agent_client_protocol::Channel) pair in tests, byte streams in
/// production.
///
/// # Errors
///
/// A clean EOF from the client is `Ok`; transport and protocol-level failures
/// are the SDK's error.
pub async fn serve_transport<Transport, Cursor, Notifier, Repos>(
    service: Arc<CursorSessionService<Cursor, Notifier, Repos>>,
    notifier: AcpNotifier,
    transport: Transport,
) -> Result<(), AcpError>
where
    Transport: ConnectTo<Agent> + 'static,
    Cursor: CursorAgents + RunStream + Send + Sync + 'static,
    Notifier: SessionNotifier + Send + Sync + 'static,
    Repos: RepoResolver + Send + Sync + 'static,
{
    Agent
        .builder()
        .name("cursor-cloud-agents")
        // Runs with the connection's event loop, so the notifier is bound
        // before any handler can start a turn that would notify.
        .with_spawned(move |connection| async move {
            notifier.bind(connection);
            Ok(())
        })
        .on_receive_request(
            async move |request: InitializeRequest, responder, _connection| {
                // Answer with the newest version both sides speak: a client
                // offering v0 must not be told v1 and left disagreeing about
                // the wire format, and a client offering something newer than
                // this agent gets this agent's newest, not an echo.
                responder.respond(
                    InitializeResponse::new(request.protocol_version.min(ProtocolVersion::V1))
                        .agent_capabilities(agent_capabilities())
                        .agent_info(Implementation::new("cursor-acp", env!("CARGO_PKG_VERSION"))),
                )
            },
            on_receive_request!(),
        )
        .on_receive_request(
            async move |_request: AuthenticateRequest, responder, _connection| {
                // The API key comes from the environment; nothing to negotiate
                // with the client, so not even the method it named is read.
                responder.respond(AuthenticateResponse::new())
            },
            on_receive_request!(),
        )
        .on_receive_request(
            {
                let service = Arc::clone(&service);
                async move |request: NewSessionRequest, responder, _connection| {
                    let mcp_servers = forwardable_mcp_servers(request.mcp_servers);
                    let session = service.new_session(&request.cwd, mcp_servers);
                    let options = session_config_options(&service, &session).await;
                    responder.respond(NewSessionResponse::new(session).config_options(options))
                }
            },
            on_receive_request!(),
        )
        .on_receive_request(
            {
                let service = Arc::clone(&service);
                async move |request: PromptRequest, responder, connection| {
                    // On its own task so the event loop keeps servicing
                    // cancels while the turn streams.
                    let service = Arc::clone(&service);
                    connection.spawn(async move {
                        let session = request.session_id;
                        let text = prompt_text(&request.prompt);
                        // A failed respond means the client is gone; failing
                        // the spawned task would tear down the (already
                        // closing) connection, so it is dropped instead.
                        match service.prompt(&session, &text).await {
                            Ok(stop_reason) => {
                                let _ = responder.respond(PromptResponse::new(stop_reason));
                            }
                            Err(error) => {
                                tracing::error!(error = %error, "prompt failed");
                                let _ = responder
                                    .respond_with_error(AcpError::new(-32603, error.to_string()));
                            }
                        }
                        Ok(())
                    })
                }
            },
            on_receive_request!(),
        )
        .on_receive_request(
            {
                let service = Arc::clone(&service);
                async move |request: LoadSessionRequest, responder, _connection| {
                    // Loading is a lookup, not a fetch: a host that restarts
                    // restores its persisted (session -> agent) pairs with
                    // `restore_session` before serving, so by the time a
                    // `session/load` arrives the session either exists or
                    // never will. No history is replayed — the hosts this
                    // agent serves keep their own durable log of every frame,
                    // and Cursor accumulates the conversation server-side, so
                    // a replay would tell the client what it already knows.
                    let session = request.session_id;
                    if service.has_session(&session) {
                        // The MCP list is the client's, and a load restates
                        // it — the one way a restored process, whose host
                        // never persisted the list, learns it again.
                        service.set_mcp_servers(
                            &session,
                            forwardable_mcp_servers(request.mcp_servers),
                        );
                        let options = session_config_options(&service, &session).await;
                        responder.respond(LoadSessionResponse::new().config_options(options))
                    } else {
                        responder.respond_with_error(AcpError::invalid_params())
                    }
                }
            },
            on_receive_request!(),
        )
        .on_receive_request(
            {
                let service = Arc::clone(&service);
                async move |request: CloseSessionRequest, responder, _connection| {
                    // Dropping a session the client is done with, so the
                    // session map does not grow for the process lifetime. A
                    // session this agent never had is the client's mistake,
                    // not a no-op worth acknowledging.
                    if service.close(&request.session_id) {
                        responder.respond(CloseSessionResponse::new())
                    } else {
                        responder.respond_with_error(AcpError::invalid_params())
                    }
                }
            },
            on_receive_request!(),
        )
        .on_receive_request(
            {
                let service = Arc::clone(&service);
                async move |request: SetSessionConfigOptionRequest, responder, _connection| {
                    let session = request.session_id;
                    // Only the model is configurable, so anything else is the
                    // client naming an option this agent never advertised.
                    if request.config_id.to_string() != MODEL_CONFIG_ID {
                        return responder.respond_with_error(AcpError::invalid_params());
                    }
                    let Some(model) = request.value.as_value_id() else {
                        return responder.respond_with_error(AcpError::invalid_params());
                    };
                    if let Err(error) = service.set_model(&session, &model.to_string()).await {
                        // The id is the client's to get right, and the error
                        // names what this account may choose instead.
                        tracing::warn!(error = %error, "could not set the session model");
                        return responder.respond_with_error(AcpError::invalid_params());
                    }
                    // Answered with the whole option set, not just the new
                    // value: that is the shape a client folds config from, and
                    // it is the same shape `session/new` sent.
                    let options = session_config_options(&service, &session).await;
                    responder.respond(SetSessionConfigOptionResponse::new(options))
                }
            },
            on_receive_request!(),
        )
        .on_receive_notification(
            {
                let service = Arc::clone(&service);
                async move |notification: CancelNotification, connection| {
                    // Spawned for the same reason prompts are: cancelling is a
                    // Cursor API round trip, and the event loop must not wait
                    // on it.
                    let service = Arc::clone(&service);
                    connection.spawn(async move {
                        let session = notification.session_id;
                        if let Err(error) = service.cancel(&session).await {
                            tracing::error!(error = %error, "cancel failed");
                        }
                        Ok(())
                    })
                }
            },
            on_receive_notification!(),
        )
        .connect_to(transport)
        .await
}

/// The session's config options: the model select, and nothing else yet.
///
/// This is the whole of how a client learns which models exist and which one a
/// session is on — ACP carries it as `configOptions` on the `session/new`,
/// `session/load` and `session/set_config_option` responses, and a client reads
/// the same field whichever response it arrived on.
///
/// One entry per model, using Cursor's own default variant, rather than one per
/// variant: `claude-opus-4-8` alone offers forty, and a picker listing hundreds
/// of near-identical rows is worse than one listing the models. Exposing the
/// variant parameters (`effort`, `reasoning`, `fast`) is a separate control and
/// a separate change.
///
/// A failure to reach `GET /v1/models` costs the picker, not the session: the
/// options come back empty and the client simply has nothing to offer, which is
/// the state it was in before any of this existed.
async fn session_config_options<Cursor, Notifier, Repos>(
    service: &CursorSessionService<Cursor, Notifier, Repos>,
    session: &SessionId,
) -> Vec<SessionConfigOption>
where
    Cursor: CursorAgents + RunStream,
    Notifier: SessionNotifier,
    Repos: RepoResolver,
{
    let models = match service.models().await {
        Ok(models) => models,
        Err(error) => {
            tracing::warn!(error = %error, "could not list cursor models; offering no model choice");
            return Vec::new();
        }
    };
    let current = match service.session_model_id(session).await {
        Ok(current) => current,
        Err(error) => {
            tracing::warn!(error = %error, "could not read the session's model");
            return Vec::new();
        }
    };
    // With no explicit or configured choice, the select rests on Cursor's own
    // "Auto" entry — a real model in their list (`id: "default"`), the same
    // resting value their own picker shows, and the closest ACP can get to
    // the truth: the account's configured default is resolved server-side at
    // agent creation and never disclosed (`/v1/me` and `/v1/models` both
    // carry no marker for it). Display only — the session's state stays
    // unset, so runs keep omitting `model` and Cursor keeps resolving the
    // user's own default. Only an explicit pick of "Auto" pins `default` onto
    // the wire, which forces Auto routing over the account default; the
    // difference is invisible unless the account default is a concrete model.
    //
    // If Cursor ever drops the entry there is no honest resting value, and no
    // picker beats one resting on a guess.
    let current = current.or_else(|| {
        models
            .iter()
            .find(|model| model.id == AUTO_MODEL_ID)
            .map(|model| model.id.clone())
    });
    let Some(current) = current else {
        return Vec::new();
    };
    let options: Vec<SessionConfigSelectOption> = models
        .iter()
        .map(|model| {
            SessionConfigSelectOption::new(
                SessionConfigValueId::new(model.id.clone()),
                model.display_name.clone(),
            )
        })
        .collect();
    vec![SessionConfigOption::new(
        SessionConfigId::new(MODEL_CONFIG_ID),
        "Model",
        SessionConfigKind::Select(SessionConfigSelect::new(
            SessionConfigValueId::new(current),
            SessionConfigSelectOptions::Ungrouped(options),
        )),
    )]
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
