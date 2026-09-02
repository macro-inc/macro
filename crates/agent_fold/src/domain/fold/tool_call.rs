//! Tool calls: opening a part for one and patching it as updates arrive.

use std::path::PathBuf;

use crate::domain::error::FoldError;
use crate::domain::harness::{claude_code, command_from_raw_input, file_edit_from_raw_input};
use crate::domain::model::{AnsiText, FileDiff, MessagePart, ToolDetail, ToolUseId};
use agent_client_protocol::schema::v1::{
    Content, Meta, ToolCall, ToolCallContent, ToolCallLocation, ToolCallUpdate, ToolKind,
};

use super::convert::{content_block_text, tool_kind_name, tool_status};
use super::state::{Changed, FoldState};

impl FoldState {
    /// Handle a `tool_call`: add a new tool part.
    pub(super) fn open_tool_call(&mut self, call: ToolCall) -> Option<Changed> {
        let id = ToolUseId(call.tool_call_id.0.to_string());
        let label =
            claude_code::tool_name(call.meta.as_ref()).unwrap_or_else(|| call.title.clone());

        let tool = MessagePart::ToolUse {
            id: id.clone(),
            label,
            status: tool_status(call.status),
            detail: tool_detail(
                call.kind,
                call.raw_input.as_ref(),
                &call.content,
                &call.locations,
                call.meta.as_ref(),
            ),
            raw_input: call.raw_input.clone().map(Box::new),
            raw_output: call.raw_output.clone().map(Box::new),
        };

        // A repeated open for the same id patches in place rather than
        // duplicating the row. Looked up without `?` so that a call arriving
        // with no turn open falls through to `push_agent_part`, which opens
        // one, rather than being dropped.
        let opened = self
            .turn
            .as_ref()
            .and_then(|turn| turn.tool_positions.get(&id).copied());
        if let Some(position) = opened {
            let (message, parts) = self.agent_parts_mut()?;
            if let Some(existing @ MessagePart::ToolUse { .. }) = parts.get_mut(position) {
                *existing = tool;
            }
            return Some(Changed::updated(message));
        }

        let (changed, position) = self.push_agent_part(tool)?;
        self.open_turn().tool_positions.insert(id, position);
        Some(changed)
    }

    /// Handle a `tool_call_update`: patch an existing tool part.
    ///
    /// Only fields the update actually carries are written, since
    /// `ToolCallUpdateFields` is entirely optional and a typical call is
    /// patched several times - the recordings average about four updates per
    /// call.
    pub(super) fn patch_tool_call(&mut self, update: ToolCallUpdate) -> Option<Changed> {
        let id = ToolUseId(update.tool_call_id.0.to_string());

        let Some(&position) = self.turn.as_ref()?.tool_positions.get(&id) else {
            self.warn(FoldError::PatchBeforeOpen { tool_call: id });
            return None;
        };
        let (message, parts) = self.agent_parts_mut()?;
        let Some(MessagePart::ToolUse {
            label,
            status,
            detail,
            raw_input,
            raw_output,
            ..
        }) = parts.get_mut(position)
        else {
            return None;
        };

        let fields = update.fields;

        if let Some(new_status) = fields.status {
            *status = tool_status(new_status);
        }
        if let Some(title) = fields.title {
            // A harness-supplied name outranks any ACP title, so only take
            // the title when nothing better is already set.
            if claude_code::tool_name(update.meta.as_ref()).is_none() && label.is_empty() {
                *label = title;
            }
        }
        if let Some(name) = claude_code::tool_name(update.meta.as_ref()) {
            *label = name;
        }

        patch_detail(
            detail,
            fields.raw_input.as_ref(),
            fields.content.as_deref(),
            fields.locations.as_deref(),
            update.meta.as_ref(),
        );

        if let Some(found) = fields.raw_input {
            *raw_input = Some(Box::new(found));
        }
        if let Some(found) = fields.raw_output {
            *raw_output = Some(Box::new(found));
        }

        Some(Changed::updated(message))
    }
}

/// Build a [`ToolDetail`] from a tool call's opening frame.
pub(super) fn tool_detail(
    kind: ToolKind,
    raw_input: Option<&serde_json::Value>,
    content: &[ToolCallContent],
    locations: &[ToolCallLocation],
    meta: Option<&Meta>,
) -> ToolDetail {
    match kind {
        ToolKind::Execute => ToolDetail::Terminal {
            command: command_from_raw_input(raw_input),
            output: claude_code::terminal_output(meta).map(AnsiText),
            exit_code: claude_code::terminal_exit_code(meta),
        },
        ToolKind::Edit => ToolDetail::Edit {
            diffs: edit_diffs(content, raw_input),
        },
        ToolKind::Read => ToolDetail::Read {
            paths: location_paths(locations),
        },
        ToolKind::Delete => ToolDetail::Delete {
            paths: location_paths(locations),
        },
        ToolKind::Move => ToolDetail::Move {
            paths: location_paths(locations),
        },
        ToolKind::Search => ToolDetail::Search {
            paths: location_paths(locations),
            output: generic_output(content),
        },
        ToolKind::Fetch => ToolDetail::Fetch {
            output: generic_output(content),
        },
        ToolKind::Think => ToolDetail::Think {
            output: generic_output(content),
        },
        other => ToolDetail::Other {
            kind: tool_kind_name(other).to_owned(),
            output: generic_output(content),
            input: raw_input.cloned(),
        },
    }
}

