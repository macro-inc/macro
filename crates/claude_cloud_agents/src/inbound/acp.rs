//! Thin ACP transport over the account-scoped Claude session service.
use crate::domain::{
    model::{Error, Result},
    models::{Catalog, Model},
    ports::Cloud,
    service::Session,
    translate::Update,
};
use agent_runtime_protocol::domain::{
    connection::ServerChannel,
    schema::v0::{AcpMessage, SystemEvent, ToRuntimeMessage, ToServerMessage},
};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc::UnboundedSender;

mod mcp;
mod permissions;

/// Attach a Claude conversation to Macro's existing runtime protocol.
pub fn attach<C: Cloud>(session: Arc<Session<C>>) -> ServerChannel {
    let (server, mut runtime) = ServerChannel::duplex();
    tokio::spawn(async move {
        let tx = runtime.tx;
        let permissions =
            permissions::Permissions::new(tx.clone(), session.id().as_str().to_owned());
        let _ = tx.send(ToServerMessage::Event {
            event: SystemEvent::AcpReady,
        });
        let mut turns = tokio::task::JoinSet::new();
        let mut mirrors = tokio::task::JoinSet::new();
        let usage_totals = Arc::new(Mutex::new((0u64, 0u64)));
        let every = std::time::Duration::from_secs(2);
        let mut mirror = tokio::time::interval_at(tokio::time::Instant::now() + every, every);
        mirror.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        let mut ready = false;
        let mut retry_after = tokio::time::Instant::now();
        loop {
            tokio::select! {
                _ = tx.closed() => break,
                Some(_) = turns.join_next(), if !turns.is_empty() => {},
                Some(result) = mirrors.join_next(), if !mirrors.is_empty() => {
                    if !matches!(result, Ok(Ok(()))) {
                        retry_after = tokio::time::Instant::now() + std::time::Duration::from_secs(30);
                    }
                }
                _ = mirror.tick(), if ready && turns.is_empty() && mirrors.is_empty() => {
                    if tokio::time::Instant::now() < retry_after { continue; }
                    let session = session.clone();
                    let tx = tx.clone();
                    let usage_totals = usage_totals.clone();
                    mirrors.spawn(async move {
                        session.sync_foreign(|update| {
                            if let Update::Finished { usage, .. } = &update { let _ = cumulative_usage(&usage_totals, usage); }
                            notification(&tx, session.id().as_str(), update)
                        }).await
                    });
                }
                incoming = runtime.rx.recv() => {
                    let Some(ToRuntimeMessage::Acp(AcpMessage(raw))) = incoming else { break; };
                    let Ok(frame) = serde_json::to_value(raw) else { break; };
                    if frame.get("method").is_none() {
                        permissions.respond(&frame);
                        continue;
                    }
                    let id = frame.get("id").cloned();
                    let params = &frame["params"];
                    let method = frame["method"].as_str().unwrap_or_default();
                    if method.starts_with("session/") && method != "session/new" && params["sessionId"].as_str() != Some(session.id().as_str()) {
                        if let Some(id) = id { let _ = failure(&tx, id, "Unknown Claude session"); }
                        continue;
                    }
                    match method {
                        "initialize" => { if let Some(id) = id { let _ = reply(&tx, id, json!({
                            "protocolVersion":1, "agentCapabilities":{"loadSession":true,"mcpCapabilities":{"http":true,"sse":true}},
                            "agentInfo":{"name":"claude-cloud","title":"Claude Cloud","version":"0.1.0"}, "authMethods":[]
                        })); } }
                        "session/new" => {
                            let setup = match mcp::servers(params) {
                                Ok(servers) => session.configure_mcp(servers).await,
                                Err(error) => Err(error),
                            };
                            if let Err(error) = setup {
                                if let Some(id) = id { let _ = failure(&tx, id, &error.to_string()); }
                                continue;
                            }
                            if let Err(error) = session.refresh_catalog().await {
                                if let Some(id) = id { let _ = failure(&tx, id, &error.to_string()); }
                                continue;
                            }
                            if let Some(id) = id {
                                let _ = reply(&tx, id, json!({"sessionId":session.id().as_str(), "configOptions":model_options(&session.catalog().await, &session.model().await)}));
                                ready = true;
                            }
                        }
                        "session/load" => {
                            let setup = match mcp::servers(params) {
                                Ok(servers) => session.configure_mcp(servers).await,
                                Err(error) => Err(error),
                            };
                            if let Err(error) = setup {
                                if let Some(id) = id { let _ = failure(&tx, id, &error.to_string()); }
                                continue;
                            }
                            mirrors.abort_all();
                            while mirrors.join_next().await.is_some() {}
                            if let Some(id) = id {
                                match session.load().await {
                                    Ok(updates) => {
                                        if let Ok(mut totals) = usage_totals.lock() { *totals = (0, 0); }
                                        for update in updates {
                                            if let Update::Finished { usage, .. } = &update { let _ = cumulative_usage(&usage_totals, usage); }
                                            let _ = notification(&tx, session.id().as_str(), update);
                                        }
                                        let _ = reply(&tx, id, json!({"configOptions":model_options(&session.catalog().await, &session.model().await)}));
                                        ready = true;
                                    }
                                    Err(error) => { let _ = failure(&tx, id, &error.to_string()); }
                                }
                            }
                        }
                        "session/prompt" => {
                            let Some(id) = id else { continue; };
                            if !turns.is_empty() { let _ = failure(&tx, id, "Claude still has a turn in progress"); continue; }
                            let Some(blocks) = params["prompt"].as_array() else { let _ = failure(&tx, id, "A text prompt is required"); continue; };
                            if blocks.iter().any(|b| b["type"] != "text") { let _ = failure(&tx, id, "The Claude demo currently supports text prompts only"); continue; }
                            let text = blocks.iter().filter_map(|b| b["text"].as_str()).collect::<Vec<_>>().join("\n");
                            let session = session.clone();
                            let tx = tx.clone();
                            let usage_totals = usage_totals.clone();
                            let permissions = permissions.clone();
                            turns.spawn(async move {
                                let final_result = Arc::new(Mutex::new(None));
                                let observed = final_result.clone();
                                let outcome = session.prompt_with_permissions(text, |update| {
                                    if let Update::Finished { failed, cancelled, usage } = update {
                                        *observed.lock().map_err(|_| Error::Protocol)? = Some((failed, cancelled, usage));
                                        Ok(())
                                    } else { notification(&tx, session.id().as_str(), update) }
                                }, &permissions).await;
                                match outcome {
                                    Err(error) => { let _ = failure(&tx, id, &error.to_string()); }
                                    Ok(()) => {
                                        let result = final_result.lock().ok().and_then(|r| r.clone());
                                        match result {
                                            Some((false, cancelled, usage)) => { let _ = reply(&tx, id, json!({"stopReason":if cancelled {"cancelled"} else {"end_turn"}, "usage":cumulative_usage(&usage_totals, &usage), "_meta":{"claudeCode":{"usage":usage}}})); }
                                            Some((true, true, _)) => { let _ = reply(&tx, id, json!({"stopReason":"cancelled"})); }
                                            _ => { let _ = failure(&tx, id, "Claude reported an unsuccessful turn"); }
                                        }
                                    }
                                }
                            });
                        }
                        "session/cancel" => {
                            let outcome = session.cancel().await;
                            if let Some(id) = id {
                                match outcome { Ok(()) => { let _ = reply(&tx, id, json!({})); }, Err(error) => { let _ = failure(&tx, id, &error.to_string()); } }
                            } else if outcome.is_err() {
                                let _ = notification(&tx, session.id().as_str(), Update::Text("\nClaude could not confirm cancellation; check the session in Claude.\n".into()));
                            }
                        }
                        "session/set_config_option" if params["configId"] == "model" => {
                            let Some(id) = id else { continue; };
                            let model = match Model::parse(params["value"].as_str().unwrap_or_default()) {
                                Ok(model) => model,
                                Err(error) => { let _ = failure(&tx, id, &error.to_string()); continue; }
                            };
                            let session = session.clone();
                            let tx = tx.clone();
                            turns.spawn(async move {
                                match session.set_model(model.clone()).await {
                                    Ok(()) => { let _ = reply(&tx, id, json!({"configOptions":model_options(&session.catalog().await, &model)})); }
                                    Err(error) => { let _ = failure(&tx, id, &error.to_string()); }
                                }
                            });
                        }
                        _ => { if let Some(id) = id { let _ = failure(&tx, id, "Unsupported operation in the Claude Cloud demo"); } }
                    }
                }
            }
        }
        // Losing Macro's transport must not leave locally-running adapter tasks behind.
        // The provider conversation remains resumable; do not archive on disconnect.
        turns.abort_all();
        mirrors.abort_all();
    });
    server
}

