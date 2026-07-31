//! Translation from ACP session updates into the chat message parts used by
//! `document_cognition_service` (the `agent` crate's [`AssistantMessagePart`]).

#[cfg(test)]
mod test;

use agent::types::AssistantMessagePart;
use agent_client_protocol::schema::v1::{
    ContentBlock, SessionUpdate, ToolCall, ToolCallStatus, ToolCallUpdate,
};

/// Extract a plain-text rendering of an ACP content block.
///
/// Text blocks map to their payload; other block kinds fall back to their
/// JSON representation so nothing is silently dropped.
pub fn content_block_text(block: &ContentBlock) -> String {
    match block {
        ContentBlock::Text(text) => text.text.clone(),
        other => serde_json::to_string(other).unwrap_or_default(),
    }
}

/// Concatenate the text of a prompt's content blocks.
pub fn content_blocks_text(blocks: &[ContentBlock]) -> String {
    blocks
        .iter()
        .map(content_block_text)
        .collect::<Vec<_>>()
        .join("")
}

fn translate_tool_call(tool_call: ToolCall) -> AssistantMessagePart {
    AssistantMessagePart::ToolCall {
        name: tool_call.title,
        json: tool_call.raw_input.unwrap_or(serde_json::Value::Null),
        id: tool_call.tool_call_id.0.to_string(),
    }
}

fn translate_tool_call_update(update: ToolCallUpdate) -> Option<AssistantMessagePart> {
    let id = update.tool_call_id.0.to_string();
    let name = update.fields.title.clone().unwrap_or_default();
    match update.fields.status {
        Some(ToolCallStatus::Completed) => Some(AssistantMessagePart::ToolCallResponseJson {
            name,
            json: update.fields.raw_output.unwrap_or(serde_json::Value::Null),
            id,
        }),
        Some(ToolCallStatus::Failed) => Some(AssistantMessagePart::ToolCallErr {
            name,
            description: update
                .fields
                .raw_output
                .map(|v| v.to_string())
                .unwrap_or_else(|| "tool call failed".to_string()),
            id,
        }),
        // Intermediate updates (pending / in-progress / content streaming)
        // are streamed live but not persisted as message parts.
        _ => None,
    }
}

/// Translate one ACP session update into an [`AssistantMessagePart`] to be
/// persisted, or `None` when the update carries no persistable content.
pub fn translate_session_update(update: SessionUpdate) -> Option<AssistantMessagePart> {
    match update {
        SessionUpdate::AgentMessageChunk(chunk) => Some(AssistantMessagePart::Text {
            text: content_block_text(&chunk.content),
        }),
        SessionUpdate::AgentThoughtChunk(chunk) => Some(AssistantMessagePart::Thinking {
            thinking: content_block_text(&chunk.content),
        }),
        SessionUpdate::ToolCall(tool_call) => Some(translate_tool_call(tool_call)),
        SessionUpdate::ToolCallUpdate(update) => translate_tool_call_update(update),
        // User message echoes are persisted when the user posts them; plans,
        // mode/config/usage updates and other session bookkeeping are
        // streamed live but not stored as message parts.
        _ => None,
    }
}

/// Accumulates translated parts for one agent turn, merging consecutive
/// streaming chunks of the same kind so a turn persists as one message with
/// coherent parts (mirroring how DCS accumulates a streamed response).
#[derive(Debug, Default)]
pub struct TurnAccumulator {
    parts: Vec<AssistantMessagePart>,
}

impl TurnAccumulator {
    /// Add one translated part, merging consecutive text or thinking chunks.
    pub fn push(&mut self, part: AssistantMessagePart) {
        match (self.parts.last_mut(), part) {
            (
                Some(AssistantMessagePart::Text { text }),
                AssistantMessagePart::Text { text: next },
            ) => text.push_str(&next),
            (
                Some(AssistantMessagePart::Thinking { thinking }),
                AssistantMessagePart::Thinking { thinking: next },
            ) => thinking.push_str(&next),
            (_, part) => self.parts.push(part),
        }
    }

    /// Take the accumulated parts, leaving the accumulator empty.
    pub fn take(&mut self) -> Vec<AssistantMessagePart> {
        std::mem::take(&mut self.parts)
    }

    /// Whether any parts have been accumulated.
    pub fn is_empty(&self) -> bool {
        self.parts.is_empty()
    }
}
