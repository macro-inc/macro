//! ACP v1 transport and cloud event projection.
use crate::domain::acp_session::{Outcome, SessionService, SessionSink, SessionStore};
use crate::domain::cloud::{CloudConversation, CloudEvent};
use crate::domain::{CredentialStore, OAuth};
use agent_client_protocol::schema::{ProtocolVersion, v1::*};
use agent_client_protocol::{
    Agent, ByteStreams, Client, ConnectionTo, on_receive_notification, on_receive_request,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio_util::compat::{TokioAsyncReadCompatExt as _, TokioAsyncWriteCompatExt as _};

struct Sink {
    connection: ConnectionTo<Client>,
    session: SessionId,
    replay: bool,
    text: Mutex<HashMap<String, String>>,
}
impl SessionSink for Sink {
    fn emit(&self, event: &CloudEvent) -> Result<(), rootcause::Report> {
        if event.method == "user/message" && !self.replay {
            return Ok(());
        }
        for update in project(
            event,
            &mut self.text.lock().expect("text projection poisoned"),
        ) {
            self.connection
                .send_notification(SessionNotification::new(self.session.clone(), update))
                .map_err(|_| rootcause::report!("ACP client disconnected"))?;
        }
        Ok(())
    }
}
fn chunk(text: &str) -> ContentChunk {
    ContentChunk::new(ContentBlock::Text(TextContent::new(text)))
}
fn project(event: &CloudEvent, text: &mut HashMap<String, String>) -> Vec<SessionUpdate> {
    let p = &event.params;
    let item_id = p
        .get("itemId")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .to_owned();
    match event.method.as_str() {
        "user/message" => vec![SessionUpdate::UserMessageChunk(chunk(
            p["text"].as_str().unwrap_or(""),
        ))],
        "item/agentMessage/delta" => {
            if text.contains_key(&format!("done:{item_id}")) {
                return Vec::new();
            }
            let delta = p["delta"].as_str().unwrap_or("");
            text.entry(item_id).or_default().push_str(delta);
            vec![SessionUpdate::AgentMessageChunk(chunk(delta))]
        }
        "item/reasoning/summaryTextDelta" | "item/reasoning/textDelta" => {
            vec![SessionUpdate::AgentThoughtChunk(chunk(
                p["delta"].as_str().unwrap_or(""),
            ))]
        }
        "item/completed" if p["item"]["type"].as_str() == Some("agentMessage") => {
            let item = &p["item"];
            let id = item["id"].as_str().unwrap_or("").to_owned();
            let final_text = item["text"].as_str().unwrap_or("");
            let previous = text.entry(id).or_default();
            let remaining = match final_text.strip_prefix(previous.as_str()) {
                Some(suffix) => suffix.to_owned(),
                None => format!("\n\nCorrected provider message:\n{final_text}"),
            };
            let update = (!remaining.is_empty())
                .then(|| SessionUpdate::AgentMessageChunk(chunk(&remaining)));
            *previous = final_text.to_owned();
            text.insert(
                format!("done:{}", item["id"].as_str().unwrap_or("")),
                String::new(),
            );
            update.into_iter().collect()
        }
        "item/commandExecution/outputDelta" => {
            let output = text.entry(format!("output:{item_id}")).or_default();
            output.push_str(p["delta"].as_str().unwrap_or(""));
            vec![SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
                item_id,
                ToolCallUpdateFields::new().content(vec![ToolCallContent::from(
                    ContentBlock::Text(TextContent::new(output.as_str())),
                )]),
            ))]
        }
        "item/started" | "item/completed"
            if matches!(
                p["item"]["type"].as_str(),
                Some("commandExecution" | "fileChange" | "mcpToolCall" | "webSearch")
            ) =>
        {
            let item = &p["item"];
            let id = item["id"].as_str().unwrap_or("");
            if id.is_empty() {
                return Vec::new();
            }
            let kind = match item["type"].as_str() {
                Some("commandExecution") => ToolKind::Execute,
                Some("fileChange") => ToolKind::Edit,
                Some("webSearch") => ToolKind::Search,
                _ => ToolKind::Other,
            };
            let title = item["command"]
                .as_str()
                .or_else(|| item["tool"].as_str())
                .unwrap_or_else(|| item["type"].as_str().unwrap_or("Cloud tool"));
            let status = if event.method == "item/started" {
                ToolCallStatus::InProgress
            } else if item["status"].as_str() == Some("failed")
                || item["exitCode"].as_i64().is_some_and(|code| code != 0)
            {
                ToolCallStatus::Failed
            } else {
                ToolCallStatus::Completed
            };
            let content: Vec<ToolCallContent> = item["aggregatedOutput"]
                .as_str()
                .filter(|output| !output.is_empty())
                .map(|output| ToolCallContent::from(ContentBlock::Text(TextContent::new(output))))
                .into_iter()
                .collect();
            let key = format!("tool:{id}");
            if text.insert(key, String::new()).is_none() {
                vec![SessionUpdate::ToolCall(
                    ToolCall::new(id.to_owned(), title)
                        .kind(kind)
                        .status(status)
                        .raw_input(item.clone())
                        .content(content),
                )]
            } else {
                vec![SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
                    id.to_owned(),
                    ToolCallUpdateFields::new()
                        .kind(kind)
                        .status(status)
                        .raw_output(item.clone())
                        .content(content),
                ))]
            }
        }
        _ => Vec::new(),
    }
}
fn sink(connection: ConnectionTo<Client>, session: SessionId, replay: bool) -> Sink {
    Sink {
        connection,
        session,
        replay,
        text: Mutex::new(HashMap::new()),
    }
}
fn error(error: rootcause::Report) -> Error {
    Error::new(-32603, error.format_current_context().to_string())
}
fn prompt_text(blocks: Vec<ContentBlock>) -> Result<String, Error> {
    let mut texts = Vec::new();
    for block in blocks {
        match block {
            ContentBlock::Text(text) => texts.push(text.text),
            _ => return Err(Error::new(-32602, "Only text prompts are supported")),
        }
    }
    let text = texts.join("\n");
    if text.trim().is_empty() || text.len() > 64 * 1024 {
        return Err(Error::new(
            -32602,
            "Provide a nonempty text prompt (maximum 64 KiB)",
        ));
    }
    Ok(text)
}
/// Serve ACP on tokio byte streams; all writes belong to the SDK's ordered queue.
///
/// Long prompts and cancellation run independently of request dispatch. MCP,
/// terminal, filesystem, model selection and interactive approvals are unsupported.
/// # Errors
/// Returns SDK transport errors; individual operation errors are ACP responses.
pub async fn serve<P, S, J, R, W>(
    service: Arc<SessionService<P, S, J>>,
    reader: R,
    writer: W,
) -> Result<(), Error>
where
    P: OAuth + CloudConversation + 'static,
    S: CredentialStore + Send + Sync + 'static,
    J: SessionStore + 'static,
    R: tokio::io::AsyncRead + Send + 'static,
    W: tokio::io::AsyncWrite + Send + 'static,
{
    Agent
        .builder()
        .name("codex-cloud-acp")
        .on_receive_request(
            async move |request: InitializeRequest, responder, _connection| {
                responder.respond(
                    InitializeResponse::new(request.protocol_version.min(ProtocolVersion::V1))
                        .agent_info(Implementation::new("codex_acp", env!("CARGO_PKG_VERSION")))
                        .agent_capabilities(AgentCapabilities::default().load_session(false)),
                )
            },
            on_receive_request!(),
        )
        .on_receive_request(
            {
                let service = service.clone();
                async move |request: NewSessionRequest, responder, _connection| {
                    if !request.mcp_servers.is_empty() {
                        return responder.respond_with_error(Error::new(
                            -32602,
                            "MCP servers are not supported by this cloud adapter",
                        ));
                    }
                    match service.new_session() {
                        Ok(id) => responder.respond(NewSessionResponse::new(SessionId::new(id))),
                        Err(e) => responder.respond_with_error(error(e)),
                    }
                }
            },
            on_receive_request!(),
        )
        .on_receive_request(
            {
                let service = service.clone();
                async move |request: LoadSessionRequest, responder, connection| {
                    if !request.mcp_servers.is_empty() {
                        return responder.respond_with_error(Error::new(
                            -32602,
                            "MCP servers are not supported by this cloud adapter",
                        ));
                    }
                    match service.replay(
                        &request.session_id.to_string(),
                        &sink(connection.clone(), request.session_id, true),
                    ) {
                        Ok(()) => responder.respond(LoadSessionResponse::new()),
                        Err(e) => responder.respond_with_error(error(e)),
                    }
                }
            },
            on_receive_request!(),
        )
        .on_receive_request(
            {
                let service = service.clone();
                async move |request: PromptRequest, responder, connection| {
                    let text = match prompt_text(request.prompt) {
                        Ok(text) => text,
                        Err(e) => return responder.respond_with_error(e),
                    };
                    let service = service.clone();
                    let notifier = sink(connection.clone(), request.session_id.clone(), false);
                    connection.spawn(async move {
                        match service
                            .prompt(&request.session_id.to_string(), text, &notifier)
                            .await
                        {
                            Ok(outcome) => {
                                let stop = match outcome {
                                    Outcome::Completed => StopReason::EndTurn,
                                    Outcome::Cancelled => StopReason::Cancelled,
                                };
                                let _ = responder.respond(PromptResponse::new(stop));
                            }
                            Err(e) => {
                                let _ = responder.respond_with_error(error(e));
                            }
                        }
                        Ok(())
                    })
                }
            },
            on_receive_request!(),
        )
        .on_receive_notification(
            {
                let service = service.clone();
                async move |request: CancelNotification, connection| {
                    let service = service.clone();
                    connection.spawn(async move {
                        if let Err(e) = service.cancel(&request.session_id.to_string()).await {
                            eprintln!("codex_acp: cancellation failed: {e}");
                        }
                        Ok(())
                    })
                }
            },
            on_receive_notification!(),
        )
        .connect_to(ByteStreams::new(writer.compat_write(), reader.compat()))
        .await
}
#[cfg(test)]
mod test;
