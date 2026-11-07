//! ACP v1 transport and cloud event projection.
use crate::domain::acp_session::{Outcome, SessionService, SessionSink, SessionStore};
use crate::domain::cloud::CloudEvent;
use crate::domain::runtime::CloudRuntime;
use agent_client_protocol::schema::{ProtocolVersion, v1::*};
use agent_client_protocol::{
    Agent, ByteStreams, Client, ConnectionTo, on_receive_notification, on_receive_request,
};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio_util::compat::{TokioAsyncReadCompatExt as _, TokioAsyncWriteCompatExt as _};

mod citations;

struct Sink {
    connection: ConnectionTo<Client>,
    session: SessionId,
    replay: bool,
    text: Mutex<HashMap<String, String>>,
}
impl SessionSink for Sink {
    fn emit(&self, event: &CloudEvent) -> Result<(), rootcause::Report> {
        if event.method == "session/turn_complete" {
            if self.replay {
                use agent_runtime_protocol::domain::turn::{TurnCompleteNotification, TurnOutcome};
                let outcome = match event.params["status"].as_str() {
                    Some("completed") => TurnOutcome::Finished,
                    Some("cancelled") => TurnOutcome::Cancelled,
                    Some("failed") => TurnOutcome::Failed {
                        message: "cloud assistant turn failed".into(),
                    },
                    _ => return Err(rootcause::report!("unknown terminal journal outcome")),
                };
                self.connection
                    .send_notification(TurnCompleteNotification {
                        session_id: self.session.clone(),
                        outcome,
                    })
                    .map_err(|_| rootcause::report!("ACP client disconnected"))?;
            }
            return Ok(());
        }
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
struct RecoverySink {
    session: SessionId,
    reload: Option<tokio::sync::mpsc::UnboundedSender<SessionId>>,
    changed: std::sync::atomic::AtomicBool,
}
impl SessionSink for RecoverySink {
    fn emit(&self, _: &CloudEvent) -> Result<(), rootcause::Report> {
        self.changed
            .store(true, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    }
    fn recovered(&self) -> Result<bool, rootcause::Report> {
        if !self.changed.load(std::sync::atomic::Ordering::SeqCst) {
            return Ok(false);
        }
        if let Some(reload) = &self.reload {
            reload
                .send(self.session.clone())
                .map_err(|_| rootcause::report!("ACP host disconnected during recovery"))?;
            Ok(true)
        } else {
            eprintln!("Recovered Codex history is available through session/load");
            Ok(false)
        }
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
        "adapter/pull_request" => {
            if text
                .insert(format!("tool:{}", event.id), String::new())
                .is_some()
            {
                return Vec::new();
            }
            let Some(url) = p["url"].as_str() else {
                return Vec::new();
            };
            vec![SessionUpdate::ToolCall(
                ToolCall::new(event.id.clone(), "Found pull request")
                    .kind(ToolKind::Other)
                    .status(ToolCallStatus::Completed)
                    .raw_input(serde_json::json!({"url": url}))
                    .raw_output(p.clone())
                    .content(vec![ToolCallContent::from(ContentBlock::Text(
                        TextContent::new(format!("[View pull request]({url})")),
                    ))]),
            )]
        }
        "user/message" => {
            text.clear();
            vec![SessionUpdate::UserMessageChunk(chunk(
                p["text"].as_str().unwrap_or(""),
            ))]
        }
        "item/reasoning/summaryTextDelta" | "item/reasoning/textDelta" => {
            vec![SessionUpdate::AgentThoughtChunk(chunk(
                p["delta"].as_str().unwrap_or(""),
            ))]
        }
        "item/completed" if p["item"]["type"].as_str() == Some("agentMessage") => {
            let item = &p["item"];
            let id = item["id"].as_str().unwrap_or("");
            let final_text = item["text"].as_str().unwrap_or("");
            if final_text.is_empty() || text.insert(format!("done:{id}"), String::new()).is_some() {
                return Vec::new();
            }
            let separator = if text
                .insert("message-separator".into(), String::new())
                .is_some()
            {
                "\n\n"
            } else {
                ""
            };
            vec![SessionUpdate::AgentMessageChunk(chunk(&format!(
                "{separator}{}",
                citations::markdown(final_text)
            )))]
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
pub async fn serve<Runtime, J, R, W>(
    service: Arc<SessionService<Runtime, J>>,
    reader: R,
    writer: W,
    reload: Option<tokio::sync::mpsc::UnboundedSender<SessionId>>,
) -> Result<(), Error>
where
    Runtime: CloudRuntime + 'static,
    J: SessionStore + 'static,
    R: tokio::io::AsyncRead + Send + 'static,
    W: tokio::io::AsyncWrite + Send + 'static,
{
    let metadata_service = service.clone();
    let metadata_reload = reload.clone();
    let connection = Agent
        .builder()
        .name("codex-cloud-acp")
        .on_receive_request(
            async move |request: InitializeRequest, responder, _connection| {
                responder.respond(
                    InitializeResponse::new(request.protocol_version.min(ProtocolVersion::V1))
                        .agent_info(Implementation::new("codex_acp", env!("CARGO_PKG_VERSION")))
                        .agent_capabilities(AgentCapabilities::default().load_session(true)),
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
                    match service.new_session().await {
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
                    let reload = reload.clone();
                    if !request.mcp_servers.is_empty() {
                        return responder.respond_with_error(Error::new(
                            -32602,
                            "MCP servers are not supported by this cloud adapter",
                        ));
                    }
                    let notifier = sink(connection.clone(), request.session_id.clone(), true);
                    let service = service.clone();
                    connection.spawn(async move {
                        let recovery = match service
                            .prepare_recovery(&request.session_id.to_string(), &notifier)
                            .await
                        {
                            Ok(recovery) => recovery,
                            Err(e) => return responder.respond_with_error(error(e)),
                        };
                        responder.respond(LoadSessionResponse::new())?;
                        let capture = RecoverySink {
                            session: request.session_id.clone(),
                            reload,
                            changed: std::sync::atomic::AtomicBool::new(false),
                        };
                        service
                            .finish_recovery(&request.session_id.to_string(), recovery, &capture)
                            .await
                            .map(|_| ())
                            .map_err(error)
                    })
                }
            },
            on_receive_request!(),
        )
        .on_receive_request(
            {
                let service = service.clone();
                async move |request: PromptRequest, responder, connection| {
                    let _text = match prompt_text(request.prompt.clone()) {
                        Ok(text) => text,
                        Err(e) => return responder.respond_with_error(e),
                    };
                    let service = service.clone();
                    let notifier = sink(connection.clone(), request.session_id.clone(), false);
                    connection.spawn(async move {
                        match service
                            .prompt(&request.session_id.to_string(), request.prompt, &notifier)
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
        .connect_to(ByteStreams::new(writer.compat_write(), reader.compat()));
    let refresh = async move {
        let base = std::time::Duration::from_secs(20);
        let mut delay = base;
        loop {
            tokio::select! {
                _=tokio::time::sleep(delay)=>{},
                _=metadata_service.metadata_changed()=>{delay=base;}
            }
            match metadata_service.refresh_metadata().await {
                Ok(changed) => {
                    delay = base;
                    if let Some(reload) = &metadata_reload {
                        for id in changed {
                            if reload.send(SessionId::new(id)).is_err() {
                                return;
                            }
                        }
                    }
                }
                Err(error) => {
                    eprintln!("codex_acp: metadata refresh unavailable: {error}");
                    delay = delay
                        .saturating_mul(2)
                        .min(std::time::Duration::from_secs(300));
                }
            }
        }
    };
    tokio::pin!(connection);
    tokio::select! {result=&mut connection=>result, _=refresh=>connection.await}
}
#[cfg(test)]
mod test;
