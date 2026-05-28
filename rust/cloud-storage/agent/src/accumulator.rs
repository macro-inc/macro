#[cfg(test)]
mod test;

/// Accumulation of streamed agent parts into a persistable message.
use crate::convert::merge_consecutive_parts;
use crate::stream::{StreamPart, ToolResponse};
use crate::types::AssistantMessagePart;

/// Accumulates [`StreamPart`]s emitted by an agent stream into an ordered
/// sequence of [`AssistantMessagePart`]s.
///
/// Parts are stored in arrival order exactly as they stream in. Consecutive
/// text and thinking deltas are only collapsed when the accumulated parts are
/// accessed via [`StreamAccumulator::into_parts`] or
/// [`StreamAccumulator::parts`]. This lets a consumer forward each individual
/// delta as it arrives while the persisted message still ends up with merged
/// text and thinking blocks.
#[derive(Debug, Default, Clone)]
pub struct StreamAccumulator {
    parts: Vec<AssistantMessagePart>,
}

impl StreamAccumulator {
    /// Create an empty accumulator.
    pub fn new() -> Self {
        Self::default()
    }

    /// Convert a [`StreamPart`] into the [`AssistantMessagePart`] it persists
    /// as, accumulate it, and return a reference to the stored part.
    ///
    /// Returns `None` (accumulating nothing) for parts that carry no
    /// persistable content: token [`Usage`](StreamPart::Usage) events and empty
    /// text or thinking deltas. The returned reference is the unmerged part, so
    /// a consumer can forward it as an individual streamed chunk.
    pub fn push(&mut self, part: StreamPart) -> Option<&AssistantMessagePart> {
        let part = stream_part_to_message_part(part)?;
        self.parts.push(part);
        self.parts.last()
    }

    /// Consume the accumulator, returning the parts with consecutive text and
    /// thinking deltas merged.
    pub fn into_parts(self) -> Vec<AssistantMessagePart> {
        merge_consecutive_parts(self.parts)
    }

    /// Return the merged parts without consuming the accumulator.
    pub fn parts(&self) -> Vec<AssistantMessagePart> {
        merge_consecutive_parts(self.parts.clone())
    }

    /// Whether nothing has been accumulated yet.
    ///
    /// Reflects the raw accumulated parts; since merging never drops parts this
    /// also indicates whether [`parts`](Self::parts) would be empty.
    pub fn is_empty(&self) -> bool {
        self.parts.is_empty()
    }
}

/// Convert a single [`StreamPart`] into the [`AssistantMessagePart`] that should
/// be persisted for it, if any.
///
/// MCP tool calls are mapped to [`AssistantMessagePart::McpToolCall`] so the
/// originating service is preserved. Usage events and empty text/thinking
/// deltas return `None`.
fn stream_part_to_message_part(part: StreamPart) -> Option<AssistantMessagePart> {
    match part {
        StreamPart::Content(text) if !text.is_empty() => Some(AssistantMessagePart::Text { text }),
        StreamPart::Thinking(thinking) if !thinking.is_empty() => {
            Some(AssistantMessagePart::Thinking { thinking })
        }
        StreamPart::ToolCall(call) => Some(match call.mcp {
            Some(mcp) => AssistantMessagePart::McpToolCall {
                name: mcp.tool_name,
                service: mcp.service,
                display_name: mcp.display_name,
                json: call.json,
                id: call.id,
            },
            None => AssistantMessagePart::ToolCall {
                name: call.name,
                json: call.json,
                id: call.id,
            },
        }),
        StreamPart::ToolResponse(ToolResponse::Json { id, json, name }) => {
            Some(AssistantMessagePart::ToolCallResponseJson { name, json, id })
        }
        StreamPart::ToolResponse(ToolResponse::Err {
            id,
            name,
            description,
        }) => Some(AssistantMessagePart::ToolCallErr {
            name,
            description,
            id,
        }),
        // Empty text/thinking deltas and usage events carry nothing to persist.
        StreamPart::Content(_) | StreamPart::Thinking(_) | StreamPart::Usage(_) => None,
    }
}
