#[cfg(test)]
mod test;

/// Conversions between agent message types and `rig` message types.
use crate::types::{AssistantMessagePart, ChatMessage, ChatMessageContent, Role};
use rig_core::OneOrMany;
use rig_core::message::{
    AssistantContent, Message, ToolCall, ToolFunction, ToolResultContent, UserContent,
};

/// Convert a slice of [`ChatMessage`] into RIG [`Message`]s.
///
/// System messages are skipped (the system prompt is set on the agent).
///
/// A single persisted assistant message may contain a flattened multi-turn
/// tool loop: `[text, tool_calls, tool_results, text]`. This function
/// reconstructs the turn boundaries Anthropic expects:
/// `assistant(text + tool_calls)`, `user(tool_results)`, `assistant(text)`.
pub fn to_rig_messages(messages: &[ChatMessage]) -> Vec<Message> {
    messages.iter().flat_map(convert_one).collect()
}

fn convert_one(msg: &ChatMessage) -> Vec<Message> {
    match msg.role {
        Role::System => vec![],
        Role::User => {
            let text = msg.content.message_text();
            vec![Message::user(text)]
        }
        Role::Assistant => convert_assistant(msg),
    }
}

fn convert_assistant(msg: &ChatMessage) -> Vec<Message> {
    let parts = match &msg.content {
        ChatMessageContent::Text(text) => {
            return vec![Message::assistant(text)];
        }
        ChatMessageContent::AssistantMessageParts(parts) => parts,
    };

    let mut out: Vec<Message> = Vec::new();
    let mut assistant_parts: Vec<AssistantContent> = Vec::new();
    let mut tool_results: Vec<UserContent> = Vec::new();
    let mut saw_tool_call = false;

    for part in parts {
        match part {
            AssistantMessagePart::Text { text } => {
                if saw_tool_call {
                    flush(&mut out, &mut assistant_parts, &mut tool_results);
                    saw_tool_call = false;
                }
                if let Some(AssistantContent::Text(prev)) = assistant_parts.last_mut() {
                    prev.text.push_str(text);
                } else {
                    assistant_parts.push(AssistantContent::text(text));
                }
            }
            AssistantMessagePart::ToolCall { name, json, id } => {
                saw_tool_call = true;
                assistant_parts.push(AssistantContent::ToolCall(ToolCall::new(
                    id.clone(),
                    ToolFunction::new(name.clone(), json.clone()),
                )));
            }
            AssistantMessagePart::McpToolCall { name, json, id, .. } => {
                saw_tool_call = true;
                assistant_parts.push(AssistantContent::ToolCall(ToolCall::new(
                    id.clone(),
                    ToolFunction::new(name.clone(), json.clone()),
                )));
            }
            AssistantMessagePart::ToolCallResponseJson { id, json, .. } => {
                let text = serde_json::to_string(json).unwrap_or_default();
                tool_results.push(UserContent::tool_result(
                    id.clone(),
                    OneOrMany::one(ToolResultContent::text(text)),
                ));
            }
            AssistantMessagePart::ToolCallErr {
                id, description, ..
            } => {
                tool_results.push(UserContent::tool_result(
                    id.clone(),
                    OneOrMany::one(ToolResultContent::text(description.clone())),
                ));
            }
            AssistantMessagePart::Thinking { .. } => {}
        }
    }

    flush(&mut out, &mut assistant_parts, &mut tool_results);
    out
}

fn flush(
    out: &mut Vec<Message>,
    assistant_parts: &mut Vec<AssistantContent>,
    tool_results: &mut Vec<UserContent>,
) {
    if !assistant_parts.is_empty() {
        let parts = std::mem::take(assistant_parts);
        if let Ok(content) = OneOrMany::many(parts) {
            out.push(Message::Assistant { id: None, content });
        }
    }
    if !tool_results.is_empty() {
        let results = std::mem::take(tool_results);
        if let Ok(content) = OneOrMany::many(results) {
            out.push(Message::User { content });
        }
    }
}