/// Map domain discovery to Macro's standard ACP model picker.
pub fn model_options(catalog: &Catalog, model: &Model) -> Value {
    let options: Vec<_> = catalog
        .options()
        .iter()
        .map(|m| json!({"value":m.model.id(),"name":m.name,"description":m.description}))
        .collect();
    json!([{"id":"model","name":"Model","category":"model","type":"select","currentValue":model.id(),"options":options}])
}

fn cumulative_usage(totals: &Mutex<(u64, u64)>, usage: &Value) -> Value {
    let Ok(mut totals) = totals.lock() else {
        return Value::Null;
    };
    totals.0 = totals
        .0
        .saturating_add(usage["input_tokens"].as_u64().unwrap_or(0));
    totals.1 = totals
        .1
        .saturating_add(usage["output_tokens"].as_u64().unwrap_or(0));
    json!({"inputTokens":totals.0,"outputTokens":totals.1})
}

fn send(tx: &UnboundedSender<ToServerMessage>, value: Value) -> Result<()> {
    let frame = serde_json::from_value(value).map_err(|_| Error::Protocol)?;
    tx.send(ToServerMessage::Acp(AcpMessage(frame)))
        .map_err(|_| Error::Network)
}
fn reply(tx: &UnboundedSender<ToServerMessage>, id: Value, result: Value) -> Result<()> {
    send(tx, json!({"jsonrpc":"2.0","id":id,"result":result}))
}
fn failure(tx: &UnboundedSender<ToServerMessage>, id: Value, message: &str) -> Result<()> {
    send(
        tx,
        json!({"jsonrpc":"2.0","id":id,"error":{"code":-32000,"message":message}}),
    )
}

