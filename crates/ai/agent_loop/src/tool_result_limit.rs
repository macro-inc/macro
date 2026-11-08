//! Keeping one tool result from crowding the model out of its context.
//!
//! A tool can answer with megabytes: a search over logs, a downloaded file.
//! The model reads every result of a turn on every later request, so a few of
//! those overflow its context window and the provider refuses the turn.
//!
//! A loop given a [`ToolResultLimit`] shows the model at most
//! [`MAX_RESULT_CHARS`] of any result. A longer one is cut to its first
//! [`PREVIEW_CHARS`] and a note naming the [`ReadToolResult`] tool, which pages
//! through the whole result the limit keeps. Only the model's view is cut: the
//! stream, and so the host's log and history, carry the full result, and
//! [`crate::to_rig_messages_limited`] cuts it the same way each time history is
//! replayed, so a result reads the same in every turn.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

/// The longest result the model reads whole: about 25k tokens, the limit
/// Claude Code sets on an MCP tool's output.
pub const MAX_RESULT_CHARS: usize = 80_000;

/// How much of a longer result the model reads before the note.
pub const PREVIEW_CHARS: usize = 16_000;

/// The most one [`ReadToolResult`] call returns. Under [`MAX_RESULT_CHARS`]
/// even once escaped as JSON, so a page is never cut itself.
pub const MAX_PAGE_CHARS: usize = 32_000;

/// The results too long for the model to read whole, by tool call id.
///
/// Cheap to clone; clones share the results. A host makes one per turn: the
/// turn's own results are kept as they arrive, and earlier ones as history is
/// replayed into the turn.
#[derive(Clone, Default)]
pub struct ToolResultLimit {
    kept: Arc<Mutex<HashMap<String, Arc<str>>>>,
}

impl ToolResultLimit {
    /// What the model reads of `text`, the result of call `id`, when it is
    /// too long to read whole: its beginning and a note on reading the rest.
    /// `None` when it fits.
    pub(crate) fn view(&self, id: &str, text: &str) -> Option<String> {
        text.char_indices().nth(MAX_RESULT_CHARS)?;
        let total = text.chars().count();
        let preview_end = text
            .char_indices()
            .nth(PREVIEW_CHARS)
            .map_or(text.len(), |(index, _)| index);
        tracing::info!(
            tool_call_id = id,
            chars = total,
            "truncated a tool result for the model"
        );
        self.kept
            .lock()
            .expect("kept tool results poisoned")
            .insert(id.to_owned(), Arc::from(text));
        Some(format!(
            "{}\n\n[Truncated: this result is {total} characters and only the first \
             {PREVIEW_CHARS} are shown. Call ReadToolResult with tool_call_id \"{id}\" and \
             offset {PREVIEW_CHARS} to read on.]",
            &text[..preview_end]
        ))
    }

    /// Up to `limit` characters of call `id`'s result from character
    /// `offset`. `None` when no result of that call was cut.
    pub(crate) fn read(&self, id: &str, offset: usize, limit: usize) -> Option<ToolResultPage> {
        let text = Arc::clone(
            self.kept
                .lock()
                .expect("kept tool results poisoned")
                .get(id)?,
        );
        let total_chars = text.chars().count();
        let content: String = text.chars().skip(offset).take(limit).collect();
        let end = offset.saturating_add(content.chars().count());
        Some(ToolResultPage {
            content,
            total_chars,
            next_offset: (end < total_chars).then_some(end),
        })
    }
}

/// Read more of a tool result that was too long to show whole.
#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(
    title = "ReadToolResult",
    description = "Read more of a tool result that was cut because it was too long. Use the tool_call_id and offset from the truncation note, then the returned next_offset to continue. Read only as much as the task needs."
)]
pub struct ReadToolResult {
    /// The call whose result was cut, as the truncation note names it.
    #[schemars(description = "The tool_call_id from the truncation note.")]
    pub tool_call_id: String,
    /// Where to start, in characters from the beginning of the result.
    #[serde(default)]
    #[schemars(description = "Character offset to start reading from; defaults to 0.")]
    pub offset: usize,
    /// How many characters to read.
    #[serde(default)]
    #[schemars(description = "Characters to read, at most 32000; defaults to 32000.")]
    pub limit: Option<usize>,
}

/// One page of a cut tool result.
#[derive(Debug, Serialize, JsonSchema)]
pub struct ToolResultPage {
    /// The result's characters from the requested offset.
    pub content: String,
    /// How long the whole result is, in characters.
    pub total_chars: usize,
    /// Where the next page starts; absent once the result is read to its end.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub next_offset: Option<usize>,
}

impl ToolAnnotated for ReadToolResult {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Read tool result");
}

#[async_trait]
impl AsyncTool<ToolResultLimit> for ReadToolResult {
    type Output = ToolResultPage;

    async fn call(
        &self,
        context: ServiceContext<ToolResultLimit>,
        _request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let limit = self.limit.unwrap_or(MAX_PAGE_CHARS).min(MAX_PAGE_CHARS);
        context
            .read(&self.tool_call_id, self.offset, limit)
            .ok_or_else(|| ToolCallError {
                description: format!(
                    "No cut result for tool call {}. Use the tool_call_id from a truncation note.",
                    self.tool_call_id
                ),
                internal_error: anyhow::anyhow!("no kept tool result"),
            })
    }
}
