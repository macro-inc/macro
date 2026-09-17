//! Reconcile ephemeral deltas with durable Claude messages before emitting UI updates.
use super::model::{Error, Event, Result};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

/// A provider-neutral display or lifecycle update.
#[derive(Debug, Clone, PartialEq)]
pub enum Update {
    /// Provider-reported models changed while replaying or streaming.
    Models {
        /// Complete catalog, replacing the previous one.
        catalog: super::models::Catalog,
        /// Saved next-turn preference; discovery must not reset it.
        current: super::models::Model,
    },
    /// Assistant-visible text delta.
    Text(String),
    /// Reasoning text explicitly emitted by the provider.
    Thought(String),
    /// Historical user input, emitted only while loading a transcript.
    User(String),
    /// A tool invocation with its provider identity and input.
    Tool {
        /// Stable tool-call id.
        id: String,
        /// Display/tool name.
        name: String,
        /// Tool input.
        input: Value,
        /// Parent call for a delegated agent.
        parent: Option<String>,
    },
    /// Completed tool output.
    ToolResult {
        /// Corresponding call id.
        id: String,
        /// Provider output.
        output: Value,
        /// Whether the tool failed.
        failed: bool,
    },
    /// Final provider result. Usage remains provider-reported, not a Macro API charge.
    Finished {
        /// Failed rather than completed successfully.
        failed: bool,
        /// User cancelled the turn.
        cancelled: bool,
        /// Provider token usage.
        usage: Value,
    },
}

/// Per-attachment state that deduplicates durable messages and reconciles live text.
#[derive(Clone, Default)]
pub struct Translator {
    current_message: Option<String>,
    blocks: BTreeMap<(String, u64), String>,
    durable: BTreeSet<String>,
}

impl Translator {
    /// Process one provider record. History mode includes user messages.
    pub fn accept(&mut self, event: &Event, history: bool) -> Result<Vec<Update>> {
        if event.kind == "catch_up_truncated" {
            return Err(Error::Recovery);
        }
        let payload = &event.data["payload"];
        let mut updates = Vec::new();
        if event.kind == "ephemeral_event" && payload["type"] == "stream_event" {
            let frame = &payload["event"];
            match frame["type"].as_str() {
                Some("message_start") => {
                    self.current_message = frame["message"]["id"].as_str().map(str::to_owned)
                }
                Some("content_block_delta") => {
                    if let (Some(message), Some(index)) =
                        (&self.current_message, frame["index"].as_u64())
                    {
                        let (field, thought) = match frame["delta"]["type"].as_str() {
                            Some("text_delta") => ("text", false),
                            Some("thinking_delta") => ("thinking", true),
                            _ => return Ok(updates),
                        };
                        if let Some(text) = frame["delta"][field].as_str() {
                            self.blocks
                                .entry((message.clone(), index))
                                .or_default()
                                .push_str(text);
                            updates.push(if thought {
                                Update::Thought(text.to_owned())
                            } else {
                                Update::Text(text.to_owned())
                            });
                        }
                    }
                }
                _ => {}
            }
            return Ok(updates);
        }
        if event.kind != "client_event" {
            return Ok(updates);
        }
        if let Some(id) = payload["uuid"].as_str()
            && !self.durable.insert(id.to_owned())
        {
            return Ok(updates);
        }
        match payload["type"].as_str() {
            Some("assistant") => {
                let id = payload["message"]["id"].as_str().ok_or(Error::Protocol)?;
                for (index, block) in payload["message"]["content"]
                    .as_array()
                    .ok_or(Error::Protocol)?
                    .iter()
                    .enumerate()
                {
                    match block["type"].as_str() {
                        Some("text" | "thinking") => {
                            let thought = block["type"] == "thinking";
                            let text = block[if thought { "thinking" } else { "text" }]
                                .as_str()
                                .ok_or(Error::Protocol)?;
                            let sent = self
                                .blocks
                                .entry((id.to_owned(), index as u64))
                                .or_default();
                            let remaining =
                                text.strip_prefix(sent.as_str()).ok_or(Error::Recovery)?;
                            if !remaining.is_empty() {
                                updates.push(if thought {
                                    Update::Thought(remaining.to_owned())
                                } else {
                                    Update::Text(remaining.to_owned())
                                });
                            }
                            *sent = text.to_owned();
                        }
                        Some("tool_use") => updates.push(Update::Tool {
                            id: block["id"].as_str().ok_or(Error::Protocol)?.to_owned(),
                            name: block["name"].as_str().ok_or(Error::Protocol)?.to_owned(),
                            input: block["input"].clone(),
                            parent: payload["parent_tool_use_id"].as_str().map(str::to_owned),
                        }),
                        _ => {}
                    }
                }
            }
            Some("user") => {
                let content = &payload["message"]["content"];
                if history && let Some(text) = content.as_str() {
                    updates.push(Update::User(text.to_owned()));
                }
                for block in content.as_array().into_iter().flatten() {
                    if block["type"] == "tool_result" {
                        updates.push(Update::ToolResult {
                            id: block["tool_use_id"]
                                .as_str()
                                .ok_or(Error::Protocol)?
                                .to_owned(),
                            output: block["content"].clone(),
                            failed: block["is_error"].as_bool().unwrap_or(false),
                        });
                    } else if history && block["type"] == "text" {
                        updates.push(Update::User(
                            block["text"].as_str().ok_or(Error::Protocol)?.to_owned(),
                        ));
                    }
                }
            }
            Some("result") => updates.push(Update::Finished {
                failed: payload["is_error"].as_bool().unwrap_or(false)
                    || payload["subtype"] != "success",
                cancelled: payload["stop_reason"] == "interrupt"
                    || payload["subtype"] == "interrupted",
                usage: payload["usage"].clone(),
            }),
            _ => {}
        }
        Ok(updates)
    }
}

#[cfg(test)]
mod test;