fn notification(
    tx: &UnboundedSender<ToServerMessage>,
    session: &str,
    update: Update,
) -> Result<()> {
    let update = match update {
        Update::Models { catalog, current } => {
            json!({"sessionUpdate":"config_option_update","configOptions":model_options(&catalog, &current)})
        }
        Update::Text(text) => {
            json!({"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":text}})
        }
        Update::Thought(text) => {
            json!({"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":text}})
        }
        Update::User(text) => {
            json!({"sessionUpdate":"user_message_chunk","content":{"type":"text","text":text}})
        }
        Update::Tool {
            id,
            name,
            input,
            parent,
        } => {
            json!({"sessionUpdate":"tool_call","toolCallId":id,"title":name,"kind":"other","status":"in_progress","rawInput":input,
            "_meta":{"claudeCode":{"toolName":name,"parentToolUseId":parent}}})
        }
        Update::ToolResult { id, output, failed } => {
            json!({"sessionUpdate":"tool_call_update","toolCallId":id,"status":if failed {"failed"} else {"completed"},"rawOutput":output})
        }
        Update::Finished {
            failed, cancelled, ..
        } => {
            let outcome = if cancelled {
                json!({"kind":"cancelled"})
            } else if failed {
                json!({"kind":"failed", "message":"Claude reported an unsuccessful turn"})
            } else {
                json!({"kind":"finished"})
            };
            return send(
                tx,
                json!({"jsonrpc":"2.0","method":"_session/turn_complete","params":{"sessionId":session,"outcome":outcome}}),
            );
        }
    };
    send(
        tx,
        json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":session,"update":update}}),
    )
}

#[cfg(test)]
mod test;