/// Write an update's fields into an existing detail, leaving what it does not
/// carry untouched.
pub(super) fn patch_detail(
    detail: &mut ToolDetail,
    raw_input: Option<&serde_json::Value>,
    content: Option<&[ToolCallContent]>,
    locations: Option<&[ToolCallLocation]>,
    meta: Option<&Meta>,
) {
    match detail {
        ToolDetail::Terminal {
            command,
            output,
            exit_code,
        } => {
            if let Some(found) = command_from_raw_input(raw_input) {
                *command = Some(found);
            }
            // Each update carries the output accumulated so far, so replace.
            if let Some(found) = claude_code::terminal_output(meta) {
                *output = Some(AnsiText(found));
            }
            if let Some(found) = claude_code::terminal_exit_code(meta) {
                *exit_code = Some(found);
            }
        }
        ToolDetail::Edit { diffs: existing } => {
            if let Some(content) = content {
                let found = diffs(content);
                if !found.is_empty() {
                    *existing = found;
                }
            }
            // A call that never reports a diff block (Claude Code's `Write`)
            // may still deliver its raw input on a later update.
            if existing.is_empty()
                && let Some(found) = synthesized_edit_diff(raw_input)
            {
                *existing = vec![found];
            }
        }
        ToolDetail::Read { paths } | ToolDetail::Delete { paths } | ToolDetail::Move { paths } => {
            if let Some(found) = locations.map(location_paths)
                && !found.is_empty()
            {
                *paths = found;
            }
        }
        ToolDetail::Search { paths, output } => {
            if let Some(found) = locations.map(location_paths)
                && !found.is_empty()
            {
                *paths = found;
            }
            if let Some(found) = content.and_then(generic_output) {
                *output = Some(found);
            }
        }
        ToolDetail::Fetch { output } | ToolDetail::Think { output } => {
            if let Some(found) = content.and_then(generic_output) {
                *output = Some(found);
            }
        }
        ToolDetail::Other { input, output, .. } => {
            if let Some(found) = raw_input {
                *input = Some(found.clone());
            }
            if let Some(found) = content.and_then(generic_output) {
                *output = Some(found);
            }
        }
    }
}

/// An edit call's diffs: the reported diff blocks, or — for calls that never
/// report one, like Claude Code's `Write` — a whole-file diff synthesized
/// from the raw input.
pub(super) fn edit_diffs(
    content: &[ToolCallContent],
    raw_input: Option<&serde_json::Value>,
) -> Vec<FileDiff> {
    let found = diffs(content);
    if !found.is_empty() {
        return found;
    }
    synthesized_edit_diff(raw_input).into_iter().collect()
}

/// A whole-file diff from `{filePath, content}` raw input. The prior contents
/// are not on the wire, so the file reads as new.
pub(super) fn synthesized_edit_diff(raw_input: Option<&serde_json::Value>) -> Option<FileDiff> {
    let (path, content) = file_edit_from_raw_input(raw_input)?;
    Some(FileDiff {
        path: path.into(),
        old_text: None,
        new_text: content,
    })
}

/// The diffs among a tool call's content blocks.
pub(super) fn diffs(content: &[ToolCallContent]) -> Vec<FileDiff> {
    content
        .iter()
        .filter_map(|block| match block {
            ToolCallContent::Diff(diff) => Some(FileDiff {
                path: diff.path.clone(),
                old_text: diff.old_text.clone(),
                new_text: diff.new_text.clone(),
            }),
            _ => None,
        })
        .collect()
}

/// The paths among a tool call's reported locations.
///
/// The one source this fold trusts for "what path did this call touch" -
/// `locations` is ACP's own field, meant for exactly this, unlike `rawInput`,
/// whose keys are a harness's own convention with no fixed shape to read.
pub(super) fn location_paths(locations: &[ToolCallLocation]) -> Vec<PathBuf> {
    locations
        .iter()
        .map(|location| location.path.clone())
        .collect()
}

/// The text among a tool call's content blocks - e.g. search matches or a
/// fetched page's text - joined in order.
///
/// `None` when none of the blocks carry text, same as an empty result: there
/// is nothing useful to distinguish "reported nothing" from "reported an
/// empty string."
pub(super) fn generic_output(content: &[ToolCallContent]) -> Option<String> {
    let text = content
        .iter()
        .filter_map(|block| match block {
            ToolCallContent::Content(Content {
                content: block_content,
                ..
            }) => content_block_text(block_content.clone()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("");
    (!text.is_empty()).then_some(text)
}
